from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field


class SourceDocument(BaseModel):
    """Normalized document converted to Markdown with metadata."""
    id: str = Field(..., description="Unique deterministic or generated identifier")
    filename: str = Field(..., description="Original filename with extension")
    mime_type: str = Field(default="text/markdown", description="Detected or original MIME type")
    raw_markdown: str = Field(..., description="Full verbatim markdown content produced by MarkItDown")
    char_count: int = Field(default=0, description="Total characters in raw_markdown")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary extracted metadata")

    def model_post_init(self, __context: Any) -> None:
        if not self.char_count and self.raw_markdown:
            self.char_count = len(self.raw_markdown)


class DocumentChunk(BaseModel):
    """Discrete chunk with strict coordinate traceability to original raw_markdown."""
    id: str = Field(..., description="Unique chunk ID formatted as {source_id}#c{index}")
    source_id: str = Field(..., description="Foreign key to SourceDocument.id")
    heading_hierarchy: list[str] = Field(
        default_factory=list,
        description="Breadcrumb of enclosing Markdown headers (e.g. ['# Chapter 1', '## 1.2 Auth'])"
    )
    start_char: int = Field(..., ge=0, description="0-based start character offset in raw_markdown")
    end_char: int = Field(..., gt=0, description="0-based end character offset in raw_markdown (exclusive)")
    content: str = Field(..., description="Verbatim text slice: raw_markdown[start_char:end_char]")
    token_estimate: int = Field(default=0, description="Approximate token count")
    embedding: Optional[list[float]] = Field(default=None, description="Dense vector embedding")

    def model_post_init(self, __context: Any) -> None:
        if not self.token_estimate and self.content:
            # Quick rule-of-thumb: ~4 characters per token
            self.token_estimate = max(1, len(self.content) // 4)


class Citation(BaseModel):
    """Structured attribution citation linking answer text to source chunk coordinates."""
    index: int = Field(..., ge=1, description="Sequential citation index corresponding to [^N] in answer")
    chunk_id: str = Field(..., description="Referenced DocumentChunk.id")
    source_id: str = Field(..., description="Referenced SourceDocument.id")
    source_filename: str = Field(..., description="Filename for display")
    heading_path: list[str] = Field(default_factory=list, description="Section path for display")
    start_char: int = Field(..., ge=0, description="Start character offset for highlighting in viewer")
    end_char: int = Field(..., gt=0, description="End character offset for highlighting in viewer")
    quote_snippet: str = Field(..., description="Short exact excerpt supporting the statement")


class GroundedQuery(BaseModel):
    """Search / query request with context-gating."""
    query: str = Field(..., min_length=1, description="User question")
    active_source_ids: list[str] = Field(
        default_factory=list,
        description="Whitelist of source IDs to search. If empty, search is blocked or no context is used."
    )
    top_k: int = Field(default=5, ge=1, le=20, description="Number of high-quality chunks to supply to LLM")
    strict_grounding: bool = Field(
        default=True,
        description="If True, refuse to answer if evidence is missing from active sources"
    )


class GroundedResponse(BaseModel):
    """Synthesized response with guaranteed attribution citations."""
    answer: str = Field(..., description="Grounded response text containing [^N] inline markers")
    citations: list[Citation] = Field(default_factory=list, description="Array of citations referenced in answer")
    active_sources_consulted: list[str] = Field(
        default_factory=list,
        description="List of source IDs actually consulted in this generation"
    )
    evidence_found: bool = Field(
        default=True,
        description="Whether sufficient grounding evidence was located in active sources"
    )
