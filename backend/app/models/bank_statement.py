from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4
from sqlmodel import Field, SQLModel


class BankStatement(SQLModel, table=True):
    __tablename__ = "bank_statements"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    bank: str = Field(max_length=20)
    date: date
    amount: Decimal = Field(decimal_places=2, max_digits=12)
    name: str | None = Field(default=None, max_length=255)
    cpf: str | None = Field(default=None, max_length=14)
    tipo: str = Field(default="entrada", max_length=10)
    description: str | None = None
    conciliado: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Reconciliation(SQLModel, table=True):
    __tablename__ = "reconciliations"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    statement_id: UUID = Field(foreign_key="bank_statements.id")
    transaction_id: UUID | None = Field(default=None, foreign_key="transactions.id")
    score: int = Field(default=0)
    status: str = Field(default="pendente", max_length=20)
    created_at: datetime = Field(default_factory=datetime.utcnow)
