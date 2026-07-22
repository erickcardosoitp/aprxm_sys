from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ContaPagarTemplate(SQLModel, table=True):
    __tablename__ = "contas_pagar_templates"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    category_id: UUID | None = Field(default=None, foreign_key="transaction_categories.id")
    name: str
    amount: Decimal = Field(decimal_places=2, max_digits=12, gt=0)
    due_day: int = Field(ge=1, le=28)
    is_active: bool = Field(default=True)
    created_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ContaPagar(SQLModel, table=True):
    __tablename__ = "contas_pagar"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    template_id: UUID | None = Field(default=None, foreign_key="contas_pagar_templates.id")
    category_id: UUID | None = Field(default=None, foreign_key="transaction_categories.id")
    description: str
    amount: Decimal = Field(decimal_places=2, max_digits=12, gt=0)
    amount_paid: Decimal = Field(default=Decimal("0"), decimal_places=2, max_digits=12)
    due_date: date
    status: str = Field(default="pending", max_length=20)  # pending | partial | paid
    reference_month: str | None = Field(default=None, max_length=7)  # YYYY-MM, se gerada de template
    created_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ContaPagarBaixa(SQLModel, table=True):
    __tablename__ = "conta_pagar_baixas"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    conta_pagar_id: UUID = Field(foreign_key="contas_pagar.id", index=True)
    transaction_id: UUID | None = Field(default=None, foreign_key="transactions.id")
    amount: Decimal = Field(decimal_places=2, max_digits=12, gt=0)
    paid_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: UUID | None = Field(default=None, foreign_key="users.id")
