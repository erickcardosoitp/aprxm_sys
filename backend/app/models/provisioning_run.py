from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ProvisioningRunType(str, Enum):
    create_empresa = "create_empresa"
    create_associacao = "create_associacao"


class ProvisioningRunStatus(str, Enum):
    running = "running"
    success = "success"
    failed = "failed"


class ProvisioningRun(SQLModel, table=True):
    __tablename__ = "provisioning_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    empresa_id: UUID | None = Field(default=None, foreign_key="empresas.id")
    run_type: ProvisioningRunType = Field(
        sa_column=Column(SAEnum(ProvisioningRunType, name="provisioning_run_type", create_type=False), nullable=False)
    )
    status: ProvisioningRunStatus = Field(
        default=ProvisioningRunStatus.running,
        sa_column=Column(SAEnum(ProvisioningRunStatus, name="provisioning_run_status", create_type=False), nullable=False),
    )
    payload: dict = Field(sa_column=Column(JSONB, nullable=False))
    steps: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    error_detail: str | None = None
    started_by: UUID = Field(foreign_key="users.id")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
