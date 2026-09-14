import os
import shutil
import uuid
from typing import Optional
from fastapi import APIRouter, File, HTTPException, UploadFile
from app.core.config import settings
from app.core.models import (
    Project,
    ProjectCreate,
    SourceDocument,
    GroundedQuery,
    GroundedResponse,
    ChatMessageRecord,
    URLIngestRequest,
    DocumentDossier,
)
from app.adapters.project_manager import ProjectManager
from app.adapters.repository_ingester import RepositoryIngester
from app.adapters.code_chunker import SemanticCodeChunker
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.ports.synthesizer import SynthesizerPort
from app.ports.reranker import RerankerPort
from app.ports.document_analyzer import DocumentAnalyzerPort
from app.adapters.cross_encoder_reranker import CrossEncoderReranker
from app.adapters.structured_analyzer import StructuredDocumentAnalyzer
from app.core.fusion import reciprocal_rank_fusion


def create_projects_router(
    project_manager: ProjectManager,
    ingester: IngestionPort,
    chunker: ChunkerPort,
    synthesizer: SynthesizerPort,
    repo_ingester: Optional[RepositoryIngester] = None,
    code_chunker: Optional[ChunkerPort] = None,
    reranker: Optional[RerankerPort] = None,
    analyzer: Optional[DocumentAnalyzerPort] = None,
) -> APIRouter:
    active_repo_ingester = repo_ingester or RepositoryIngester()
    active_code_chunker = code_chunker or SemanticCodeChunker()
    active_reranker = reranker or CrossEncoderReranker()
    active_analyzer = analyzer or StructuredDocumentAnalyzer()
    router = APIRouter(prefix="/api/projects", tags=["projects"])

    @router.get("", response_model=list[Project])
    async def list_projects():
        return project_manager.list_projects()

    @router.post("", response_model=Project)
    async def create_project(data: ProjectCreate):
        return project_manager.create_project(name=data.name, description=data.description)

    @router.get("/{project_id}", response_model=Project)
    async def get_project(project_id: str):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        return proj

    @router.delete("/{project_id}")
    async def delete_project(project_id: str):
        success = project_manager.delete_project(project_id)
        if not success:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"status": "deleted", "id": project_id}

    # --- Project Sources ---

    @router.get("/{project_id}/sources", response_model=list[SourceDocument])
    async def list_project_sources(project_id: str):
        store = project_manager.get_store(project_id)
        return store.list_documents()

    @router.post("/{project_id}/sources/upload", response_model=SourceDocument)
    async def upload_project_source(project_id: str, file: UploadFile = File(...)):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        uploads_dir = project_manager.get_uploads_dir(project_id)
        filename = file.filename or f"doc_{uuid.uuid4().hex[:8]}.bin"
        file_path = os.path.join(uploads_dir, filename)

        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        try:
            store = project_manager.get_store(project_id)
            vector_store = project_manager.get_vector_store(project_id)

            if active_repo_ingester.is_code_or_repo(filename):
                with open(file_path, "rb") as f_in:
                    file_bytes = f_in.read()

                if filename.lower().endswith(".zip"):
                    doc = active_repo_ingester.ingest_zip(file_bytes, filename=filename)
                else:
                    doc = active_repo_ingester.ingest_code_file(file_bytes, filename=filename)

                chunks = active_code_chunker.chunk(doc)
            else:
                doc = ingester.convert(file_path=file_path, filename=filename)
                chunks = chunker.chunk(doc)

            store.add_document(doc, chunks)
            vector_store.delete_document_chunks(doc.id)
            vector_store.add_chunks(chunks)
            return doc
        except Exception as e:
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/{project_id}/sources/url", response_model=SourceDocument)
    async def ingest_project_url(project_id: str, data: URLIngestRequest):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        try:
            store = project_manager.get_store(project_id)
            vector_store = project_manager.get_vector_store(project_id)
            doc = ingester.ingest_url(url=data.url, title_override=data.title)
            chunks = chunker.chunk(doc)
            store.add_document(doc, chunks)
            vector_store.delete_document_chunks(doc.id)
            vector_store.add_chunks(chunks)
            return doc
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/{project_id}/sources/{source_id}", response_model=SourceDocument)
    async def get_project_source(project_id: str, source_id: str):
        store = project_manager.get_store(project_id)
        doc = store.get_document(source_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Source not found in project")
        return doc

    @router.delete("/{project_id}/sources/{source_id}")
    async def delete_project_source(project_id: str, source_id: str):
        store = project_manager.get_store(project_id)
        vector_store = project_manager.get_vector_store(project_id)
        success = store.delete_document(source_id)
        vector_store.delete_document_chunks(source_id)
        if not success:
            raise HTTPException(status_code=404, detail="Source not found in project")
        return {"status": "deleted", "id": source_id}

    # --- Structured Document Analysis & Dossiers ---

    @router.post("/{project_id}/sources/{source_id}/analyze", response_model=DocumentDossier)
    async def analyze_project_source(project_id: str, source_id: str, provider: Optional[str] = None):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        doc = store.get_document(source_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Source document not found in project")

        chunks = store.get_document_chunks(source_id)
        dossier = active_analyzer.analyze_document(doc, chunks, provider=provider)
        store.save_dossier(dossier)
        return dossier

    @router.get("/{project_id}/sources/{source_id}/dossier", response_model=DocumentDossier)
    async def get_project_source_dossier(project_id: str, source_id: str):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        dossier = store.get_dossier(source_id)
        if not dossier:
            raise HTTPException(status_code=404, detail="Dossier not found for this source. Run /analyze first.")
        return dossier

    # --- Project Persistent Chat Messages ---

    @router.get("/{project_id}/messages", response_model=list[ChatMessageRecord])
    async def get_project_messages(project_id: str):
        store = project_manager.get_store(project_id)
        return store.get_messages("default")

    @router.delete("/{project_id}/messages")
    async def clear_project_messages(project_id: str):
        store = project_manager.get_store(project_id)
        store.clear_messages("default")
        return {"status": "cleared", "project_id": project_id}

    @router.post("/{project_id}/chat", response_model=GroundedResponse)
    async def project_grounded_chat(project_id: str, query: GroundedQuery):
        store = project_manager.get_store(project_id)
        vector_store = project_manager.get_vector_store(project_id)

        # 1. Save user question to persistent SQLite
        user_msg = ChatMessageRecord(
            id=f"msg_{uuid.uuid4().hex[:12]}",
            conversation_id="default",
            sender="user",
            text=query.query
        )
        store.save_message(user_msg)

        # 2. Hybrid Retrieval: FTS5 Lexical + LanceDB Dense Vectors + RRF Fusion
        candidate_pool_size = max(15, query.top_k * 3)
        fts_candidates = store.search_chunks(
            query=query.query,
            active_source_ids=query.active_source_ids,
            top_k=candidate_pool_size
        )

        try:
            vector_results = vector_store.search_vectors(
                query=query.query,
                active_source_ids=query.active_source_ids,
                top_k=candidate_pool_size
            )
            vector_candidates = [c for c, _dist in vector_results]
        except Exception:
            vector_candidates = []

        candidate_chunks = reciprocal_rank_fusion(
            fts_candidates,
            vector_candidates,
            k=60,
            top_k=candidate_pool_size
        )

        # 3. Neural Cross-Encoder Reranking
        chunks = active_reranker.rerank(
            query=query.query,
            chunks=candidate_chunks,
            top_k=query.top_k
        )

        sources_map = {}
        for chunk in chunks:
            if chunk.source_id not in sources_map:
                d = store.get_document(chunk.source_id)
                if d:
                    sources_map[chunk.source_id] = d

        # 3. Grounded synthesis
        response = synthesizer.synthesize(
            query=query,
            chunks=chunks,
            sources_map=sources_map
        )

        # 4. Save assistant response with verifiable citations to persistent SQLite
        assistant_msg = ChatMessageRecord(
            id=f"msg_{uuid.uuid4().hex[:12]}",
            conversation_id="default",
            sender="assistant",
            text=response.answer,
            citations=response.citations,
            evidence_found=response.evidence_found,
            active_sources_consulted=response.active_sources_consulted
        )
        store.save_message(assistant_msg)

        return response

    @router.post("/{project_id}/reindex")
    async def reindex_project(project_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        reindexed_count = project_manager.reindex_project_vectors(project_id)
        return {
            "status": "success",
            "project_id": project_id,
            "reindexed_chunks": reindexed_count,
            "embedding_model": settings.embedding_model,
        }

    return router
