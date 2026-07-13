from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class UserRole(str, Enum):
    superadmin = "superadmin"
    admin_master = "admin_master"
    admin = "admin"
    diretoria = "diretoria"
    conferente = "conferente"
    diretoria_adjunta = "diretoria_adjunta"
    operator = "operator"
    viewer = "viewer"
    conselho = "conselho"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    full_name: str = Field(max_length=255)
    email: str = Field(max_length=255, index=True)
    phone: str | None = Field(default=None, max_length=20)
    hashed_password: str
    role: UserRole = Field(default=UserRole.operator, sa_column=Column(SAEnum(UserRole, name='user_role', create_type=False), nullable=False))
    avatar_url: str | None = None
    is_active: bool = Field(default=True)
    simplifica_mode: bool = Field(default=False)
    restrict_edit_tx: bool = Field(default=False)
    restrict_reverse_tx: bool = Field(default=False)
    require_own_cash_session: bool = Field(default=False)
    token_version: int = Field(default=0)
    last_login_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
