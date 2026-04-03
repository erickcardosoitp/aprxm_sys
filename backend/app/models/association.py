from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class Association(SQLModel, table=True):
    __tablename__ = "associations"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=255)
    slug: str = Field(max_length=100, unique=True, index=True)
    cnpj: str | None = Field(default=None, max_length=18)
    address_street: str | None = Field(default=None, max_length=255)
    address_number: str | None = Field(default=None, max_length=20)
    address_complement: str | None = Field(default=None, max_length=100)
    address_district: str | None = Field(default=None, max_length=100)
    address_city: str | None = Field(default=None, max_length=100)
    address_state: str | None = Field(default=None, max_length=2)
    address_zip: str | None = Field(default=None, max_length=9)
    phone: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=255)
    logo_url: str | None = None
    is_active: bool = Field(default=True)
    plan_name: str = Field(default="basic", max_length=50)
    plan_expires_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
