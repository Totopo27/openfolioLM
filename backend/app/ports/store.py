from typing import Protocol, Optional
from app.core.models import SourceDocument, DocumentChunk


class DocumentStorePort(Protocol):
    """Port for storing and retrieving source documents and indexed chunks."""

    def add_document(self, document: SourceDocument, chunks: list[DocumentChunk]) -> None:
        """Persist a source document and its associated chunks."""
        ...

    def get_document(self, source_id: str) -> Optional[SourceDocument]:
        """Retrieve a source document by its ID."""
        ...

    def list_documents(self) -> list[SourceDocument]:
        """List all registered source documents."""
        ...

    def delete_document(self, source_id: str) -> bool:
        """Delete a document and all its chunks."""
        ...

    def update_document_metadata(self, source_id: str, metadata_updates: dict) -> Optional[SourceDocument]:
        """Update arbitrary metadata for an existing document."""
        ...

    def get_project_taxonomy(self) -> dict:
        """Aggregate categories and tags for documents in store."""
        ...

    def search_chunks(
        self,
        query: str,
        active_source_ids: list[str],
        top_k: int = 5
    ) -> list[DocumentChunk]:
        """Search chunks filtered strictly by active_source_ids using hybrid or lexical matching."""
        ...
