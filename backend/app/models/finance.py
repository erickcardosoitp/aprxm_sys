from datetime import datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

try:
    from sqlalchemy.dialects.postgresql import JSONB
    json_col = Column(JSONB)
except ImportError:
    from sqlalchemy import JSON
    json_col = Column(JSON)


class TransactionType(str, Enum):
    income = "income"
    expense = "expense"
    sangria = "sangria"


class IncomeSubtype(str, Enum):
    proof_of_residence = "proof_of_residence"
    delivery_fee = "delivery_fee"
    mensalidade = "mensalidade"
    other = "other"


class CashSessionStatus(str, Enum):
    open = "open"
    closed = "closed"


class TransactionCategory(SQLModel, table=True):
    __tablename__ = "transaction_categories"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    name: str = Field(max_length=100)
    description: str | None = None
    type: TransactionType = Field(sa_column=Column(SAEnum(TransactionType, name='transaction_type', create_type=False), nullable=False))
    color: str | None = Field(default=None, max_length=7)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PaymentMethod(SQLModel, table=True):
    __tablename__ = "payment_methods"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    name: str = Field(max_length=100)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CashSession(SQLModel, table=True):
    __tablename__ = "cash_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    opened_by: UUID = Field(foreign_key="users.id")
    closed_by: UUID | None = Field(default=None, foreign_key="users.id")
    status: CashSessionStatus = Field(default=CashSessionStatus.open, sa_column=Column(SAEnum(CashSessionStatus, name='cash_session_status', create_type=False), nullable=False))
    opening_balance: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    closing_balance: Decimal | None = Field(default=None, decimal_places=2, max_digits=12)
    expected_balance: Decimal | None = Field(default=None, decimal_places=2, max_digits=12)
    difference: Decimal | None = Field(default=None, decimal_places=2, max_digits=12)
    notes: str | None = None
    opened_at: datetime = Field(default_factory=datetime.utcnow)
    closed_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Transaction(SQLModel, table=True):
    __tablename__ = "transactions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    cash_session_id: UUID = Field(foreign_key="cash_sessions.id", index=True)
    category_id: UUID | None = Field(default=None, foreign_key="transaction_categories.id")
    payment_method_id: UUID | None = Field(default=None, foreign_key="payment_methods.id")
    resident_id: UUID | None = Field(default=None, foreign_key="residents.id")

    type: TransactionType = Field(sa_column=Column(SAEnum(TransactionType, name='transaction_type', create_type=False), nullable=False))
    amount: Decimal = Field(decimal_places=2, max_digits=12, gt=0)
    description: str
    reference_number: str | None = Field(default=None, max_length=100)

    # sangria fields
    is_sangria: bool = Field(default=False)
    sangria_reason: str | None = None
    sangria_destination: str | None = Field(default=None, max_length=255)
    receipt_photo_url: str | None = None

    income_subtype: IncomeSubtype | None = Field(default=None, sa_column=Column(SAEnum(IncomeSubtype, name='income_subtype', create_type=False), nullable=True))

    package_id: UUID | None = Field(default=None, foreign_key="packages.id")

    # reversal (estorno)
    is_reversal: bool = Field(default=False)
    reversal_of_id: UUID | None = Field(default=None)  # references transactions.id
    reversal_reason: str | None = None
    reversed_by: UUID | None = Field(default=None, foreign_key="users.id")
    reversed_at: datetime | None = None

    created_by: UUID = Field(foreign_key="users.id")
    transaction_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
