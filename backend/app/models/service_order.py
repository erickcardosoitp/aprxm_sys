from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

try:
    from sqlalchemy.dialects.postgresql import JSONB
    _json_type = JSONB
except ImportError:
    from sqlalchemy import JSON
    _json_type = JSON


class ServiceOrderStatus(str, Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    cancelled = "cancelled"


class ServiceOrderPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class ServiceOrder(SQLModel, table=True):
    __tablename__ = "service_orders"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    number: int = Field(default=0)   # set by service layer before insert

    title: str = Field(max_length=255)
    description: str
    status: ServiceOrderStatus = Field(default=ServiceOrderStatus.open, sa_column=Column(String, nullable=False, default=ServiceOrderStatus.open))
    priority: ServiceOrderPriority = Field(default=ServiceOrderPriority.medium, sa_column=Column(String, nullable=False, default=ServiceOrderPriority.medium))

    # requester
    requester_resident_id: UUID | None = Field(default=None, foreign_key="residents.id")
    requester_user_id: UUID | None = Field(default=None, foreign_key="users.id")
    requester_name: str | None = Field(default=None, max_length=255)
    requester_phone: str | None = Field(default=None, max_length=20)

    # assignment
    assigned_to: UUID | None = Field(default=None, foreign_key="users.id")
    assigned_at: datetime | None = None

    # location
    unit: str | None = Field(default=None, max_length=50)
    block: str | None = Field(default=None, max_length=50)
    location_detail: str | None = None
    area: str | None = Field(default=None, max_length=100)

    # resolution
    resolution_notes: str | None = None
    resolved_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str | None = None

    # document
    pdf_url: str | None = None
    pdf_generated_at: datetime | None = None

    # attachments: list of {url, filename, uploaded_at}
    attachments: list[dict[str, Any]] = Field(default=[], sa_column=Column(_json_type))

    created_by: UUID = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ServiceOrderHistory(SQLModel, table=True):
    __tablename__ = "service_order_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    service_order_id: UUID = Field(foreign_key="service_orders.id", index=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    from_status: ServiceOrderStatus | None = Field(default=None, sa_column=Column(String, nullable=True))
    to_status: ServiceOrderStatus = Field(sa_column=Column(String, nullable=False))
    changed_by: UUID = Field(foreign_key="users.id")
    notes: str | None = None
    changed_at: datetime = Field(default_factory=datetime.utcnow)
