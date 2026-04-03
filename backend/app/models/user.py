from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel


class UserRole(str, Enum):
    superadmin = "superadmin"
    admin = "admin"
    operator = "operator"
    viewer = "viewer"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    full_name: str = Field(max_length=255)
    email: str = Field(max_length=255, index=True)
    phone: str | None = Field(default=None, max_length=20)
    hashed_password: str
    role: UserRole = Field(default=UserRole.operator, sa_column=Column(String, nullable=False, default=UserRole.operator))
    avatar_url: str | None = None
    is_active: bool = Field(default=True)
    last_login_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
