"""
Camada de servico do modulo ESC (Escritorio) -- concentra as queries que
antes viviam soltas em app/routers/esc.py. O router so faz parsing de
request/response, auditoria e commit; toda regra de acesso a dado mora aqui.
"""
import json as _json
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.core.tenant import empresa_assoc_ids as _empresa_assoc_ids
from app.db.helpers import PROD_ASSOC_FILTER

# tabelas de "movimentacao" que impedem exclusao definitiva de usuario
_ACTIVITY_TABLES = [
    ("transactions", "created_by"), ("cash_sessions", "opened_by"),
    ("packages", "received_by"), ("service_orders", "created_by"),
    ("mensalidades", "created_by"),
]


def status_conta_pagar(amount: Decimal, amount_paid: Decimal) -> str:
    if amount_paid <= 0:
        return "pending"
    if amount_paid >= amount:
        return "paid"
    return "partial"


class EscService:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ── helpers de escopo ────────────────────────────────────────────────

    async def assert_assoc_da_empresa(self, association_id: UUID, empresa_id) -> None:
        ok = (await self.session.execute(text(
            "SELECT 1 FROM associations WHERE id = :aid AND empresa_id = :eid"
        ), {"aid": str(association_id), "eid": str(empresa_id)})).scalar()
        if not ok:
            raise ForbiddenError("Associação fora da sua empresa.")

    async def empresa_assoc_ids(self, empresa_id: UUID) -> list[UUID]:
        return await _empresa_assoc_ids(self.session, empresa_id)

    # ── Cadastros ────────────────────────────────────────────────────────

    async def list_associacoes(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text(f"""
            SELECT id, name, slug, is_active, plan_name, created_at
            FROM associations a WHERE empresa_id = :eid AND {PROD_ASSOC_FILTER} ORDER BY name
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "name": r[1], "slug": r[2], "is_active": r[3],
                 "plan_name": r[4], "created_at": str(r[5])} for r in rows]

    async def editar_associacao(self, association_id: UUID, empresa_id, body, user_id) -> None:
        await self.assert_assoc_da_empresa(association_id, empresa_id)
        sets, params = [], {"id": str(association_id)}
        if body.name is not None:
            sets.append("name = :name"); params["name"] = body.name
        if body.slug is not None:
            sets.append("slug = :slug"); params["slug"] = body.slug
        if body.plan_name is not None:
            sets.append("plan_name = :plan"); params["plan"] = body.plan_name
        if body.is_active is not None:
            sets.append("is_active = :active"); params["active"] = body.is_active
        if not sets:
            return None
        sets.append("updated_at = NOW()")
        sets.append("updated_by = :uid"); params["uid"] = str(user_id)
        await self.session.execute(text(f"UPDATE associations SET {', '.join(sets)} WHERE id = :id"), params)
        return params

    async def list_usuarios(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.last_login_at,
                   COALESCE(a.name, 'Escritório') AS unidade
            FROM users u
            LEFT JOIN associations a ON a.id = u.association_id
            WHERE u.empresa_id = :eid
            ORDER BY u.full_name
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "full_name": r[1], "email": r[2], "role": r[3],
                 "is_active": r[4], "last_login_at": str(r[5]) if r[5] else None,
                 "unidade": r[6]} for r in rows]

    async def list_encomendas(self, empresa_id, date_from: str | None, date_to: str | None,
                               skip: int, limit: int, search: str | None) -> tuple[list[dict], int]:
        cond = f"a.empresa_id = :eid AND {PROD_ASSOC_FILTER}"
        params: dict = {"eid": str(empresa_id)}
        if date_from:
            cond += " AND p.received_at::date >= :df"; params["df"] = date.fromisoformat(date_from)
        if date_to:
            cond += " AND p.received_at::date <= :dt"; params["dt"] = date.fromisoformat(date_to)
        if search:
            cond += " AND (p.sender_name ILIKE :search OR p.carrier_name ILIKE :search)"
            params["search"] = f"%{search}%"

        total = (await self.session.execute(text(
            f"SELECT COUNT(*) FROM packages p JOIN associations a ON a.id = p.association_id WHERE {cond}"
        ), params)).scalar() or 0

        rows = (await self.session.execute(text(f"""
            SELECT p.id, p.status, p.sender_name, p.carrier_name, p.received_at,
                   a.name AS unidade
            FROM packages p JOIN associations a ON a.id = p.association_id
            WHERE {cond}
            ORDER BY p.received_at DESC
            LIMIT :limit OFFSET :skip
        """), {**params, "limit": limit, "skip": skip})).fetchall()
        items = [{"id": str(r[0]), "status": r[1], "sender_name": r[2], "carrier_name": r[3],
                  "received_at": str(r[4]), "unidade": r[5]} for r in rows]
        return items, total

    async def list_ordens_servico(self, empresa_id, date_from: str | None, date_to: str | None,
                                   skip: int, limit: int, search: str | None) -> tuple[list[dict], int]:
        cond = f"a.empresa_id = :eid AND {PROD_ASSOC_FILTER}"
        params: dict = {"eid": str(empresa_id)}
        if date_from:
            cond += " AND os.created_at::date >= :df"; params["df"] = date.fromisoformat(date_from)
        if date_to:
            cond += " AND os.created_at::date <= :dt"; params["dt"] = date.fromisoformat(date_to)
        if search:
            cond += " AND os.title ILIKE :search"
            params["search"] = f"%{search}%"

        total = (await self.session.execute(text(
            f"SELECT COUNT(*) FROM service_orders os JOIN associations a ON a.id = os.association_id WHERE {cond}"
        ), params)).scalar() or 0

        rows = (await self.session.execute(text(f"""
            SELECT os.id, os.number, os.title, os.priority, os.status, os.created_at,
                   a.name AS unidade
            FROM service_orders os JOIN associations a ON a.id = os.association_id
            WHERE {cond}
            ORDER BY os.created_at DESC
            LIMIT :limit OFFSET :skip
        """), {**params, "limit": limit, "skip": skip})).fetchall()
        items = [{"id": str(r[0]), "number": r[1], "title": r[2], "priority": r[3],
                  "status": r[4], "created_at": str(r[5]), "unidade": r[6]} for r in rows]
        return items, total

    async def excluir_ordem_servico(self, so_id: UUID, empresa_id) -> tuple[str, str]:
        ids = await self.empresa_assoc_ids(empresa_id)
        so_row = (await self.session.execute(text(
            "SELECT id, number, title FROM service_orders WHERE id = :id AND association_id = ANY(:ids)"
        ), {"id": str(so_id), "ids": [str(i) for i in ids]})).fetchone()
        if not so_row:
            raise NotFoundError("Ordem de Serviço")

        await self.session.execute(text("DELETE FROM so_presence WHERE so_id = :id"), {"id": str(so_id)})
        await self.session.execute(text("DELETE FROM service_order_tasks WHERE service_order_id = :id"), {"id": str(so_id)})
        await self.session.execute(text("DELETE FROM service_order_comments WHERE service_order_id = :id"), {"id": str(so_id)})
        await self.session.execute(text("DELETE FROM service_order_history WHERE service_order_id = :id"), {"id": str(so_id)})
        await self.session.execute(text("DELETE FROM service_orders WHERE id = :id"), {"id": str(so_id)})
        return so_row[1], so_row[2]

    async def list_comprovantes_estoque(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text(f"""
            SELECT a.id, a.name, COALESCE(s.proof_stock, 0) AS estoque
            FROM associations a
            LEFT JOIN association_settings s ON s.association_id = a.id
            WHERE a.empresa_id = :eid AND {PROD_ASSOC_FILTER} ORDER BY a.name
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "unidade": r[1], "estoque": r[2]} for r in rows]

    async def editar_comprovante_estoque(self, association_id: UUID, empresa_id, estoque: int) -> None:
        await self.assert_assoc_da_empresa(association_id, empresa_id)
        await self.session.execute(text("""
            INSERT INTO association_settings (association_id, proof_stock)
            VALUES (:aid, :estoque)
            ON CONFLICT (association_id) DO UPDATE SET proof_stock = :estoque, updated_at = NOW()
        """), {"aid": str(association_id), "estoque": estoque})

    # ── Moradores ────────────────────────────────────────────────────────

    async def list_residents_by_type(self, empresa_id, resident_type: str) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT r.id, r.full_name, r.cpf, r.status, r.created_at, a.name AS unidade
            FROM residents r JOIN associations a ON a.id = r.association_id
            WHERE a.empresa_id = :eid AND r.type = :rtype
            ORDER BY r.full_name LIMIT 300
        """), {"eid": str(empresa_id), "rtype": resident_type})).fetchall()
        return [{"id": str(r[0]), "full_name": r[1], "cpf": r[2], "status": r[3],
                 "created_at": str(r[4]), "unidade": r[5]} for r in rows]

    # ── Financeiro ───────────────────────────────────────────────────────

    async def list_sangrias(self, ids: list[str], date_from: str | None, date_to: str | None) -> list[dict]:
        cond = "t.association_id = ANY(:ids) AND t.is_sangria = true"
        params: dict = {"ids": ids}
        if date_from:
            cond += " AND t.transaction_at::date >= :df"
            params["df"] = date.fromisoformat(date_from)
        if date_to:
            cond += " AND t.transaction_at::date <= :dt"
            params["dt"] = date.fromisoformat(date_to)
        rows = (await self.session.execute(text(f"""
            SELECT t.id, t.amount, t.sangria_reason, t.sangria_destination, t.transaction_at,
                   a.name AS unidade, u.full_name AS usuario, t.reversed_at, t.is_reversal
            FROM transactions t
            JOIN associations a ON a.id = t.association_id
            LEFT JOIN users u ON u.id = t.created_by
            WHERE {cond}
            ORDER BY t.transaction_at DESC LIMIT 1000
        """), params)).fetchall()
        return [{"id": str(r[0]), "amount": str(r[1]), "reason": r[2], "destination": r[3],
                 "transaction_at": str(r[4]), "unidade": r[5], "usuario": r[6],
                 "reversed": r[7] is not None, "is_reversal": r[8]} for r in rows]

    async def list_sessoes_conferidas(self, ids: list[str]) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT
                cs.id, a.name AS unidade, cs.opened_at, cs.closed_at,
                u_open.full_name AS usuario, u_review.full_name AS conferido_por,
                cs.origin,
                COALESCE(SUM(CASE WHEN t.type = 'income' AND NOT t.is_reversal THEN t.amount ELSE 0 END), 0) AS entradas,
                COALESCE(SUM(CASE WHEN t.type = 'expense' AND NOT t.is_reversal THEN t.amount ELSE 0 END), 0) AS saidas,
                COALESCE(SUM(CASE WHEN t.is_reversal THEN t.amount ELSE 0 END), 0) AS estornos,
                COALESCE(SUM(CASE WHEN t.type = 'income' AND pm.name ILIKE '%pix%' AND NOT t.is_reversal THEN t.amount ELSE 0 END), 0) AS bruto_pix,
                COALESCE(SUM(CASE WHEN t.type = 'income' AND (pm.name ILIKE '%dinheiro%' OR t.payment_method_id IS NULL) AND NOT t.is_reversal THEN t.amount ELSE 0 END), 0) AS bruto_dinheiro,
                COALESCE(SUM(CASE WHEN t.type = 'sangria' AND NOT t.is_reversal THEN t.amount ELSE 0 END), 0) AS baixas,
                cs.quebra_caixa, cs.difference AS sobra_falta,
                COUNT(DISTINCT men.id) AS qtd_mensalidades,
                cs.dinheiro_contado, cs.pix_contado, cs.quebra_motivo
            FROM cash_sessions cs
            JOIN associations a ON a.id = cs.association_id
            LEFT JOIN users u_open ON u_open.id = cs.opened_by
            LEFT JOIN users u_review ON u_review.id = cs.reviewed_by
            LEFT JOIN transactions t ON t.cash_session_id = cs.id
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            LEFT JOIN mensalidades men ON men.transaction_id = t.id
            WHERE cs.association_id = ANY(:ids) AND cs.status = 'conferido'
            GROUP BY cs.id, a.name, cs.opened_at, cs.closed_at, u_open.full_name,
                     u_review.full_name, cs.origin, cs.quebra_caixa, cs.difference,
                     cs.dinheiro_contado, cs.pix_contado, cs.quebra_motivo
            ORDER BY cs.opened_at DESC LIMIT 500
        """), {"ids": ids})).fetchall()
        out = []
        for r in rows:
            entradas, saidas = float(r[7]), float(r[8])
            baixas = float(r[12])
            out.append({
                "id": str(r[0]), "unidade": r[1], "opened_at": str(r[2]), "closed_at": str(r[3]) if r[3] else None,
                "usuario": r[4], "conferido_por": r[5], "origin": r[6] or "Sessão de Caixa",
                "entradas": entradas, "saidas": saidas, "estornos": float(r[9]),
                "bruto_pix": float(r[10]), "bruto_dinheiro": float(r[11]), "baixas": baixas,
                "liquido": round(entradas - saidas - baixas, 2),
                "quebra_caixa": float(r[13]) if r[13] is not None else None,
                "sobra_falta": float(r[14]) if r[14] is not None else None,
                "qtd_mensalidades": int(r[15]),
                "dinheiro_contado": float(r[16]) if r[16] is not None else None,
                "pix_contado": float(r[17]) if r[17] is not None else None,
                "quebra_motivo": r[18],
            })
        return out

    # ── Contas a Pagar ───────────────────────────────────────────────────

    async def list_payable_categorias(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text(
            "SELECT id, name, is_active FROM payable_categories WHERE empresa_id = :eid ORDER BY name"
        ), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "name": r[1], "is_active": r[2]} for r in rows]

    async def criar_payable_categoria(self, empresa_id, name: str, user_id) -> UUID:
        row = (await self.session.execute(text("""
            INSERT INTO payable_categories (id, empresa_id, name, is_active, created_by)
            VALUES (gen_random_uuid(), :eid, :name, TRUE, :uid)
            RETURNING id
        """), {"eid": str(empresa_id), "name": name, "uid": str(user_id)})).fetchone()
        return row[0]

    async def editar_payable_categoria(self, categoria_id: UUID, empresa_id, body, user_id) -> dict:
        sets, params = [], {"id": str(categoria_id), "eid": str(empresa_id)}
        if body.name is not None:
            sets.append("name = :name"); params["name"] = body.name
        if body.is_active is not None:
            sets.append("is_active = :active"); params["active"] = body.is_active
        if not sets:
            return {}
        sets.append("updated_at = NOW()")
        sets.append("updated_by = :uid"); params["uid"] = str(user_id)
        r = await self.session.execute(text(
            f"UPDATE payable_categories SET {', '.join(sets)} WHERE id = :id AND empresa_id = :eid"
        ), params)
        if r.rowcount == 0:
            raise NotFoundError("Categoria")
        return params

    async def list_produtos(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT id, code, name, description, preco_associado, preco_nao_associado, is_active
            FROM products WHERE empresa_id = :eid ORDER BY name
        """), {"eid": str(empresa_id)})).fetchall()
        return [
            {"id": str(r[0]), "code": r[1], "name": r[2], "description": r[3],
             "preco_associado": str(r[4]), "preco_nao_associado": str(r[5]), "is_active": r[6]}
            for r in rows
        ]

    async def editar_produto(self, produto_id: UUID, empresa_id, body, user_id) -> dict:
        prod = (await self.session.execute(text(
            "SELECT id, code, preco_associado FROM products WHERE id = :id AND empresa_id = :eid"
        ), {"id": str(produto_id), "eid": str(empresa_id)})).fetchone()
        if not prod:
            raise NotFoundError("Produto")

        if prod[1] == "mensalidade" and not body.force:
            old_default = prod[2]
            rows = (await self.session.execute(text("""
                SELECT a.id, a.name, s.default_mensalidade_amount
                FROM associations a
                JOIN association_settings s ON s.association_id = a.id
                WHERE a.empresa_id = :eid AND a.is_active = TRUE
            """), {"eid": str(empresa_id)})).fetchall()
            divergentes = [
                {"association_id": str(r[0]), "name": r[1], "valor_atual": str(r[2])}
                for r in rows if r[2] != old_default
            ]
            if divergentes:
                return {"conflito": True, "divergentes": divergentes, "novo_valor": str(body.preco_associado)}

        await self.session.execute(text("""
            UPDATE products SET preco_associado = :pa, preco_nao_associado = :pna,
                   is_active = COALESCE(:active, is_active), updated_at = now(), updated_by = :uid
            WHERE id = :id AND empresa_id = :eid
        """), {
            "pa": body.preco_associado, "pna": body.preco_nao_associado,
            "active": body.is_active, "id": str(produto_id), "eid": str(empresa_id),
            "uid": str(user_id),
        })

        if prod[1] == "mensalidade":
            if body.aplicar_divergentes:
                await self.session.execute(text("""
                    UPDATE association_settings SET default_mensalidade_amount = :val, updated_at = now()
                    WHERE association_id IN (SELECT id FROM associations WHERE empresa_id = :eid)
                """), {"val": body.preco_associado, "eid": str(empresa_id)})
            else:
                await self.session.execute(text("""
                    UPDATE association_settings SET default_mensalidade_amount = :val, updated_at = now()
                    WHERE association_id IN (SELECT id FROM associations WHERE empresa_id = :eid)
                      AND default_mensalidade_amount = :old_val
                """), {"val": body.preco_associado, "old_val": prod[2], "eid": str(empresa_id)})

        return {"ok": True}

    async def list_contas_pagar_templates(self, ids: list[str]) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT t.id, t.name, t.amount, t.due_day, t.is_active, a.name AS unidade, a.id AS association_id
            FROM contas_pagar_templates t
            JOIN associations a ON a.id = t.association_id
            WHERE t.association_id = ANY(:ids)
            ORDER BY t.is_active DESC, t.name
        """), {"ids": ids})).fetchall()
        return [
            {"id": str(r[0]), "name": r[1], "amount": float(r[2]), "due_day": r[3],
             "is_active": r[4], "unidade": r[5], "association_id": str(r[6])}
            for r in rows
        ]

    async def criar_conta_pagar_template(self, body, user_id) -> UUID:
        # escopo ja validado no router via _assert_assoc_da_empresa antes de chamar
        row = (await self.session.execute(text("""
            INSERT INTO contas_pagar_templates (association_id, payable_category_id, name, amount, due_day, created_by)
            VALUES (:aid, :cat, :name, :amount, :due_day, :uid)
            RETURNING id
        """), {
            "aid": str(body.association_id), "cat": str(body.payable_category_id) if body.payable_category_id else None,
            "name": body.name, "amount": body.amount, "due_day": body.due_day, "uid": str(user_id),
        })).fetchone()
        return row[0]

    async def atualizar_conta_pagar_template(self, template_id: UUID, ids: list[str], is_active: bool, user_id) -> None:
        row = (await self.session.execute(text(
            "UPDATE contas_pagar_templates SET is_active = :active, updated_at = NOW(), updated_by = :uid "
            "WHERE id = :id AND association_id = ANY(:ids) RETURNING id"
        ), {"active": is_active, "id": str(template_id), "ids": ids, "uid": str(user_id)})).fetchone()
        if not row:
            raise NotFoundError("Template")

    async def gerar_conta_pagar_do_template(self, template_id: UUID, ids: list[str], reference_month: str, user_id) -> UUID:
        tpl = (await self.session.execute(text(
            "SELECT association_id, payable_category_id, name, amount, due_day FROM contas_pagar_templates "
            "WHERE id = :id AND association_id = ANY(:ids) AND is_active = TRUE"
        ), {"id": str(template_id), "ids": ids})).fetchone()
        if not tpl:
            raise NotFoundError("Template (ou inativo)")

        dup = (await self.session.execute(text(
            "SELECT 1 FROM contas_pagar WHERE template_id = :tid AND reference_month = :ref"
        ), {"tid": str(template_id), "ref": reference_month})).scalar()
        if dup:
            raise ConflictError("Já existe conta gerada deste template neste mês.")

        year, month = map(int, reference_month.split("-"))
        due_day = min(tpl[4], 28)
        row = (await self.session.execute(text("""
            INSERT INTO contas_pagar (association_id, template_id, payable_category_id, description, amount, due_date, reference_month, created_by)
            VALUES (:aid, :tid, :cat, :desc, :amount, make_date(:yr, :mo, :day), :ref, :uid)
            RETURNING id
        """), {
            "aid": str(tpl[0]), "tid": str(template_id), "cat": str(tpl[1]) if tpl[1] else None,
            "desc": tpl[2], "amount": tpl[3], "yr": year, "mo": month, "day": due_day,
            "ref": reference_month, "uid": str(user_id),
        })).fetchone()
        return row[0]

    async def list_contas_pagar(self, ids: list[str], status_filter: str | None) -> list[dict]:
        cond = "c.association_id = ANY(:ids)"
        params: dict = {"ids": ids}
        if status_filter:
            cond += " AND c.status = :status"
            params["status"] = status_filter
        rows = (await self.session.execute(text(f"""
            SELECT c.id, c.description, a.name AS unidade, c.amount, c.amount_paid, c.status,
                   c.due_date, cat.name AS categoria, c.template_id IS NOT NULL AS recorrente, c.association_id
            FROM contas_pagar c
            JOIN associations a ON a.id = c.association_id
            LEFT JOIN payable_categories cat ON cat.id = c.payable_category_id
            WHERE {cond}
            ORDER BY c.due_date ASC
        """), params)).fetchall()
        return [
            {
                "id": str(r[0]), "description": r[1], "unidade": r[2],
                "amount": float(r[3]), "amount_paid": float(r[4]), "status": r[5],
                "due_date": str(r[6]), "categoria": r[7], "recorrente": r[8],
                "atrasada": r[5] != "paid" and r[6] < date.today(),
                "association_id": str(r[9]),
            }
            for r in rows
        ]

    async def criar_conta_pagar(self, body, user_id) -> UUID:
        row = (await self.session.execute(text("""
            INSERT INTO contas_pagar (association_id, payable_category_id, description, amount, due_date, created_by)
            VALUES (:aid, :cat, :desc, :amount, :due, :uid)
            RETURNING id
        """), {
            "aid": str(body.association_id), "cat": str(body.payable_category_id) if body.payable_category_id else None,
            "desc": body.description, "amount": body.amount, "due": body.due_date, "uid": str(user_id),
        })).fetchone()
        return row[0]

    async def baixar_conta_pagar(self, conta_id: UUID, ids: list[str], amount: Decimal,
                                  cash_session_id: UUID | None, user_id) -> dict:
        conta = (await self.session.execute(text(
            "SELECT c.association_id, c.amount, c.amount_paid, c.status, c.description, pc.name AS categoria "
            "FROM contas_pagar c LEFT JOIN payable_categories pc ON pc.id = c.payable_category_id "
            "WHERE c.id = :id AND c.association_id = ANY(:ids)"
        ), {"id": str(conta_id), "ids": ids})).fetchone()
        if not conta:
            raise NotFoundError("Conta a pagar")
        assoc_id, conta_amount, amount_paid, status, conta_desc, categoria_nome = conta
        if status == "paid":
            raise UnprocessableError("Conta já está totalmente paga.")
        novo_pago = amount_paid + amount
        if novo_pago > conta_amount:
            raise UnprocessableError(f"Valor excede o saldo devedor (R$ {conta_amount - amount_paid:.2f}).")

        desc = f"Baixa conta a pagar — {categoria_nome}: {conta_desc}" if categoria_nome else f"Baixa de conta a pagar: {conta_desc}"
        tx_row = (await self.session.execute(text("""
            INSERT INTO transactions (id, association_id, cash_session_id, type, amount, description, created_by)
            VALUES (gen_random_uuid(), :aid, :sid, 'expense', :amount, :desc, :uid)
            RETURNING id
        """), {
            "aid": str(assoc_id), "sid": str(cash_session_id) if cash_session_id else None,
            "amount": amount, "desc": desc, "uid": str(user_id),
        })).fetchone()

        await self.session.execute(text("""
            INSERT INTO conta_pagar_baixas (conta_pagar_id, transaction_id, amount, association_id, created_by)
            VALUES (:cid, :tid, :amount, :aid, :uid)
        """), {"cid": str(conta_id), "tid": str(tx_row[0]), "amount": amount, "aid": str(assoc_id), "uid": str(user_id)})

        novo_status = status_conta_pagar(conta_amount, novo_pago)
        await self.session.execute(text(
            "UPDATE contas_pagar SET amount_paid = :paid, status = :status, updated_at = NOW(), updated_by = :uid WHERE id = :id"
        ), {"paid": novo_pago, "status": novo_status, "id": str(conta_id), "uid": str(user_id)})
        return {"status": novo_status, "amount_paid": float(novo_pago)}

    async def estornar_baixa_conta_pagar(self, baixa_id: UUID, ids: list[str], reason: str, user, finance_service) -> dict:
        row = (await self.session.execute(text("""
            SELECT b.id, b.conta_pagar_id, b.transaction_id, b.amount, c.association_id, c.amount, c.amount_paid
            FROM conta_pagar_baixas b
            JOIN contas_pagar c ON c.id = b.conta_pagar_id
            WHERE b.id = :id AND c.association_id = ANY(:ids)
        """), {"id": str(baixa_id), "ids": ids})).fetchone()
        if not row:
            raise NotFoundError("Baixa")
        _, conta_id, transaction_id, baixa_amount, assoc_id, conta_amount, amount_paid = row

        if transaction_id:
            await finance_service.reverse_transaction(
                transaction_id=transaction_id,
                association_id=assoc_id,
                reversed_by=user.user_id,
                reason=f"Estorno de baixa de conta a pagar: {reason}",
            )

        await self.session.execute(text("DELETE FROM conta_pagar_baixas WHERE id = :id"), {"id": str(baixa_id)})

        novo_pago = amount_paid - baixa_amount
        novo_status = status_conta_pagar(conta_amount, novo_pago)
        await self.session.execute(text(
            "UPDATE contas_pagar SET amount_paid = :paid, status = :status, updated_at = NOW(), updated_by = :uid WHERE id = :id"
        ), {"paid": novo_pago, "status": novo_status, "id": str(conta_id), "uid": str(user.user_id)})
        return {"conta_id": conta_id, "status": novo_status, "amount_paid": float(novo_pago), "baixa_amount": baixa_amount}

    async def excluir_conta_pagar(self, conta_id: UUID, ids: list[str]) -> str:
        conta = (await self.session.execute(text(
            "SELECT amount_paid, description FROM contas_pagar WHERE id = :id AND association_id = ANY(:ids)"
        ), {"id": str(conta_id), "ids": ids})).fetchone()
        if not conta:
            raise NotFoundError("Conta a pagar")
        if conta[0] and conta[0] > 0:
            raise UnprocessableError("Conta já possui baixa registrada — estorne a baixa antes de excluir.")
        await self.session.execute(text("DELETE FROM contas_pagar WHERE id = :id"), {"id": str(conta_id)})
        return conta[1] or ""

    # ── Contas a Receber ─────────────────────────────────────────────────

    async def list_taxa_entrega_prevista(self, ids: list[str], fee_default: Decimal) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT r.id, r.full_name, a.name AS unidade, COUNT(p.id) AS qtd_pendente
            FROM residents r
            JOIN associations a ON a.id = r.association_id
            JOIN packages p ON p.resident_id = r.id
            WHERE r.association_id = ANY(:ids) AND r.type = 'guest'
              AND p.status IN ('received', 'notified')
            GROUP BY r.id, r.full_name, a.name
            ORDER BY r.full_name
        """), {"ids": ids})).fetchall()
        return [
            {"resident_id": str(r[0]), "resident_name": r[1], "unidade": r[2],
             "qtd_pendente": r[3], "valor_previsto": float(fee_default)}
            for r in rows
        ]

    # ── TI ───────────────────────────────────────────────────────────────

    async def open_cash_sessions_count(self, empresa_id) -> int:
        return (await self.session.execute(
            text("SELECT COUNT(*) FROM cash_sessions cs JOIN associations a ON a.id = cs.association_id WHERE a.empresa_id = :eid AND cs.status = 'open'"),
            {"eid": str(empresa_id)},
        )).scalar() or 0

    # ── Usuarios (Fase 11) ───────────────────────────────────────────────

    async def criar_usuario(self, body, current_role: str, empresa_id, user_id, hashed_password: str) -> UUID:
        if body.role in ("admin_master", "superadmin") and current_role not in ("admin_master", "superadmin"):
            raise ForbiddenError("Só admin_master ou superadmin pode criar outro admin_master.")

        target_assoc = empresa_id if body.association_id is None else body.association_id
        if body.association_id is not None:
            await self.assert_assoc_da_empresa(body.association_id, empresa_id)

        dup = (await self.session.execute(text(
            "SELECT 1 FROM users WHERE email = :e AND is_active = TRUE"
        ), {"e": body.email})).scalar()
        if dup:
            raise ConflictError("Já existe usuário ativo com este e-mail.")

        row = (await self.session.execute(text("""
            INSERT INTO users (id, empresa_id, association_id, full_name, email, phone, hashed_password, role, is_active, created_by)
            VALUES (gen_random_uuid(), :eid, :aid, :name, :email, :phone, :pw, CAST(:role AS user_role), TRUE, :uid)
            RETURNING id
        """), {
            "eid": str(empresa_id), "aid": str(target_assoc), "name": body.full_name,
            "email": body.email, "phone": body.phone, "pw": hashed_password, "role": body.role,
            "uid": str(user_id),
        })).fetchone()
        return row[0]

    async def editar_usuario(self, user_id_target: UUID, body, current, empresa_id) -> dict | None:
        alvo = (await self.session.execute(text(
            "SELECT empresa_id FROM users WHERE id = :id"
        ), {"id": str(user_id_target)})).fetchone()
        if not alvo or str(alvo[0]) != str(empresa_id):
            raise NotFoundError("Usuário")
        if (body.role is not None or body.is_active is not None) and str(user_id_target) == str(current.user_id) and not current.is_admin_master:
            raise ForbiddenError("Você não pode alterar seu próprio papel ou status de ativação.")

        sets, params = [], {"id": str(user_id_target)}
        if body.full_name is not None:
            sets.append("full_name = :name"); params["name"] = body.full_name
        if body.email is not None:
            dup = (await self.session.execute(text(
                "SELECT 1 FROM users WHERE email = :e AND is_active = TRUE AND id != :id"
            ), {"e": body.email, "id": str(user_id_target)})).scalar()
            if dup:
                raise ConflictError("Já existe usuário ativo com este e-mail.")
            sets.append("email = :email"); params["email"] = body.email
        if body.phone is not None:
            sets.append("phone = :phone"); params["phone"] = body.phone
        if body.role is not None:
            if body.role in ("admin_master", "superadmin") and current.role not in ("admin_master", "superadmin"):
                raise ForbiddenError("Só admin_master ou superadmin pode promover a admin_master.")
            sets.append("role = CAST(:role AS user_role)"); params["role"] = body.role
        if body.is_active is not None:
            sets.append("is_active = :active"); params["active"] = body.is_active
        if body.association_id is not None:
            await self.assert_assoc_da_empresa(body.association_id, empresa_id)
            sets.append("association_id = :aid"); params["aid"] = str(body.association_id)
        if not sets:
            return None
        sets.append("token_version = token_version + 1")
        sets.append("updated_at = NOW()")
        sets.append("updated_by = :uid"); params["uid"] = str(current.user_id)
        await self.session.execute(text(f"UPDATE users SET {', '.join(sets)} WHERE id = :id"), params)
        return params

    async def desativar_usuario(self, user_id_target: UUID, current_user_id, empresa_id) -> None:
        if str(user_id_target) == str(current_user_id):
            raise UnprocessableError("Você não pode desativar a si mesmo.")
        r = await self.session.execute(text("""
            UPDATE users SET is_active = FALSE, token_version = token_version + 1, updated_at = NOW()
            WHERE id = :id AND empresa_id = :eid
        """), {"id": str(user_id_target), "eid": str(empresa_id)})
        if r.rowcount == 0:
            raise NotFoundError("Usuário")

    async def excluir_usuario(self, user_id_target: UUID, current_user_id, empresa_id) -> None:
        if str(user_id_target) == str(current_user_id):
            raise UnprocessableError("Você não pode excluir a si mesmo.")
        alvo = (await self.session.execute(text(
            "SELECT empresa_id FROM users WHERE id = :id"
        ), {"id": str(user_id_target)})).fetchone()
        if not alvo or str(alvo[0]) != str(empresa_id):
            raise NotFoundError("Usuário")

        for tbl, col in _ACTIVITY_TABLES:
            n = (await self.session.execute(text(
                f"SELECT 1 FROM {tbl} WHERE {col} = :id LIMIT 1"
            ), {"id": str(user_id_target)})).scalar()
            if n:
                raise ConflictError("Usuário possui movimentação — use Desativar em vez de Excluir.")

        await self.session.execute(text("DELETE FROM refresh_tokens WHERE user_id = :id"), {"id": str(user_id_target)})
        await self.session.execute(text("DELETE FROM user_association_roles WHERE user_id = :id"), {"id": str(user_id_target)})
        await self.session.execute(text("DELETE FROM users WHERE id = :id AND empresa_id = :eid"),
                                    {"id": str(user_id_target), "eid": str(empresa_id)})

    # ── Categoria/forma de pagamento ─────────────────────────────────────

    async def list_categorias(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT id, name, type, description, is_active FROM transaction_categories
            WHERE empresa_id = :eid ORDER BY type, name
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "name": r[1], "type": r[2], "description": r[3], "is_active": r[4]} for r in rows]

    async def criar_categoria(self, empresa_id, body, user_id) -> UUID:
        row = (await self.session.execute(text("""
            INSERT INTO transaction_categories (id, association_id, empresa_id, name, type, description, color, is_active, created_by)
            VALUES (gen_random_uuid(), NULL, :eid, :name, CAST(:type AS transaction_type), :desc, :color, TRUE, :uid)
            RETURNING id
        """), {"eid": str(empresa_id), "name": body.name, "type": body.type,
               "desc": body.description, "color": body.color, "uid": str(user_id)})).fetchone()
        return row[0]

    async def editar_categoria(self, categoria_id: UUID, empresa_id, body, user_id) -> dict:
        sets, params = [], {"id": str(categoria_id), "eid": str(empresa_id)}
        if body.name is not None:
            sets.append("name = :name"); params["name"] = body.name
        if body.description is not None:
            sets.append("description = :desc"); params["desc"] = body.description
        if body.color is not None:
            sets.append("color = :color"); params["color"] = body.color
        if body.is_active is not None:
            sets.append("is_active = :active"); params["active"] = body.is_active
        if not sets:
            return {}
        sets.append("updated_at = NOW()")
        sets.append("updated_by = :uid"); params["uid"] = str(user_id)
        r = await self.session.execute(text(
            f"UPDATE transaction_categories SET {', '.join(sets)} WHERE id = :id AND empresa_id = :eid"
        ), params)
        if r.rowcount == 0:
            raise NotFoundError("Categoria")
        return params

    async def list_formas(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT id, name, is_active FROM payment_methods
            WHERE empresa_id = :eid ORDER BY name
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "name": r[1], "is_active": r[2]} for r in rows]

    async def criar_forma(self, empresa_id, name: str, user_id) -> UUID:
        row = (await self.session.execute(text("""
            INSERT INTO payment_methods (id, association_id, empresa_id, name, is_active, created_by)
            VALUES (gen_random_uuid(), NULL, :eid, :name, TRUE, :uid)
            RETURNING id
        """), {"eid": str(empresa_id), "name": name, "uid": str(user_id)})).fetchone()
        return row[0]

    async def editar_forma(self, forma_id: UUID, empresa_id, body, user_id) -> dict:
        sets, params = [], {"id": str(forma_id), "eid": str(empresa_id)}
        if body.name is not None:
            sets.append("name = :name"); params["name"] = body.name
        if body.is_active is not None:
            sets.append("is_active = :active"); params["active"] = body.is_active
        if not sets:
            return {}
        sets.append("updated_at = NOW()")
        sets.append("updated_by = :uid"); params["uid"] = str(user_id)
        r = await self.session.execute(text(
            f"UPDATE payment_methods SET {', '.join(sets)} WHERE id = :id AND empresa_id = :eid"
        ), params)
        if r.rowcount == 0:
            raise NotFoundError("Forma de pagamento")
        return params

    # ── Permissoes ───────────────────────────────────────────────────────

    async def get_access_groups(self, empresa_id) -> dict | None:
        row = (await self.session.execute(text(
            "SELECT access_groups FROM empresas WHERE id = :eid"
        ), {"eid": str(empresa_id)})).fetchone()
        return row[0] if row and row[0] else None  # falsy (None/{}) cai no default do router

    async def put_access_groups(self, empresa_id, access_groups: dict) -> None:
        await self.session.execute(text(
            "UPDATE empresas SET access_groups = CAST(:ag AS JSONB), updated_at = NOW() WHERE id = :eid"
        ), {"ag": _json.dumps(access_groups), "eid": str(empresa_id)})

    # ── Auditoria ────────────────────────────────────────────────────────

    async def list_auditoria(self, empresa_id, limit: int) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT al.created_at, al.action, al.entity, u.full_name, a.name AS unidade
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.user_id
            LEFT JOIN associations a ON a.id = al.association_id
            WHERE a.empresa_id = :eid OR al.empresa_id = :eid
            ORDER BY al.created_at DESC LIMIT :lim
        """), {"eid": str(empresa_id), "lim": min(limit, 500)})).fetchall()
        return [{"created_at": str(r[0]), "action": r[1], "entity": r[2],
                 "user": r[3], "unidade": r[4]} for r in rows]

    # ── Avisos ───────────────────────────────────────────────────────────

    async def enviar_aviso(self, empresa_id, title: str, body: str) -> int:
        r = await self.session.execute(text("""
            INSERT INTO notifications (id, association_id, empresa_id, user_id, title, body, type)
            SELECT gen_random_uuid(), u.association_id, :eid, u.id, :title, :body, 'broadcast'
            FROM users u
            WHERE u.empresa_id = :eid AND u.is_active = TRUE
        """), {"eid": str(empresa_id), "title": title, "body": body})
        return r.rowcount

    async def list_avisos(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT title, body, MIN(created_at) AS enviado_em, COUNT(*) AS destinatarios
            FROM notifications
            WHERE empresa_id = :eid AND type = 'broadcast'
            GROUP BY title, body ORDER BY enviado_em DESC LIMIT 100
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"title": r[0], "body": r[1], "enviado_em": str(r[2]), "destinatarios": r[3]} for r in rows]

    # ── Inventario de encomendas ─────────────────────────────────────────

    async def gerar_inventario_encomendas(self, empresa_id, association_id: UUID, ref: datetime, user_id) -> tuple[UUID, int]:
        rows = (await self.session.execute(text("""
            SELECT p.id, p.sender_name, p.carrier_name, p.object_type, p.tracking_code,
                   p.received_at, r.full_name AS morador
            FROM packages p
            LEFT JOIN residents r ON r.id = p.resident_id
            WHERE p.association_id = :aid
              AND p.received_at <= :ref
              AND (p.delivered_at IS NULL OR p.delivered_at > :ref)
              AND (p.returned_at IS NULL OR p.returned_at > :ref)
            ORDER BY p.received_at
        """), {"aid": str(association_id), "ref": ref})).fetchall()
        items = [{"id": str(r[0]), "sender_name": r[1], "carrier_name": r[2], "object_type": r[3],
                  "tracking_code": r[4], "received_at": str(r[5]), "morador": r[6]} for r in rows]
        row = (await self.session.execute(text("""
            INSERT INTO package_inventories (id, empresa_id, association_id, reference_at, total, items, created_by)
            VALUES (gen_random_uuid(), :eid, :aid, :ref, :total, CAST(:items AS jsonb), :uid)
            RETURNING id
        """), {"eid": str(empresa_id), "aid": str(association_id), "ref": ref,
               "total": len(items), "items": _json.dumps(items), "uid": str(user_id)})).fetchone()
        return row[0], len(items)

    async def list_inventario_encomendas(self, empresa_id) -> list[dict]:
        rows = (await self.session.execute(text("""
            SELECT pi.id, a.name AS unidade, pi.reference_at, pi.total, pi.created_at, u.full_name AS por
            FROM package_inventories pi
            JOIN associations a ON a.id = pi.association_id
            LEFT JOIN users u ON u.id = pi.created_by
            WHERE pi.empresa_id = :eid
            ORDER BY pi.created_at DESC LIMIT 200
        """), {"eid": str(empresa_id)})).fetchall()
        return [{"id": str(r[0]), "unidade": r[1], "reference_at": str(r[2]), "total": r[3],
                 "created_at": str(r[4]), "por": r[5]} for r in rows]

    async def detalhe_inventario_encomendas(self, inv_id: UUID, empresa_id) -> dict:
        row = (await self.session.execute(text("""
            SELECT pi.items, pi.total, pi.reference_at, a.name
            FROM package_inventories pi JOIN associations a ON a.id = pi.association_id
            WHERE pi.id = :id AND pi.empresa_id = :eid
        """), {"id": str(inv_id), "eid": str(empresa_id)})).fetchone()
        if not row:
            raise NotFoundError("Inventário")
        return {"items": row[0], "total": row[1], "reference_at": str(row[2]), "unidade": row[3]}
