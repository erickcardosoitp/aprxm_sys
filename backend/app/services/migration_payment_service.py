from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import UnprocessableError
from app.models.migration_payment import MigrationPayment, MigrationPaymentTipo


class MigrationPaymentService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        association_id: UUID,
        resident_id: UUID,
        competencia: str,
        tipo: MigrationPaymentTipo,
        created_by: UUID,
        valor_pago: Decimal | None = None,
        data_pagamento: date | None = None,
    ) -> MigrationPayment:
        mp = MigrationPayment(
            association_id=association_id,
            resident_id=resident_id,
            competencia=competencia,
            tipo=tipo,
            created_by=created_by,
            valor_pago=valor_pago,
            data_pagamento=data_pagamento,
        )
        self._session.add(mp)
        try:
            await self._session.flush()
        except IntegrityError:
            await self._session.rollback()
            raise UnprocessableError(f"Registro de migração para {competencia} já existe.")
        return mp

    async def bulk_create_until(
        self,
        association_id: UUID,
        resident_id: UUID,
        quitado_ate: str,
        tipo: MigrationPaymentTipo,
        created_by: UUID,
        quitado_de: str | None = None,
        valor_pago: Decimal | None = None,
        data_pagamento: date | None = None,
    ) -> list[MigrationPayment]:
        year_end, month_end = map(int, quitado_ate.split("-"))
        if quitado_de:
            year_start, month_start = map(int, quitado_de.split("-"))
        else:
            year_start, month_start = 2000, 1

        existing = await self.list_by_resident(association_id, resident_id)
        existing_competencias = {mp.competencia for mp in existing}

        created: list[MigrationPayment] = []
        year, month = year_start, month_start
        while (year, month) <= (year_end, month_end):
            comp = f"{year:04d}-{month:02d}"
            if comp not in existing_competencias:
                mp = MigrationPayment(
                    association_id=association_id,
                    resident_id=resident_id,
                    competencia=comp,
                    tipo=tipo,
                    created_by=created_by,
                    valor_pago=valor_pago,
                    data_pagamento=data_pagamento,
                )
                self._session.add(mp)
                created.append(mp)
            if month == 12:
                year, month = year + 1, 1
            else:
                month += 1

        if created:
            await self._session.flush()
        return created

    async def list_by_resident(
        self, association_id: UUID, resident_id: UUID
    ) -> list[MigrationPayment]:
        stmt = (
            select(MigrationPayment)
            .where(
                MigrationPayment.association_id == association_id,
                MigrationPayment.resident_id == resident_id,
            )
            .order_by(MigrationPayment.competencia.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def exists(
        self, association_id: UUID, resident_id: UUID, competencia: str
    ) -> bool:
        stmt = select(MigrationPayment).where(
            MigrationPayment.association_id == association_id,
            MigrationPayment.resident_id == resident_id,
            MigrationPayment.competencia == competencia,
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def delete(
        self, association_id: UUID, resident_id: UUID, competencia: str
    ) -> bool:
        stmt = select(MigrationPayment).where(
            MigrationPayment.association_id == association_id,
            MigrationPayment.resident_id == resident_id,
            MigrationPayment.competencia == competencia,
        )
        result = await self._session.execute(stmt)
        mp = result.scalar_one_or_none()
        if not mp:
            return False
        await self._session.delete(mp)
        await self._session.flush()
        return True
