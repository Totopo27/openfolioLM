from typing import Protocol, Optional
from pydantic import BaseModel, Field


class LineageLink(BaseModel):
    """Reference to an older foundational document that this paper builds upon."""
    source_id: str = Field(..., description="Referenced document ID")
    title: str = Field(..., description="Referenced document title")
    year: Optional[int] = Field(default=None, description="Publication year")


class TimelineEvent(BaseModel):
    """A discrete milestone representing a paper's contribution in chronological context."""
    id: str = Field(..., description="Unique event identifier")
    source_id: str = Field(..., description="Foreign key to SourceDocument.id")
    title: str = Field(..., description="Document title")
    year: int = Field(..., description="Publication year")
    authors: list[str] = Field(default_factory=list, description="Authors or publishing entities")
    headline: str = Field(..., description="One-line paradigm shift or core thesis")
    summary: str = Field(..., description="Executive overview or core finding")
    methodology: Optional[str] = Field(default=None, description="Approach or methodology applied")
    limitations: list[str] = Field(default_factory=list, description="Documented or observed limitations")
    role: str = Field(default="corpus", description="Scientometric role: foundation, frontier, bridge, corpus")
    citations_count: int = Field(default=0, description="Citation count")
    built_upon_sources: list[LineageLink] = Field(default_factory=list, description="Lineage links to older works")


class TimelineEra(BaseModel):
    """Chronological cohort grouping events of the same year or period."""
    year: int = Field(..., description="Calendar year or cohort index")
    era_name: str = Field(..., description="Era title, e.g. '2017: Arquitectura Transformer'")
    events: list[TimelineEvent] = Field(default_factory=list, description="Milestones in this era")


class ProjectTimeline(BaseModel):
    """Comprehensive chronological trajectory of ideas in a project corpus."""
    project_id: str = Field(..., description="Project workspace identifier")
    total_events: int = Field(default=0, description="Total chronological milestones")
    year_span: tuple[int, int] = Field(default=(0, 0), description="Minimum and maximum publication years")
    eras: list[TimelineEra] = Field(default_factory=list, description="Ordered eras from oldest to newest")
    narrative_arc: Optional[str] = Field(default=None, description="Synthesized narrative explaining intellectual evolution")


class TimelineBuilderPort(Protocol):
    """Port for generating chronological lineages and historical narratives."""

    def build_timeline(self, project_id: str) -> ProjectTimeline:
        """Construct the chronological timeline of events and lineage links."""
        ...

    async def synthesize_narrative(self, project_id: str, provider_override: Optional[str] = None) -> str:
        """Synthesize a cohesive narrative explaining the field's evolution over time."""
        ...
