from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class PainelAdmin(SQLModel, table=True):
    __tablename__ = "painel_admins"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    email: str = Field(max_length=255, unique=True, index=True)
    hashed_password: str
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
