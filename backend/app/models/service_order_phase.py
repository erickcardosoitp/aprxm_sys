from datetime import datetime
from uuid import UUID, uuid4
from sqlmodel import Field, SQLModel


class ServiceOrderPhase(SQLModel, table=True):
    __tablename__ = "service_order_phases"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    name: str = Field(max_length=100)
    color: str = Field(default="#9333ea", max_length=7)
    sort_order: int = Field(default=0)
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
