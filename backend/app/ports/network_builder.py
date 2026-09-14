from typing import Protocol, Optional, Literal
from pydantic import BaseModel, Field


GraphRole = Literal["foundation", "frontier", "bridge", "corpus"]
EdgeType = Literal["citation", "semantic_similarity", "co_authorship"]


class GraphNode(BaseModel):
    """Represents a scientific paper or document node in the project graph."""
    id: str = Field(..., description="Unique document identifier")
    title: str = Field(..., description="Full document title")
    label: str = Field(..., description="Short display label for graph visualization")
    authors: list[str] = Field(default_factory=list, description="Author names")
    year: Optional[int] = Field(default=None, description="Publication year")
    citations_count: int = Field(default=0, description="Global citation count if known")
    role: str = Field(default="corpus", description="Scientometric role: foundation, frontier, bridge, or corpus")
    doc_type: str = Field(default="general", description="Categorized document type")
    in_corpus: bool = Field(default=True, description="Whether paper is part of local project corpus")
    cluster_id: int = Field(default=0, description="Thematic cluster community ID")
    centrality: float = Field(default=0.0, description="Computed PageRank or degree centrality score")


class GraphEdge(BaseModel):
    """Represents a connection between two documents."""
    source: str = Field(..., description="Source document ID")
    target: str = Field(..., description="Target document ID")
    type: str = Field(default="semantic_similarity", description="Edge type: citation, semantic_similarity, or co_authorship")
    weight: float = Field(default=1.0, ge=0.0, le=1.0, description="Connection strength / similarity weight")
    label: Optional[str] = Field(default=None, description="Optional descriptive label, e.g. '85% similitud'")


class GraphMetrics(BaseModel):
    """Aggregated scientometric and topological indicators of the corpus network."""
    node_count: int = Field(default=0)
    edge_count: int = Field(default=0)
    foundational_papers: list[str] = Field(default_factory=list, description="Landmark papers with highest authority/PageRank")
    frontier_papers: list[str] = Field(default_factory=list, description="Recent publications with high connectivity/velocity")
    bridge_papers: list[str] = Field(default_factory=list, description="Papers connecting disparate thematic subgraphs")
    density: float = Field(default=0.0, description="Graph network density")


class NetworkGraph(BaseModel):
    """Full knowledge and citation graph payload for visualization."""
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    metrics: GraphMetrics = Field(default_factory=GraphMetrics)


class NetworkBuilderPort(Protocol):
    """Port for synthesizing knowledge graphs and citation networks for a project."""

    def build_project_network(self, project_id: str, min_similarity: float = 0.65) -> NetworkGraph:
        """Construct the relational network for the given project workspace."""
        ...
