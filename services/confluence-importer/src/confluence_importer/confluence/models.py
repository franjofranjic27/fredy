"""Pydantic models for the Confluence REST API and page metadata.

``PageMetadata`` keeps camelCase serialization aliases so the JSONB metadata
stored in pgvector stays byte-compatible with what the former TS importer
wrote (and what the agent service reads).
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ConfluenceSpace(BaseModel):
    key: str
    name: str = ""


class ConfluenceBodyStorage(BaseModel):
    value: str
    representation: str = "storage"


class ConfluenceBody(BaseModel):
    storage: ConfluenceBodyStorage


class ConfluenceVersionBy(BaseModel):
    display_name: str = Field(default="", alias="displayName")
    email: str | None = None


class ConfluenceVersion(BaseModel):
    number: int
    when: str = ""
    by: ConfluenceVersionBy = ConfluenceVersionBy()


class ConfluenceAncestor(BaseModel):
    id: str
    title: str


class ConfluenceLabel(BaseModel):
    name: str
    prefix: str = "global"


class ConfluenceLabels(BaseModel):
    results: list[ConfluenceLabel] = []


class ConfluencePageMetadata(BaseModel):
    labels: ConfluenceLabels = ConfluenceLabels()


class ConfluenceLinks(BaseModel):
    webui: str = ""
    self_: str = Field(default="", alias="self")
    download: str = ""
    next: str | None = None


class ConfluencePage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: str = "page"
    status: str = "current"
    title: str
    space: ConfluenceSpace = ConfluenceSpace(key="")
    body: ConfluenceBody = ConfluenceBody(storage=ConfluenceBodyStorage(value=""))
    version: ConfluenceVersion = ConfluenceVersion(number=1)
    ancestors: list[ConfluenceAncestor] = []
    metadata: ConfluencePageMetadata = ConfluencePageMetadata()
    links: ConfluenceLinks = Field(default=ConfluenceLinks(), alias="_links")

    @property
    def label_names(self) -> list[str]:
        return [label.name for label in self.metadata.labels.results]


class ConfluenceSearchResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    results: list[ConfluencePage] = []
    start: int = 0
    limit: int = 0
    size: int = 0
    links: ConfluenceLinks = Field(default=ConfluenceLinks(), alias="_links")


class AttachmentExtensions(BaseModel):
    media_type: str = Field(default="", alias="mediaType")
    file_size: int = Field(default=0, alias="fileSize")


class ConfluenceAttachment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str = ""
    extensions: AttachmentExtensions = AttachmentExtensions()
    links: ConfluenceLinks = Field(default=ConfluenceLinks(), alias="_links")

    @property
    def media_type(self) -> str:
        return self.extensions.media_type

    @property
    def file_size(self) -> int:
        return self.extensions.file_size


class ConfluenceAttachmentResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    results: list[ConfluenceAttachment] = []
    size: int = 0
    links: ConfluenceLinks = Field(default=ConfluenceLinks(), alias="_links")


class PageMetadata(BaseModel):
    """Source-agnostic page metadata attached to every chunk."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    page_id: str
    title: str
    space_key: str
    space_name: str = ""
    labels: list[str] = []
    author: str = ""
    last_modified: str = ""
    version: int = 1
    url: str = ""
    ancestors: list[str] = []

    def to_metadata_dict(self) -> dict[str, Any]:
        """CamelCase dict as stored in the JSONB metadata column."""
        return self.model_dump(by_alias=True)
