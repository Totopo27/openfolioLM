from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
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
    provider: Optional[str] = Field(
        default=None,
        description="Optional provider override: 'gemini' or 'ollama'"
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
    factual_score: Optional[float] = Field(
        default=None,
        description="Factual consistency score (0.0 to 1.0) computed by NLI cross-encoder"
    )
    hallucination_risk: Optional[str] = Field(
        default=None,
        description="Risk level: 'low' | 'medium' | 'high'"
    )


class ChatMessageRecord(BaseModel):
    """Persistent chat message in a project workspace."""
    id: str = Field(..., description="Unique message ID")
    conversation_id: str = Field(default="default", description="Conversation thread identifier")
    sender: str = Field(..., description="'user' or 'assistant'")
    text: str = Field(..., description="Message text")
    citations: list[Citation] = Field(default_factory=list, description="Attributed citations")
    evidence_found: Optional[bool] = Field(default=None, description="Grounding status")
    active_sources_consulted: list[str] = Field(default_factory=list, description="Sources consulted")
    factual_score: Optional[float] = Field(
        default=None,
        description="Factual consistency score (0.0 to 1.0)"
    )
    hallucination_risk: Optional[str] = Field(
        default=None,
        description="Risk level: 'low' | 'medium' | 'high'"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Project(BaseModel):
    """Isolated research workspace directory."""
    id: str = Field(..., description="Unique project slug identifier")
    name: str = Field(..., description="Project display title")
    description: str = Field(default="", description="Optional project description")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    doc_count: int = Field(default=0, description="Total documents in project")
    message_count: int = Field(default=0, description="Total chat messages in project")


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="")


class URLIngestRequest(BaseModel):
    url: str = Field(..., min_length=4, description="Web URL to ingest (http:// or https://)")
    title: Optional[str] = Field(default=None, description="Optional custom title override for the page")


class ModelEngine(BaseModel):
    id: str = Field(..., description="Unique engine identifier, e.g. 'gemini:gemini-3.5-flash' or 'ollama:qwen2.5:3b'")
    provider: str = Field(..., description="'gemini' or 'ollama'")
    model: str = Field(..., description="Underlying model name")
    name: str = Field(..., description="Human-friendly display name")
    is_available: bool = Field(default=True, description="Whether endpoint responded successfully")


class ModelsListResponse(BaseModel):
    models: list[ModelEngine] = Field(default_factory=list)


class DocumentTypeEnum(str, Enum):
    RESEARCH_PAPER = "research_paper"
    POLICY_PLAN = "policy_plan"
    TECHNICAL_REPORT = "technical_report"
    LEGAL_REGULATORY = "legal_regulatory"
    GENERAL = "general"


class AreaAnalysis(BaseModel):
    """Evaluation of a specific thematic dimension (Social, Economic, Technical, etc.)."""
    area: str = Field(..., description="Thematic dimension name, e.g. 'Social / Inclusión', 'Viabilidad Económica'")
    summary: str = Field(..., description="Concise assessment of this dimension")
    strengths: list[str] = Field(default_factory=list, description="Identified strengths or positive aspects")
    weaknesses: list[str] = Field(default_factory=list, description="Identified weaknesses or omissions")
    risks: list[str] = Field(default_factory=list, description="Associated operational, financial or social risks")


class FODAMatrix(BaseModel):
    """SWOT / FODA analytical matrix."""
    strengths: list[str] = Field(default_factory=list, description="Fortalezas (internal positives)")
    weaknesses: list[str] = Field(default_factory=list, description="Debilidades (internal negatives)")
    opportunities: list[str] = Field(default_factory=list, description="Oportunidades (external positives)")
    threats: list[str] = Field(default_factory=list, description="Amenazas / Riesgos (external negatives)")


class DocumentDossier(BaseModel):
    """Structured analytical dossier synthesizing CeNAT extraction + PASE multidimensional matrix."""
    source_id: str = Field(..., description="Referenced SourceDocument.id")
    title: str = Field(..., description="Extracted or verified document title")
    doc_type: DocumentTypeEnum = Field(default=DocumentTypeEnum.GENERAL, description="Categorized document typology")
    executive_summary: str = Field(..., description="High-level executive overview (<250 words)")
    authors_or_entities: list[str] = Field(default_factory=list, description="Authors, organizations or publishing entities")
    key_claims: list[str] = Field(default_factory=list, description="Core theses, proposals or findings")
    methodology_or_approach: Optional[str] = Field(default=None, description="Research methodology, legal framework, or implementation approach")
    multidimensional_analysis: list[AreaAnalysis] = Field(default_factory=list, description="Thematic area evaluations")
    foda: FODAMatrix = Field(default_factory=FODAMatrix, description="Structured FODA / SWOT matrix")
    limitations: list[str] = Field(default_factory=list, description="Documented or observed limitations and gaps")
    verdict: str = Field(..., description="Overall critical judgment, feasibility assessment or conclusion")
    confidence_score: float = Field(default=0.9, ge=0.0, le=1.0, description="Confidence in extracted evidence")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
