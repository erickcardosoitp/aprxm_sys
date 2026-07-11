from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class MigrationPaymentTipo(str, Enum):
    mensalidade = "mensalidade"
    acordo = "acordo"


class MigrationPayment(SQLModel, table=True):
    __tablename__ = "migration_payments"
    __table_args__ = (
        UniqueConstraint("association_id", "resident_id", "competencia", name="uq_migration_payment_period"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id", index=True)

    competencia: str = Field(max_length=7)  # "YYYY-MM"
    tipo: MigrationPaymentTipo = Field(
        sa_column=Column(SAEnum(MigrationPaymentTipo, name="migration_payment_tipo", create_type=True), nullable=False)
    )
    origem: str = Field(default="migracao", max_length=50)
    valor_pago: Decimal | None = Field(default=None, decimal_places=2, max_digits=10)
    data_pagamento: date | None = None
    proof_url: str | None = None

    created_by: UUID = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
