from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class MensalidadeStatus(str, Enum):
    pending = "pending"
    paid = "paid"
    overdue = "overdue"


class Mensalidade(SQLModel, table=True):
    __tablename__ = "mensalidades"
    __table_args__ = (
        UniqueConstraint("association_id", "resident_id", "reference_month", name="uq_mensalidade_period"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id", index=True)

    reference_month: str = Field(max_length=7)  # "YYYY-MM"
    due_date: date
    amount: Decimal = Field(decimal_places=2, max_digits=10, gt=0)

    status: MensalidadeStatus = Field(
        default=MensalidadeStatus.pending,
        sa_column=Column(SAEnum(MensalidadeStatus, name="mensalidade_status", create_type=False), nullable=False),
    )

    paid_at: datetime | None = None
    transaction_id: UUID | None = Field(default=None, foreign_key="transactions.id")
    notes: str | None = None

    created_by: UUID = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
