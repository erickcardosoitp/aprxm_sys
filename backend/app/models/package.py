from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

try:
    from sqlalchemy.dialects.postgresql import JSONB
    _json_type = JSONB
except ImportError:
    from sqlalchemy import JSON
    _json_type = JSON


class PackageStatus(str, Enum):
    received = "received"
    notified = "notified"
    delivered = "delivered"
    returned = "returned"


class Package(SQLModel, table=True):
    __tablename__ = "packages"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    resident_id: UUID | None = Field(default=None, foreign_key="residents.id")

    status: PackageStatus = Field(default=PackageStatus.received, sa_column=Column(SAEnum(PackageStatus, name='package_status', create_type=False), nullable=False))

    # sender / carrier
    sender_name: str | None = Field(default=None, max_length=255)
    carrier_name: str | None = Field(default=None, max_length=100)
    tracking_code: str | None = Field(default=None, max_length=100, index=True)
    object_type: str | None = Field(default=None, max_length=100)

    # unit routing (denormalized)
    unit: str | None = Field(default=None, max_length=50)
    block: str | None = Field(default=None, max_length=50)

    # photos: list of {url, label, taken_at}
    photo_urls: list[dict[str, Any]] = Field(default=[], sa_column=Column(_json_type))

    # delivery fee
    has_delivery_fee: bool = Field(default=False)
    delivery_fee_amount: Decimal | None = Field(default=None, decimal_places=2, max_digits=8)
    delivery_fee_paid: bool = Field(default=False)
    delivery_fee_tx_id: UUID | None = Field(default=None, foreign_key="transactions.id")

    # delivery confirmation
    delivered_to_name: str | None = Field(default=None, max_length=255)
    delivered_to_cpf: str | None = Field(default=None, max_length=14)
    delivered_to_resident_id: UUID | None = Field(default=None, foreign_key="residents.id")
    signature_url: str | None = None
    delivered_at: datetime | None = None

    # delivery person (courier)
    deliverer_name: str | None = Field(default=None, max_length=255)
    deliverer_signature_url: str | None = None

    # anti-fraud
    proof_of_residence_verified: bool = Field(default=False)
    recipient_id_photo_url: str | None = None

    # return
    returned_at: datetime | None = None
    return_reason: str | None = None

    notes: str | None = None
    received_by: UUID = Field(foreign_key="users.id")
    delivered_by: UUID | None = Field(default=None, foreign_key="users.id")
    received_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
