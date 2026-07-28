from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class PasswordResetToken(SQLModel, table=True):
    __tablename__ = "password_reset_tokens"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    token_hash: str = Field(max_length=64, index=True)
    expires_at: datetime
    used_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
