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


class CommunityAuthorType(str, Enum):
    resident = "resident"
    staff = "staff"


class CommunityPostCategory(str, Enum):
    anuncio = "anuncio"
    reclamacao = "reclamacao"
    aviso = "aviso"
    outro = "outro"
    solicitacao = "solicitacao"


class CommunityPostStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    removed = "removed"
    resolved = "resolved"


class CommunityPost(SQLModel, table=True):
    __tablename__ = "community_posts"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)

    author_type: CommunityAuthorType = Field(sa_column=Column(SAEnum(CommunityAuthorType, name="community_author_type", create_type=False), nullable=False))
    author_resident_id: UUID | None = Field(default=None, foreign_key="residents.id")
    author_user_id: UUID | None = Field(default=None, foreign_key="users.id")
    author_name: str = Field(max_length=255)

    category: CommunityPostCategory = Field(default=CommunityPostCategory.outro, sa_column=Column(SAEnum(CommunityPostCategory, name="community_post_category", create_type=False), nullable=False))
    title: str | None = Field(default=None, max_length=150)
    body: str
    image_urls: list[str] = Field(default=[], sa_column=Column(_json))

    status: CommunityPostStatus = Field(default=CommunityPostStatus.pending, sa_column=Column(SAEnum(CommunityPostStatus, name="community_post_status", create_type=False), nullable=False))
    moderation_reason: str | None = None
    moderated_by_ai: bool = Field(default=False)
    moderated_by_user_id: UUID | None = Field(default=None, foreign_key="users.id")
    pinned: bool = Field(default=False)

    admin_reply: str | None = None
    admin_reply_at: datetime | None = None
    admin_reply_by: UUID | None = Field(default=None, foreign_key="users.id")

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CommunityComment(SQLModel, table=True):
    __tablename__ = "community_comments"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    post_id: UUID = Field(foreign_key="community_posts.id", index=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)

    author_type: CommunityAuthorType = Field(sa_column=Column(SAEnum(CommunityAuthorType, name="community_author_type", create_type=False), nullable=False))
    author_resident_id: UUID | None = Field(default=None, foreign_key="residents.id")
    author_user_id: UUID | None = Field(default=None, foreign_key="users.id")
    author_name: str = Field(max_length=255)

    body: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CommunityPostLike(SQLModel, table=True):
    __tablename__ = "community_post_likes"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    post_id: UUID = Field(foreign_key="community_posts.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CommunityCommentLike(SQLModel, table=True):
    __tablename__ = "community_comment_likes"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    comment_id: UUID = Field(foreign_key="community_comments.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ResidentNotification(SQLModel, table=True):
    __tablename__ = "resident_notifications"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    association_id: UUID = Field(foreign_key="associations.id", index=True)
    resident_id: UUID = Field(foreign_key="residents.id", index=True)

    type: str = Field(max_length=30)
    title: str = Field(max_length=255)
    body: str | None = None
    post_id: UUID | None = Field(default=None, foreign_key="community_posts.id")

    read_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
