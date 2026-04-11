from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnprocessableError
from app.models.finance import Transaction, TransactionType


class TransferService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def transfer(
        self,
        origem_id: UUID,
        destino_id: UUID,
        amount: Decimal,
        descricao: str | None,
        current_user_id: UUID,
        current_user_role: str,
    ) -> dict:
        if current_user_role not in ("admin_master", "superadmin"):
            raise UnprocessableError("Apenas admin_master pode realizar transferências entre associações.")

        if origem_id == destino_id:
            raise UnprocessableError("Origem e destino não podem ser a mesma associação.")

        # Load both associations with settings
        row = await self._session.execute(
            text("""
                SELECT a.id, a.name, a.presidente_user_id,
                       COALESCE(s.permitir_transferencia, false) AS permite
                  FROM associations a
                  LEFT JOIN association_settings s ON s.association_id = a.id
                 WHERE a.id IN (:o, :d)
            """),
            {"o": str(origem_id), "d": str(destino_id)},
        )
        rows = {str(r[0]): {"name": r[1], "presidente_user_id": r[2], "permite": r[3]}
                for r in row.fetchall()}

        if str(origem_id) not in rows:
            raise UnprocessableError("Associação de origem não encontrada.")
        if str(destino_id) not in rows:
            raise UnprocessableError("Associação de destino não encontrada.")

        origem = rows[str(origem_id)]
        destino = rows[str(destino_id)]

        # Validate same president
        if origem["presidente_user_id"] != destino["presidente_user_id"]:
            raise UnprocessableError(
                "Transferência não permitida: as associações pertencem a presidentes diferentes."
            )
        if origem["presidente_user_id"] is None:
            raise UnprocessableError("Associação de origem não possui presidente definido.")

        presidente_id = origem["presidente_user_id"]

        # Validate current user is the president (or superadmin)
        if current_user_role != "superadmin" and str(current_user_id) != str(presidente_id):
            raise UnprocessableError("Você não é o presidente dessas associações.")

        # Validate permitir_transferencia
        if not origem["permite"]:
            raise UnprocessableError(f"Associação '{origem['name']}' não permite transferências.")
        if not destino["permite"]:
            raise UnprocessableError(f"Associação '{destino['name']}' não permite transferências.")

        # Validate president has more than one association
        count_result = await self._session.execute(
            text("SELECT COUNT(*) FROM associations WHERE presidente_user_id = :pid"),
            {"pid": str(presidente_id)},
        )
        assoc_count = count_result.scalar()
        if assoc_count < 2:
            raise UnprocessableError("O presidente deve ser responsável por mais de uma associação para realizar transferências.")

        # Open cash sessions required
        origem_session = await self._get_open_session(origem_id)
        destino_session = await self._get_open_session(destino_id)

        desc_saida = descricao or f"Transferência enviada para {destino['name']}"
        desc_entrada = descricao or f"Transferência recebida de {origem['name']}"

        from datetime import datetime

        tx_saida = Transaction(
            association_id=origem_id,
            cash_session_id=origem_session,
            type=TransactionType.expense,
            amount=amount,
            description=desc_saida,
            is_transfer=True,
            created_by=current_user_id,
            transaction_at=datetime.utcnow(),
        )
        self._session.add(tx_saida)
        await self._session.flush()

        tx_entrada = Transaction(
            association_id=destino_id,
            cash_session_id=destino_session,
            type=TransactionType.income,
            amount=amount,
            description=desc_entrada,
            is_transfer=True,
            transfer_counterpart_id=tx_saida.id,
            created_by=current_user_id,
            transaction_at=datetime.utcnow(),
        )
        self._session.add(tx_entrada)
        await self._session.flush()

        # Back-link
        tx_saida.transfer_counterpart_id = tx_entrada.id
        self._session.add(tx_saida)
        await self._session.flush()

        return {
            "tx_saida_id": str(tx_saida.id),
            "tx_entrada_id": str(tx_entrada.id),
            "origem": origem["name"],
            "destino": destino["name"],
            "amount": str(amount),
        }

    async def _get_open_session(self, association_id: UUID) -> UUID:
        result = await self._session.execute(
            text("""
                SELECT id FROM cash_sessions
                 WHERE association_id = :aid AND status = 'open'
                 ORDER BY opened_at DESC LIMIT 1
            """),
            {"aid": str(association_id)},
        )
        row = result.fetchone()
        if not row:
            raise UnprocessableError(
                f"Associação {association_id} não possui caixa aberto para receber a transferência."
            )
        return UUID(str(row[0]))
