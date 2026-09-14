"""Port definitions for academic paper and DOI resolution."""

from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field


class AcademicPaper(BaseModel):
    """Normalized domain model representing an academic publication."""

    doi: str
    title: str
    authors: list[str] = Field(default_factory=list)
    abstract: Optional[str] = None
    publication_year: Optional[int] = None
    venue: Optional[str] = None
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    publisher: Optional[str] = None
    is_open_access: bool = False
    pdf_url: Optional[str] = None
    landing_page_url: Optional[str] = None
    citations_count: Optional[int] = None
    source_database: str = "unknown"
    bibtex: Optional[str] = None


class AcademicResolverPort(ABC):
    """Abstract port for resolving academic papers and DOIs into structured metadata and full-text links."""

    @abstractmethod
    def is_doi(self, query: str) -> bool:
        """Checks whether a given string is or contains a valid Digital Object Identifier (DOI)."""
        pass

    @abstractmethod
    def normalize_doi(self, query: str) -> Optional[str]:
        """Extracts and normalizes a standard DOI string (e.g. '10.1353/pnm.2010.0009')."""
        pass

    @abstractmethod
    def resolve(self, doi_or_url: str) -> Optional[AcademicPaper]:
        """Resolves a DOI or academic URL into structured paper metadata."""
        pass

    @abstractmethod
    def build_academic_markdown(self, paper: AcademicPaper) -> str:
        """Synthesizes a rich, structured Markdown document from paper metadata."""
        pass

    @abstractmethod
    def search_literature(
        self,
        query: str,
        limit: int = 15,
        min_year: Optional[int] = None,
        min_citations: int = 0
    ) -> list[AcademicPaper]:
        """Searches open scholarly literature (e.g. OpenAlex) for matching works."""
        pass
