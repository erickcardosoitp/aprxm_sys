from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/senso", tags=["Senso Aproxima"])


@router.get("/analytics", summary="Dados analíticos da comunidade (Senso Aproxima)")
async def analytics(
    cep_prefix: str | None = Query(default=None, description="Prefixo do CEP (ex: '22000')"),
    age_min: int | None = Query(default=None, description="Idade mínima"),
    age_max: int | None = Query(default=None, description="Idade máxima"),
    has_internet: bool | None = Query(default=None),
    has_sewage: bool | None = Query(default=None),
    has_pests: bool | None = Query(default=None),
    uses_transport: bool | None = Query(default=None),
    completion_pct_min: int | None = Query(default=None),
    hide_blank: bool = Query(default=False, description="Excluir registros sem resposta nos campos analisados"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    conditions = ["association_id = :aid", "type = 'member'"]
    params: dict = {"aid": str(current.association_id)}

    if cep_prefix:
        conditions.append("address_cep LIKE :cep")
        params["cep"] = f"{cep_prefix}%"
    if age_min is not None:
        today = date.today()
        params["dob_max"] = str(date(today.year - age_min, today.month, today.day))
        conditions.append("date_of_birth <= :dob_max")
    if age_max is not None:
        today = date.today()
        params["dob_min"] = str(date(today.year - age_max - 1, today.month, today.day))
        conditions.append("date_of_birth >= :dob_min")
    if has_internet is not None:
        if has_internet:
            conditions.append("internet_access IS NOT NULL AND internet_access != ''")
        else:
            conditions.append("(internet_access IS NULL OR internet_access = '')")
    if has_sewage is not None:
        conditions.append("has_sewage = :has_sewage")
        params["has_sewage"] = has_sewage
    if has_pests is not None:
        conditions.append("has_pests = :has_pests")
        params["has_pests"] = has_pests
    if uses_transport is not None:
        conditions.append("uses_public_transport = :uses_transport")
        params["uses_transport"] = uses_transport

    _COMPLETION_EXPR = """(
    CASE WHEN cpf IS NOT NULL AND cpf != '' THEN 1 ELSE 0 END
    + CASE WHEN phone_primary IS NOT NULL AND phone_primary != '' THEN 1 ELSE 0 END
    + CASE WHEN phone_secondary IS NOT NULL AND phone_secondary != '' THEN 1 ELSE 0 END
    + CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END
    + CASE WHEN date_of_birth IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN race IS NOT NULL AND race != '' THEN 1 ELSE 0 END
    + CASE WHEN education_level IS NOT NULL AND education_level != '' THEN 1 ELSE 0 END
    + CASE WHEN unit IS NOT NULL AND unit != '' THEN 1 ELSE 0 END
    + CASE WHEN block IS NOT NULL AND block != '' THEN 1 ELSE 0 END
    + CASE WHEN address_cep IS NOT NULL AND address_cep != '' THEN 1 ELSE 0 END
    + CASE WHEN address_street IS NOT NULL AND address_street != '' THEN 1 ELSE 0 END
    + CASE WHEN address_number IS NOT NULL AND address_number != '' THEN 1 ELSE 0 END
    + CASE WHEN household_count IS NOT NULL AND household_count > 0 THEN 1 ELSE 0 END
    + CASE WHEN address_rooms IS NOT NULL AND address_rooms > 0 THEN 1 ELSE 0 END
    + CASE WHEN internet_access IS NOT NULL AND internet_access != '' THEN 1 ELSE 0 END
    + CASE WHEN has_sewage IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN neighborhood_problems IS NOT NULL AND neighborhood_problems != '[]' THEN 1 ELSE 0 END
    + CASE WHEN main_priority_request IS NOT NULL AND main_priority_request != '' THEN 1 ELSE 0 END
    + CASE WHEN terms_accepted = TRUE THEN 1 ELSE 0 END
    + CASE WHEN lgpd_accepted = TRUE THEN 1 ELSE 0 END
) * 5"""

    if completion_pct_min is not None:
        conditions.append(f"({_COMPLETION_EXPR}) >= :cpct_min")
        params["cpct_min"] = completion_pct_min

    where = " AND ".join(conditions)

    main = await session.execute(text(f"""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL AND EXTRACT(YEAR FROM AGE(date_of_birth)) < 18) AS age_lt18,
            COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL AND EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 18 AND 29) AS age_18_29,
            COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL AND EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 30 AND 44) AS age_30_44,
            COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL AND EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 45 AND 59) AS age_45_59,
            COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL AND EXTRACT(YEAR FROM AGE(date_of_birth)) >= 60) AS age_60plus,
            COUNT(*) FILTER (WHERE date_of_birth IS NULL) AS age_unknown,
            COUNT(*) FILTER (WHERE internet_access IS NOT NULL AND internet_access != '') AS has_internet,
            COUNT(*) FILTER (WHERE has_sewage = TRUE) AS has_sewage,
            COUNT(*) FILTER (WHERE uses_public_transport = TRUE) AS uses_transport,
            COUNT(*) FILTER (WHERE has_pests = TRUE) AS has_pests,
            COALESCE(AVG(NULLIF(household_count, 0)), 0) AS avg_household,
            COUNT(*) FILTER (WHERE ({_COMPLETION_EXPR}) <= 20) AS comp_critical,
            COUNT(*) FILTER (WHERE ({_COMPLETION_EXPR}) > 20 AND ({_COMPLETION_EXPR}) <= 59) AS comp_improving,
            COUNT(*) FILTER (WHERE ({_COMPLETION_EXPR}) > 59 AND ({_COMPLETION_EXPR}) <= 79) AS comp_regular,
            COUNT(*) FILTER (WHERE ({_COMPLETION_EXPR}) >= 80) AS comp_excellent,
            COUNT(*) FILTER (WHERE has_pests IS NOT NULL) AS pests_answered,
            COUNT(*) FILTER (WHERE has_sewage IS NOT NULL) AS sewage_answered,
            COUNT(*) FILTER (WHERE uses_public_transport IS NOT NULL) AS transport_answered,
            COUNT(*) FILTER (WHERE internet_access IS NOT NULL) AS internet_answered
        FROM residents WHERE {where}
    """), params)
    r = main.fetchone()
    total = max(r[0] or 1, 1)

    edu = await session.execute(text(f"""
        SELECT education_level, COUNT(*) FROM residents
        WHERE {where} AND education_level IS NOT NULL
        GROUP BY education_level ORDER BY 2 DESC
    """), params)

    race = await session.execute(text(f"""
        SELECT race, COUNT(*) FROM residents
        WHERE {where} AND race IS NOT NULL
        GROUP BY race ORDER BY 2 DESC
    """), params)

    problems = await session.execute(text(f"""
        SELECT p.problem, COUNT(*) AS cnt
        FROM residents r,
             jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(r.neighborhood_problems::jsonb) = 'array'
                    THEN r.neighborhood_problems::jsonb
                    ELSE '[]'::jsonb
               END
             ) AS p(problem)
        WHERE {where} AND r.neighborhood_problems IS NOT NULL
        GROUP BY p.problem ORDER BY cnt DESC LIMIT 10
    """), params)

    internet_types = await session.execute(text(f"""
        SELECT internet_access, COUNT(*) FROM residents
        WHERE {where} AND internet_access IS NOT NULL AND internet_access != ''
        GROUP BY internet_access ORDER BY 2 DESC
    """), params)

    street_dist = await session.execute(text(f"""
        SELECT address_street, COUNT(*) AS cnt FROM residents
        WHERE {where} AND address_street IS NOT NULL AND address_street != ''
        GROUP BY address_street ORDER BY cnt DESC LIMIT 15
    """), params)

    def _pct(numerator, denominator):
        return round(numerator / max(denominator, 1) * 100, 1)

    internet_denom = r[19] if hide_blank else total
    sewage_denom = r[17] if hide_blank else total
    transport_denom = r[18] if hide_blank else total
    pests_denom = r[16] if hide_blank else total

    return {
        "total": r[0],
        "age_distribution": [
            {"label": "< 18", "count": r[1]},
            {"label": "18–29", "count": r[2]},
            {"label": "30–44", "count": r[3]},
            {"label": "45–59", "count": r[4]},
            {"label": "60+", "count": r[5]},
            {"label": "N/I", "count": r[6]},
        ],
        "infrastructure": {
            "internet_pct": _pct(r[7], internet_denom),
            "sewage_pct": _pct(r[8], sewage_denom),
            "transport_pct": _pct(r[9], transport_denom),
            "pests_pct": _pct(r[10], pests_denom),
        },
        "avg_household": round(float(r[11]), 1),
        "completion_distribution": {
            "critical": r[12],
            "improving": r[13],
            "regular": r[14],
            "excellent": r[15],
        },
        "education": [{"level": x[0], "count": x[1]} for x in edu.fetchall()],
        "race": [{"race": x[0], "count": x[1]} for x in race.fetchall()],
        "neighborhood_problems": [{"problem": x[0], "count": x[1]} for x in problems.fetchall()],
        "internet_types": [{"type": x[0], "count": x[1]} for x in internet_types.fetchall()],
        "street_distribution": [{"street": x[0], "count": x[1]} for x in street_dist.fetchall()],
        "guest_completion_distribution": await _guest_completion(session, str(current.association_id)),
    }


async def _guest_completion(session, association_id: str) -> dict:
    """Completion distribution for guests using guest-relevant fields (10 fields × 10%)."""
    _GUEST_EXPR = """(
        CASE WHEN phone_primary IS NOT NULL AND phone_primary != '' THEN 1 ELSE 0 END
        + CASE WHEN phone_secondary IS NOT NULL AND phone_secondary != '' THEN 1 ELSE 0 END
        + CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END
        + CASE WHEN address_cep IS NOT NULL AND address_cep != '' THEN 1 ELSE 0 END
        + CASE WHEN address_street IS NOT NULL AND address_street != '' THEN 1 ELSE 0 END
        + CASE WHEN address_number IS NOT NULL AND address_number != '' THEN 1 ELSE 0 END
        + CASE WHEN address_city IS NOT NULL AND address_city != '' THEN 1 ELSE 0 END
        + CASE WHEN address_state IS NOT NULL AND address_state != '' THEN 1 ELSE 0 END
        + CASE WHEN date_of_birth IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN notes IS NOT NULL AND notes != '' THEN 1 ELSE 0 END
    ) * 10"""
    result = await session.execute(text(f"""
        SELECT
            COUNT(*) FILTER (WHERE ({_GUEST_EXPR}) <= 20) AS critical,
            COUNT(*) FILTER (WHERE ({_GUEST_EXPR}) > 20 AND ({_GUEST_EXPR}) <= 59) AS improving,
            COUNT(*) FILTER (WHERE ({_GUEST_EXPR}) > 59 AND ({_GUEST_EXPR}) <= 79) AS regular,
            COUNT(*) FILTER (WHERE ({_GUEST_EXPR}) >= 80) AS excellent,
            COUNT(*) AS total
        FROM residents
        WHERE association_id = :aid AND type = 'guest' AND status = 'active'
    """), {"aid": association_id})
    row = result.fetchone()
    return {"critical": row[0], "improving": row[1], "regular": row[2], "excellent": row[3], "total": row[4]}
