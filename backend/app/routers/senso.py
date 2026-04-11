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
            COALESCE(AVG(NULLIF(household_count, 0)), 0) AS avg_household
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

    cep_dist = await session.execute(text(f"""
        SELECT SUBSTRING(address_cep FROM 1 FOR 5) AS cep5, COUNT(*) FROM residents
        WHERE {where} AND address_cep IS NOT NULL
        GROUP BY cep5 ORDER BY 2 DESC LIMIT 10
    """), params)

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
            "internet_pct": round(r[7] / total * 100, 1),
            "sewage_pct": round(r[8] / total * 100, 1),
            "transport_pct": round(r[9] / total * 100, 1),
            "pests_pct": round(r[10] / total * 100, 1),
        },
        "avg_household": round(float(r[11]), 1),
        "education": [{"level": x[0], "count": x[1]} for x in edu.fetchall()],
        "race": [{"race": x[0], "count": x[1]} for x in race.fetchall()],
        "neighborhood_problems": [{"problem": x[0], "count": x[1]} for x in problems.fetchall()],
        "internet_types": [{"type": x[0], "count": x[1]} for x in internet_types.fetchall()],
        "cep_distribution": [{"cep": x[0], "count": x[1]} for x in cep_dist.fetchall()],
    }
