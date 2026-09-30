from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ImportStatus(StrEnum):
    queued = "queued"
    awaiting_authorized_import = "awaiting_authorized_import"
    importing = "importing"
    scanning_library = "scanning_library"
    available = "available"
    failed = "failed"


class ImportRequestCreate(BaseModel):
    provider: str = Field(examples=["authorized-catalog"])
    provider_id: str
    title: str
    artist: str
    album: str | None = None


class ImportRequest(ImportRequestCreate):
    id: UUID = Field(default_factory=uuid4)
    status: ImportStatus = ImportStatus.awaiting_authorized_import
    created_at: datetime = Field(default_factory=datetime.utcnow)
    error: str | None = None
