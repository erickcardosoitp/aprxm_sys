from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class PortaAPortaLead(SQLModel, table=True):
    __tablename__ = "porta_a_porta_leads"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(nullable=False)
    operator_id: UUID | None = Field(default=None, nullable=True, foreign_key="users.id")
    lancado_por: str | None = Field(default=None, max_length=200)

    full_name: str = Field(max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    cpf: str | None = Field(default=None, max_length=14)
    address_street: str = Field(max_length=200)
    address_number: str = Field(max_length=20)
    address_complement: str | None = Field(default=None, max_length=100)

    # JSON-encoded list of dependents: [{name, phone, cpf}]
    dependents: str = Field(default="[]", sa_column_kwargs={"server_default": "'[]'"})

    status: str = Field(default="pending")         # pending | paid | agreement | cancelled
    payment_type: str = Field(default="avista")    # avista | parcelado
    total_installments: int = Field(default=1)
    monthly_fee: Decimal = Field(default=Decimal("20.00"), decimal_places=2, max_digits=10)

    notes: str | None = None
    resident_id: UUID | None = None  # set after resident is created

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PortaAPortaPayment(SQLModel, table=True):
    __tablename__ = "porta_a_porta_payments"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(nullable=False)
    lead_id: UUID = Field(nullable=False, foreign_key="porta_a_porta_leads.id")

    installment_number: int = Field(default=1)
    total_installments: int = Field(default=1)
    amount: Decimal = Field(decimal_places=2, max_digits=10)
    due_date: date
    paid_at: datetime | None = None
    status: str = Field(default="pending")  # pending | paid
    payment_method: str | None = None
    notes: str | None = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
