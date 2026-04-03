from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlmodel import Field, SQLModel


class AssociationSettings(SQLModel, table=True):
    __tablename__ = "association_settings"

    association_id: UUID = Field(primary_key=True, foreign_key="associations.id")
    default_cash_balance: Decimal = Field(default=Decimal("200.00"), decimal_places=2, max_digits=10)
    max_cash_before_sangria: Decimal = Field(default=Decimal("500.00"), decimal_places=2, max_digits=10)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    updated_by: UUID | None = Field(default=None, foreign_key="users.id")
