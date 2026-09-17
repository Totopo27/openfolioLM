import os
import tempfile
from fastapi import APIRouter, File, HTTPException, UploadFile
from app.core.models import SourceDocument
from app.api.upload_utils import save_upload_with_limit
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.ports.store import DocumentStorePort


def create_sources_router(
    store: DocumentStorePort,
    ingester: IngestionPort,
    chunker: ChunkerPort
) -> APIRouter:
    router = APIRouter(prefix="/api/sources", tags=["sources"])

    @router.post("/upload", response_model=SourceDocument)
    async def upload_source(file: UploadFile = File(...)):
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".tmp"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name

        try:
            await save_upload_with_limit(file, temp_path)
            doc = ingester.convert(file_path=temp_path, filename=file.filename or "uploaded_file")
            chunks = chunker.chunk(doc)
            store.add_document(doc, chunks)
            return doc
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    @router.get("", response_model=list[SourceDocument])
    async def list_sources():
        return store.list_documents()

    @router.get("/{source_id}", response_model=SourceDocument)
    async def get_source(source_id: str):
        doc = store.get_document(source_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Source not found")
        return doc

    @router.delete("/{source_id}")
    async def delete_source(source_id: str):
        success = store.delete_document(source_id)
        if not success:
            raise HTTPException(status_code=404, detail="Source not found")
        return {"status": "deleted", "id": source_id}

    return router
