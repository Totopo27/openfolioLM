from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional, Literal
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
    page_number: Optional[int] = Field(default=None, description="Physical or folio page number")

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
    page_number: Optional[int] = Field(default=None, description="Physical or folio page number")


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
    id: str = Field(..., description="Unique engine identifier, e.g. 'gemini:gemini-2.5-flash' or 'ollama:qwen2.5:3b'")
    provider: str = Field(..., description="'gemini' or 'ollama'")
    model: str = Field(..., description="Underlying model name")
    name: str = Field(..., description="Human-friendly display name")
    is_available: bool = Field(default=True, description="Whether endpoint responded successfully")
    status: Literal["healthy", "high_demand", "offline", "unknown"] = Field(
        default="healthy", description="Operational health status: healthy, high_demand, offline, or unknown"
    )
    latency_ms: Optional[int] = Field(default=None, description="Recent round-trip latency in ms")
    last_error: Optional[str] = Field(default=None, description="Recent diagnostic or error description")


class ModelsListResponse(BaseModel):
    models: list[ModelEngine] = Field(default_factory=list)


class DocumentTypeEnum(str, Enum):
    BOOK = "book"
    TEXTBOOK = "textbook"
    RESEARCH_PAPER = "research_paper"
    TECHNICAL_REPORT = "technical_report"
    MONOGRAPH = "monograph"
    POLICY_PLAN = "policy_plan"
    LEGAL_REGULATORY = "legal_regulatory"
    GENERAL = "general"


class ThematicModule(BaseModel):
    """Thematic module or chapter axis of a book, paper or technical manual."""
    topic: str = Field(..., description="Module, chapter or thematic area title")
    summary: str = Field(..., description="Concise overview of what this module covers")
    core_concepts: list[str] = Field(default_factory=list, description="Key concepts, algorithms, or theories explained")
    practical_applications: list[str] = Field(default_factory=list, description="Practical implementations, exercises, or real-world use cases")


class StudyGuide(BaseModel):
    """Pedagogical study guide and conceptual roadmap for technical/academic reading."""
    target_audience: str = Field(default="Público general", description="Intended readership (e.g., sound designers, software architects, researchers)")
    prerequisites: list[str] = Field(default_factory=list, description="Required prior knowledge, tools, or math background")
    difficulty_level: str = Field(default="Intermedio", description="Difficulty tier: Introductorio | Intermedio | Avanzado | Especializado")
    key_takeaways: list[str] = Field(default_factory=list, description="Core competencies or key learnings upon completing the work")
    recommended_reading_path: str = Field(default="", description="Pedagogical advice on how to navigate the material")


class DocumentDossier(BaseModel):
    """Structured analytical dossier synthesizing book architecture, study guide, and conceptual modules."""
    source_id: str = Field(..., description="Referenced SourceDocument.id")
    title: str = Field(..., description="Extracted or verified document title")
    doc_type: DocumentTypeEnum = Field(default=DocumentTypeEnum.GENERAL, description="Categorized document typology")
    executive_summary: str = Field(..., description="High-level executive overview (<250 words)")
    authors_or_entities: list[str] = Field(default_factory=list, description="Authors, organizations or publishing entities")
    key_claims: list[str] = Field(default_factory=list, description="Core theses, arguments or theoretical principles")
    methodology_or_approach: Optional[str] = Field(default=None, description="Pedagogical, scientific, or technical approach")
    thematic_modules: list[ThematicModule] = Field(default_factory=list, description="Thematic breakdown of chapters and core modules")
    study_guide: StudyGuide = Field(
        default_factory=lambda: StudyGuide(
            target_audience="Público general",
            prerequisites=[],
            difficulty_level="Intermedio",
            key_takeaways=[],
            recommended_reading_path=""
        ),
        description="Pedagogical roadmap, difficulty, and prerequisites"
    )
    limitations: list[str] = Field(default_factory=list, description="Scope boundaries and topics explicitly not covered")
    verdict: str = Field(..., description="Overall editorial and pedagogical evaluation of conceptual rigor and clarity")
    confidence_score: float = Field(default=0.9, ge=0.0, le=1.0, description="Confidence in extracted evidence")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectNote(BaseModel):
    """User-created analytical synthesis or pinned finding in a project notebook."""
    id: str = Field(..., description="Unique note ID")
    project_id: str = Field(..., description="Project workspace identifier")
    title: str = Field(..., description="Note title or synthesized thesis")
    content: str = Field(..., description="Markdown body with synthesis, reflections or pinned answers")
    source_citation_ids: list[str] = Field(default_factory=list, description="Source or chunk IDs linked to this note")
    tags: list[str] = Field(default_factory=list, description="Categorization tags")
    origin_prompt: Optional[str] = Field(default=None, description="User prompt/question that originated this note")
    source_message_id: Optional[str] = Field(default=None, description="Chat message ID associated with this note")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectNoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    source_citation_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    origin_prompt: Optional[str] = None
    source_message_id: Optional[str] = None


class ProjectNoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = None
    source_citation_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    origin_prompt: Optional[str] = None
    source_message_id: Optional[str] = None


class DocumentMetadataUpdate(BaseModel):
    """Payload to update a source document's metadata (category, tags, author, etc.)."""
    category: Optional[str] = Field(default=None, description="Primary thematic category")
    tags: Optional[list[str]] = Field(default=None, description="List of semantic tags")
    author: Optional[str] = Field(default=None, description="Author or creator")
    year_or_era: Optional[str] = Field(default=None, description="Publication year, era or trend")
    summary: Optional[str] = Field(default=None, description="Concise thematic summary")


class TaxonomyClassificationResult(BaseModel):
    """LLM taxonomy and categorization output for a document."""
    category: str = Field(..., description="Suggested thematic category")
    tags: list[str] = Field(default_factory=list, description="Extracted semantic tags with #")
    author: Optional[str] = Field(default=None, description="Identified author or creator")
    year_or_era: Optional[str] = Field(default=None, description="Identified era, year, or historical trend")
    thematic_summary: Optional[str] = Field(default=None, description="One-sentence thematic focus")
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class ProjectTaxonomySummary(BaseModel):
    """Aggregated categories and tags with document frequencies for a project."""
    categories: list[dict[str, Any]] = Field(default_factory=list, description="List of {name, count}")
    tags: list[dict[str, Any]] = Field(default_factory=list, description="List of {name, count}")
    total_sources: int = Field(default=0)


class SharedConversationSnapshot(BaseModel):
    """Self-contained snapshot of a project chat conversation for sharing or importing."""
    share_id: str = Field(..., description="Unique share identifier")
    project_id: str = Field(..., description="Source project identifier")
    project_name: str = Field(..., description="Source project name")
    title: str = Field(..., description="Conversation title or summary")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    messages: list[ChatMessageRecord] = Field(default_factory=list, description="List of messages with citations and evidence")
    source_count: int = Field(default=0, description="Number of distinct sources referenced")


class ShareConversationRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200, description="Optional custom title for the shared conversation")
    messages: Optional[list[dict[str, Any]]] = Field(default=None, description="Optional explicit messages list from client to share")


class ImportConversationRequest(BaseModel):
    messages: list[dict[str, Any]] = Field(..., description="List of chat message dictionaries to import")
    conversation_id: str = Field(default="default", description="Target conversation ID")

