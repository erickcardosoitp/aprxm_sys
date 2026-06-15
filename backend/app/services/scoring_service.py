from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


_SCORE_SQL = text("""
WITH features AS (
    SELECT
        r.id,
        COALESCE(
            EXTRACT(DAY FROM NOW() - MAX(m.paid_at) FILTER (WHERE m.status = 'paid'))::int,
            999
        )                                                                       AS dias_recencia,
        CASE WHEN COUNT(m.id) = 0 THEN 0
             ELSE COUNT(*) FILTER (WHERE m.status = 'paid')::float / COUNT(m.id)
        END                                                                     AS taxa_pagamento,
        COUNT(*) FILTER (
            WHERE m.status = 'pending' AND m.due_date < NOW() - INTERVAL '2 days'
        )                                                                       AS meses_atrasados,
        COALESCE(MAX(
            EXTRACT(DAY FROM NOW() - m.due_date::timestamptz)::int
        ) FILTER (
            WHERE m.status = 'pending' AND m.due_date < NOW() - INTERVAL '2 days'
        ), 0)                                                                   AS max_dias_atraso,
        COUNT(DISTINCT p.id)::float /
            GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), r.created_at)) + 1)      AS enc_por_mes,
        GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), r.created_at)) + 1)::int     AS tenure_meses,
        (SELECT av.result FROM agent_visits av
         WHERE av.resident_id = r.id AND av.association_id = :aid
         ORDER BY av.visited_at DESC LIMIT 1)                                   AS ultimo_visita
    FROM residents r
    LEFT JOIN mensalidades m
           ON m.resident_id = r.id AND m.association_id = :aid
    LEFT JOIN packages p
           ON p.resident_id = r.id AND p.association_id = :aid
          AND p.delivered_at IS NOT NULL
    WHERE r.association_id = :aid
      AND r.type   = 'member'
      AND r.status = 'active'
    GROUP BY r.id, r.created_at
),
rfm AS (
    SELECT *,
        -- R score 1-5: quantos dias desde o último pagamento
        CASE
            WHEN dias_recencia <= 35  THEN 5
            WHEN dias_recencia <= 65  THEN 4
            WHEN dias_recencia <= 95  THEN 3
            WHEN dias_recencia <= 125 THEN 2
            ELSE 1
        END AS r_score,
        -- F score 1-5: proporção de meses pagos
        CASE
            WHEN taxa_pagamento >= 0.90 THEN 5
            WHEN taxa_pagamento >= 0.75 THEN 4
            WHEN taxa_pagamento >= 0.50 THEN 3
            WHEN taxa_pagamento >= 0.25 THEN 2
            ELSE 1
        END AS f_score
    FROM features
)
UPDATE residents SET
    risk_score = GREATEST(0, LEAST(100, (
        100
        -- penalidade de frequência (até -30)
        - (1.0 - taxa_pagamento) * 30
        -- penalidade inadimplência atual (até -25 por mês + -25 por dias)
        - meses_atrasados * 15
        - LEAST(max_dias_atraso::float * 0.5, 25)
        -- penalidade de recência
        - CASE
            WHEN dias_recencia <= 35  THEN 0
            WHEN dias_recencia <= 65  THEN 5
            WHEN dias_recencia <= 95  THEN 15
            ELSE 30
          END
        -- bônus de engajamento com encomendas (até +20)
        + LEAST(enc_por_mes * 5, 20)
        -- bônus de tempo de associação (até +10)
        + LEAST(tenure_meses::float * 0.5, 10)
        -- ajuste da última visita porta a porta
        + CASE ultimo_visita
            WHEN 'paid'     THEN  10
            WHEN 'will_pay' THEN   5
            WHEN 'refused'  THEN -15
            ELSE 0
          END
    )::int))::smallint,
    rfm_segment = CASE
        WHEN tenure_meses <= 2                         THEN 'novo'
        WHEN r_score >= 4 AND f_score >= 4             THEN 'campeao'
        WHEN r_score >= 3 AND f_score >= 3             THEN 'leal'
        WHEN r_score <= 2 AND f_score >= 4             THEN 'em_risco'
        WHEN r_score = 1  AND f_score >= 3             THEN 'nao_pode_perder'
        WHEN f_score = 1                               THEN 'inadimplente_cronico'
        WHEN r_score <= 2 AND f_score <= 2             THEN 'hibernando'
        ELSE                                                'regular'
    END,
    risk_updated_at = NOW()
FROM rfm
WHERE residents.id = rfm.id
  AND residents.association_id = :aid
""")


async def run_scoring(session: AsyncSession, association_id: UUID) -> int:
    result = await session.execute(_SCORE_SQL, {"aid": str(association_id)})
    await session.commit()
    return result.rowcount


async def run_scoring_all(session: AsyncSession) -> dict:
    rows = (await session.execute(text(
        "SELECT id FROM associations WHERE is_active = TRUE"
    ))).fetchall()

    total = 0
    for (assoc_id,) in rows:
        try:
            n = await run_scoring(session, assoc_id)
            total += n
        except Exception:
            await session.rollback()

    return {"associations": len(rows), "members_scored": total}
