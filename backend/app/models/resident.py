from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

try:
    from sqlalchemy.dialects.postgresql import JSONB
    _json = JSONB
except ImportError:
    from sqlalchemy import JSON
    _json = JSON


class ResidentType(str, Enum):
    member = "member"
    guest = "guest"


class ResidentStatus(str, Enum):
    active = "active"
    inactive = "inactive"
    suspended = "suspended"


class Resident(SQLModel, table=True):
    __tablename__ = "residents"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    type: ResidentType = Field(default=ResidentType.member, sa_column=Column(String, nullable=False, default=ResidentType.member))
    status: ResidentStatus = Field(default=ResidentStatus.active, sa_column=Column(String, nullable=False, default=ResidentStatus.active))

    # --- identification ---
    full_name: str = Field(max_length=255)
    cpf: str | None = Field(default=None, max_length=14)
    rg: str | None = Field(default=None, max_length=20)
    date_of_birth: date | None = None
    photo_url: str | None = None
    race: str | None = Field(default=None, max_length=30)
    education_level: str | None = Field(default=None, max_length=50)

    # --- contact ---
    email: str | None = Field(default=None, max_length=255)
    phone_primary: str | None = Field(default=None, max_length=20)
    phone_secondary: str | None = Field(default=None, max_length=20)

    # --- unit (within condominium) ---
    unit: str | None = Field(default=None, max_length=50)
    block: str | None = Field(default=None, max_length=50)
    parking_spot: str | None = Field(default=None, max_length=50)

    # --- full address ---
    address_cep: str | None = Field(default=None, max_length=9)
    address_street: str | None = Field(default=None, max_length=255)
    address_number: str | None = Field(default=None, max_length=20)
    address_complement: str | None = Field(default=None, max_length=100)
    address_city: str | None = Field(default=None, max_length=100)
    address_state: str | None = Field(default=None, max_length=2)

    # --- housing profile ---
    address_rooms: int | None = None
    address_location: str | None = Field(default=None, max_length=50)
    address_access: list[str] = Field(default=[], sa_column=Column(_json))
    uses_public_transport: bool | None = None
    transport_distance: str | None = Field(default=None, max_length=50)
    household_count: int | None = None
    household_profiles: list[str] = Field(default=[], sa_column=Column(_json))
    internet_access: str | None = Field(default=None, max_length=50)
    has_sewage: bool | None = None
    neighborhood_problems: list[str] = Field(default=[], sa_column=Column(_json))
    main_priority_request: str | None = None

    # --- guest link ---
    responsible_id: UUID | None = Field(default=None, foreign_key="residents.id")

    # --- membership ---
    ownership_type: str | None = Field(default=None, max_length=50)
    move_in_date: date | None = None
    move_out_date: date | None = None
    is_member_confirmed: bool = Field(default=False)
    wants_to_join: bool | None = None
    monthly_payment_day: int | None = None

    # --- legal ---
    terms_accepted: bool = Field(default=False)
    lgpd_accepted: bool = Field(default=False)

    notes: str | None = None
    created_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
