from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class Empresa(SQLModel, table=True):
    __tablename__ = "empresas"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=255)
    slug: str = Field(max_length=100, unique=True, index=True)
    financeiro_centralizado: bool = Field(default=False)
    plan_name: str = Field(default="basic", max_length=50)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
