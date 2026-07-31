from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

try:
    from sqlalchemy.dialects.postgresql import JSONB
    _json = JSONB
except ImportError:
    from sqlalchemy import JSON
    _json = JSON


class CommunityPlaceCategory(str, Enum):
    lanchonete = "lanchonete"
    restaurante = "restaurante"
    mercado = "mercado"
    servico = "servico"
    saude = "saude"
    beleza = "beleza"
    educacao = "educacao"
    outro = "outro"


class CommunityPlace(SQLModel, table=True):
    __tablename__ = "community_places"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)

    category: CommunityPlaceCategory = Field(default=CommunityPlaceCategory.outro, sa_column=Column(SAEnum(CommunityPlaceCategory, name="community_place_category", create_type=False), nullable=False))
    name: str = Field(max_length=150)
    description: str | None = None
    phone: str | None = Field(default=None, max_length=20)
    whatsapp: str | None = Field(default=None, max_length=20)
    address: str | None = None
    image_urls: list[str] = Field(default=[], sa_column=Column(_json))
    is_active: bool = Field(default=True)

    owner_resident_id: UUID | None = Field(default=None, foreign_key="residents.id")
    status: str = Field(default="approved", max_length=20)
    moderation_reason: str | None = None

    created_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CommunityPlaceRating(SQLModel, table=True):
    __tablename__ = "community_place_ratings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    place_id: UUID = Field(foreign_key="community_places.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id", index=True)
    stars: int

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CommunityPlaceUpdateRequest(SQLModel, table=True):
    __tablename__ = "community_place_update_requests"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    place_id: UUID = Field(foreign_key="community_places.id", index=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id")

    changes: dict = Field(sa_column=Column(_json))
    notes: str | None = None
    status: str = Field(default="pending", max_length=20)
    reviewed_by: UUID | None = Field(default=None, foreign_key="users.id")
    reviewed_at: datetime | None = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
