import os
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import APIRouter, File, HTTPException, UploadFile, Query
from fastapi.responses import PlainTextResponse, FileResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
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
    ProjectNote,
    ProjectNoteCreate,
    ProjectNoteUpdate,
    DocumentChunk,
    DocumentMetadataUpdate,
    TaxonomyClassificationResult,
    ProjectTaxonomySummary,
    Citation,
    SharedConversationSnapshot,
    ShareConversationRequest,
    ImportConversationRequest,
)
from app.core.exporter import export_project_bibtex, export_project_markdown
from app.adapters.project_manager import ProjectManager
from app.adapters.repository_ingester import RepositoryIngester
from app.adapters.code_chunker import SemanticCodeChunker
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.ports.synthesizer import SynthesizerPort
from app.ports.reranker import RerankerPort
from app.ports.document_analyzer import DocumentAnalyzerPort
from app.ports.fact_checker import FactCheckerPort
from app.ports.academic_resolver import AcademicPaper, AcademicResolverPort
from app.ports.network_builder import NetworkGraph, NetworkBuilderPort
from app.ports.timeline_builder import ProjectTimeline, TimelineBuilderPort
from app.adapters.cross_encoder_reranker import CrossEncoderReranker
from app.adapters.structured_analyzer import StructuredDocumentAnalyzer
from app.adapters.academic_resolver import CompositeAcademicResolver
from app.adapters.citation_network import CitationNetworkBuilder
from app.adapters.timeline_builder import TimelineBuilder
from app.core.fusion import reciprocal_rank_fusion


logger = logging.getLogger(__name__)
# Max upload size: 0 or negative means unlimited (for large books, scores, and treatises)
MAX_UPLOAD_BYTES = (
    settings.max_upload_size_mb * 1024 * 1024
    if settings.max_upload_size_mb > 0
    else None
)
UPLOAD_READ_CHUNK_BYTES = 1024 * 1024


class BatchIngestRequest(BaseModel):
    dois: list[str] = Field(default_factory=list)


class DocumentPersistenceError(RuntimeError):
    """Raised when coordinated document/index persistence cannot complete."""


def _safe_upload_filename(filename: Optional[str]) -> str:
    candidate = (filename or "").replace("\\", "/")
    basename = os.path.basename(candidate).strip()
    basename = re.sub(r"[\x00-\x1f\x7f]", "_", basename)
    if basename in {"", ".", ".."}:
        return f"document_{uuid.uuid4().hex[:8]}.bin"
    # Leave room for the UUID prefix used for the on-disk filename so the
    # complete path component remains below common 255-byte filesystem limits.
    return basename[:200]


async def _save_upload_with_limit(file: UploadFile, destination: str) -> None:
    total_bytes = 0
    try:
        with open(destination, "xb") as output:
            while chunk := await file.read(UPLOAD_READ_CHUNK_BYTES):
                total_bytes += len(chunk)
                if MAX_UPLOAD_BYTES is not None and total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
                    )
                output.write(chunk)
    except Exception:
        if os.path.exists(destination):
            os.remove(destination)
        raise


def _persist_document_with_rollback(
    store: Any,
    vector_store: Any,
    document: SourceDocument,
    chunks: list[DocumentChunk],
) -> None:
    """Coordinate SQLite and LanceDB writes with compensating rollback."""
    previous_document = store.get_document(document.id)
    previous_chunks = (
        store.get_document_chunks(document.id) if previous_document is not None else []
    )

    try:
        store.add_document(document, chunks)
        vector_store.delete_document_chunks(document.id)
        vector_store.add_chunks(chunks)
    except Exception as exc:
        rollback_errors: list[Exception] = []

        try:
            if previous_document is None:
                store.delete_document(document.id)
            else:
                store.add_document(previous_document, previous_chunks)
        except Exception as rollback_exc:
            rollback_errors.append(rollback_exc)

        try:
            vector_store.delete_document_chunks(document.id)
            if previous_chunks:
                vector_store.add_chunks(previous_chunks)
        except Exception as rollback_exc:
            rollback_errors.append(rollback_exc)

        if rollback_errors:
            logger.error(
                "Document persistence rollback for %s had %d error(s)",
                document.id,
                len(rollback_errors),
            )
        raise DocumentPersistenceError(
            "Document and vector index could not be updated consistently"
        ) from exc


def _delete_indexed_document(store: Any, vector_store: Any, source_id: str) -> None:
    """Remove an obsolete document after its replacement is durable."""
    store.delete_document(source_id)
    vector_store.delete_document_chunks(source_id)


def create_projects_router(
    project_manager: ProjectManager,
    ingester: IngestionPort,
    chunker: ChunkerPort,
    synthesizer: SynthesizerPort,
    repo_ingester: Optional[RepositoryIngester] = None,
    code_chunker: Optional[ChunkerPort] = None,
    reranker: Optional[RerankerPort] = None,
    analyzer: Optional[DocumentAnalyzerPort] = None,
    fact_checker: Optional[FactCheckerPort] = None,
    academic_resolver: Optional[AcademicResolverPort] = None,
    network_builder: Optional[NetworkBuilderPort] = None,
    timeline_builder: Optional[TimelineBuilderPort] = None,
) -> APIRouter:
    active_repo_ingester = repo_ingester or RepositoryIngester()
    active_code_chunker = code_chunker or SemanticCodeChunker()
    active_reranker = reranker or CrossEncoderReranker()
    active_analyzer = analyzer or StructuredDocumentAnalyzer()
    active_fact_checker = fact_checker
    active_academic_resolver = academic_resolver or CompositeAcademicResolver()
    active_network_builder = network_builder or CitationNetworkBuilder(project_manager)
    active_timeline_builder = timeline_builder or TimelineBuilder(project_manager, synthesizer)
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
        filename = _safe_upload_filename(file.filename)
        stored_filename = f"{uuid.uuid4().hex}_{filename}"
        file_path = os.path.join(uploads_dir, stored_filename)
        await _save_upload_with_limit(file, file_path)

        def _process_and_persist():
            logger.info("Iniciando procesamiento e indexación para '%s' en proyecto '%s'", filename, project_id)
            store = project_manager.get_store(project_id)
            vector_store = project_manager.get_vector_store(project_id)

            if active_repo_ingester.is_code_or_repo(filename):
                logger.info("Detectado código o repositorio para '%s'", filename)
                with open(file_path, "rb") as f_in:
                    file_bytes = f_in.read()

                if filename.lower().endswith(".zip"):
                    doc = active_repo_ingester.ingest_zip(file_bytes, filename=filename)
                else:
                    doc = active_repo_ingester.ingest_code_file(file_bytes, filename=filename)

                chunks = active_code_chunker.chunk(doc)
            else:
                logger.info("Extrayendo texto, tablas y diagramas para '%s'...", filename)
                doc = ingester.convert(file_path=file_path, filename=filename)
                logger.info("Documento '%s' convertido (%d caracteres). Generando chunks...", filename, doc.char_count)
                chunks = chunker.chunk(doc)

            logger.info("Persistiendo '%s' (%d chunks) en SQLite y generando embeddings en LanceDB...", filename, len(chunks))
            _persist_document_with_rollback(store, vector_store, doc, chunks)
            logger.info("¡Documento '%s' indexado exitosamente! (id=%s)", filename, doc.id)
            return doc

        try:
            return await run_in_threadpool(_process_and_persist)
        except Exception as exc:
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception:
                    pass
            logger.exception("Failed to ingest uploaded source %s for project %s", filename, project_id)
            err_msg = str(exc).strip() or "Error interno durante la indexación"
            raise HTTPException(
                status_code=500,
                detail=f"Error al procesar el archivo '{filename}': {err_msg}"
            )

    @router.post("/{project_id}/sources/url", response_model=SourceDocument)
    async def ingest_project_url(project_id: str, data: URLIngestRequest):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        try:
            store = project_manager.get_store(project_id)
            vector_store = project_manager.get_vector_store(project_id)
            doc = ingester.ingest_url(url=data.url, title_override=data.title)

            # Deduplication: check if document already exists in this project
            existing_doc = project_manager.find_duplicate_document(
                project_id=project_id,
                doi=doc.metadata.get("doi") if doc.metadata else None,
                title=doc.filename
            )
            if (
                existing_doc
                and existing_doc.id != doc.id
                and existing_doc.char_count >= doc.char_count
            ):
                return existing_doc

            chunks = chunker.chunk(doc)
            _persist_document_with_rollback(store, vector_store, doc, chunks)
            if existing_doc and existing_doc.id != doc.id:
                _delete_indexed_document(store, vector_store, existing_doc.id)
            return doc
        except ValueError:
            raise HTTPException(status_code=400, detail="The URL or document data is invalid")
        except Exception:
            logger.exception("Failed to ingest URL for project %s", project_id)
            raise HTTPException(status_code=502, detail="Unable to ingest the requested URL")

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

    @router.put("/{project_id}/sources/{source_id}/dossier", response_model=DocumentDossier)
    async def update_project_source_dossier(project_id: str, source_id: str, updated_dossier: DocumentDossier):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        existing_doc = store.get_document(source_id)
        if not existing_doc:
            raise HTTPException(status_code=404, detail="Source document not found in project")

        updated_dossier.source_id = source_id
        store.save_dossier(updated_dossier)
        return updated_dossier

    # --- Source Document Taxonomy, Categorization & Metadata ---

    @router.patch("/{project_id}/sources/{source_id}/metadata", response_model=SourceDocument)
    async def update_project_source_metadata(project_id: str, source_id: str, payload: DocumentMetadataUpdate):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        updated = store.update_document_metadata(
            source_id,
            payload.model_dump(exclude_unset=True)
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Source document not found in project")
        return updated

    @router.post("/{project_id}/sources/{source_id}/autoclassify", response_model=TaxonomyClassificationResult)
    async def autoclassify_project_source(project_id: str, source_id: str, provider: Optional[str] = None):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        doc = store.get_document(source_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Source document not found in project")

        chunks = store.get_document_chunks(source_id)

        # Retrieve existing project categories to foster taxonomic alignment
        taxonomy = store.get_project_taxonomy()
        existing_categories = [c["name"] for c in taxonomy.get("categories", [])]

        result = active_analyzer.classify_document_taxonomy(
            document=doc,
            chunks=chunks,
            existing_categories=existing_categories,
            provider=provider
        )

        # Persist extracted category and tags into the document
        store.update_document_metadata(source_id, {
            "category": result.category,
            "tags": result.tags,
            "author": result.author,
            "year_or_era": result.year_or_era,
            "summary": result.thematic_summary,
        })
        return result

    @router.post("/{project_id}/sources/autoclassify-all")
    async def autoclassify_all_project_sources(project_id: str, provider: Optional[str] = None):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        docs = store.list_documents()
        results = []

        for doc in docs:
            chunks = store.get_document_chunks(doc.id)
            taxonomy = store.get_project_taxonomy()
            existing_categories = [c["name"] for c in taxonomy.get("categories", [])]

            res = active_analyzer.classify_document_taxonomy(
                document=doc,
                chunks=chunks,
                existing_categories=existing_categories,
                provider=provider
            )

            store.update_document_metadata(doc.id, {
                "category": res.category,
                "tags": res.tags,
                "author": res.author,
                "year_or_era": res.year_or_era,
                "summary": res.thematic_summary,
            })
            results.append({"source_id": doc.id, "filename": doc.filename, "classification": res})

        return {"classified_count": len(results), "results": results}

    @router.get("/{project_id}/taxonomy", response_model=ProjectTaxonomySummary)
    async def get_project_taxonomy_summary(project_id: str):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        tax = store.get_project_taxonomy()
        return ProjectTaxonomySummary(
            categories=tax.get("categories", []),
            tags=tax.get("tags", []),
            total_sources=tax.get("total_sources", 0)
        )

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

    @router.post("/{project_id}/chat/share", response_model=SharedConversationSnapshot)
    async def share_project_chat(project_id: str, req: ShareConversationRequest):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        messages = req.messages
        if not messages:
            store = project_manager.get_store(project_id)
            messages = store.get_messages("default")

        if not messages:
            raise HTTPException(status_code=400, detail="No hay mensajes en esta conversación para compartir.")

        snapshot = project_manager.save_shared_conversation(
            project_id=project_id,
            title=req.title,
            messages=messages,
            project_name=project.name
        )
        return snapshot

    @router.post("/{project_id}/chat/import")
    async def import_project_chat(project_id: str, req: ImportConversationRequest):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)

        records = []
        for raw in req.messages:
            raw_citations = raw.get("citations") or []
            citations = []
            for c in raw_citations:
                try:
                    citations.append(Citation(**c) if isinstance(c, dict) else c)
                except Exception:
                    pass

            c_at = raw.get("created_at")
            if isinstance(c_at, str):
                try:
                    c_date = datetime.fromisoformat(c_at.replace("Z", "+00:00"))
                except Exception:
                    c_date = datetime.now(timezone.utc)
            else:
                c_date = datetime.now(timezone.utc)

            records.append(
                ChatMessageRecord(
                    id=raw.get("id") or f"msg_{uuid.uuid4().hex[:12]}",
                    conversation_id=req.conversation_id,
                    sender=raw.get("sender", "user"),
                    text=raw.get("text", ""),
                    citations=citations,
                    evidence_found=raw.get("evidence_found"),
                    active_sources_consulted=raw.get("active_sources_consulted") or [],
                    factual_score=raw.get("factual_score"),
                    hallucination_risk=raw.get("hallucination_risk"),
                    created_at=c_date
                )
            )

        imported_count = store.import_messages(records)
        return {"status": "imported", "count": imported_count, "project_id": project_id}

    @router.get("/{project_id}/chat/export")
    async def export_project_chat(project_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        messages = store.get_messages("default")
        return {
            "project_id": project.id,
            "project_name": project.name,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "message_count": len(messages),
            "messages": [m.model_dump() for m in messages]
        }

    @router.post("/{project_id}/chat", response_model=GroundedResponse)
    async def project_grounded_chat(project_id: str, query: GroundedQuery):
        proj = project_manager.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

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

        # 4. Factual Audit & Hallucination Guardrail
        if active_fact_checker and chunks and response.evidence_found and response.answer:
            audit = active_fact_checker.audit(premise_chunks=chunks, hypothesis_text=response.answer)
            response.factual_score = audit.factual_score
            response.hallucination_risk = audit.hallucination_risk

        # 5. Save assistant response with verifiable citations and factual audit to persistent SQLite
        assistant_msg = ChatMessageRecord(
            id=f"msg_{uuid.uuid4().hex[:12]}",
            conversation_id="default",
            sender="assistant",
            text=response.answer,
            citations=response.citations,
            evidence_found=response.evidence_found,
            active_sources_consulted=response.active_sources_consulted,
            factual_score=response.factual_score,
            hallucination_risk=response.hallucination_risk,
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

    # --- Literature Discovery Endpoints ---

    @router.get("/{project_id}/discovery/suggested-topics")
    async def get_suggested_literature_topics(project_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        dossiers = store.get_all_dossiers()
        sources = {d.id: d for d in store.list_documents()}

        results = []
        for src_id, dos in dossiers.items():
            source_doc = sources.get(src_id)
            title = source_doc.filename if source_doc else dos.title

            for mod in dos.thematic_modules:
                if mod.core_concepts or mod.topic:
                    results.append({
                        "source_id": src_id,
                        "source_title": title,
                        "topic": mod.topic,
                        "concepts": mod.core_concepts,
                        "query_hint": f'"{mod.topic}" ' + " ".join(f'"{c}"' for c in mod.core_concepts[:2]) if mod.core_concepts else f'"{mod.topic}"'
                    })

            if not dos.thematic_modules and dos.key_claims:
                results.append({
                    "source_id": src_id,
                    "source_title": title,
                    "topic": dos.title,
                    "concepts": dos.key_claims[:3],
                    "query_hint": dos.title
                })

        return results

    @router.get("/{project_id}/discovery/search", response_model=list[AcademicPaper])
    async def search_academic_literature(
        project_id: str,
        query: str,
        limit: int = 15,
        min_year: Optional[int] = None,
        min_citations: int = 0
    ):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        papers = active_academic_resolver.search_literature(
            query=query,
            limit=limit,
            min_year=min_year,
            min_citations=min_citations
        )
        return papers

    @router.post("/{project_id}/discovery/ingest", response_model=list[SourceDocument])
    async def batch_ingest_discovery_papers(project_id: str, payload: BatchIngestRequest):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        store = project_manager.get_store(project_id)
        vector_store = project_manager.get_vector_store(project_id)
        ingested_docs = []

        for doi in payload.dois:
            try:
                doc = ingester.ingest_url(url=doi)

                # Deduplication check
                existing_doc = project_manager.find_duplicate_document(
                    project_id=project_id,
                    doi=doc.metadata.get("doi") if doc.metadata else None,
                    title=doc.filename
                )
                if (
                    existing_doc
                    and existing_doc.id != doc.id
                    and existing_doc.char_count >= doc.char_count
                ):
                    ingested_docs.append(existing_doc)
                    continue

                chunks = chunker.chunk(doc)
                _persist_document_with_rollback(store, vector_store, doc, chunks)
                if existing_doc and existing_doc.id != doc.id:
                    _delete_indexed_document(store, vector_store, existing_doc.id)
                ingested_docs.append(doc)
            except Exception:
                # Continue ingesting other papers even if one fails
                logger.exception(
                    "Failed to ingest discovery result for project %s",
                    project_id,
                )

        return ingested_docs

    # --- Studio Notebook Endpoints ---

    @router.get("/{project_id}/notes", response_model=list[ProjectNote])
    async def list_project_notes(project_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        return store.list_notes(project_id=project_id)

    @router.post("/{project_id}/notes", response_model=ProjectNote)
    async def create_project_note(project_id: str, note_in: ProjectNoteCreate):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        note_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        note = ProjectNote(
            id=note_id,
            project_id=project_id,
            title=note_in.title,
            content=note_in.content,
            source_citation_ids=note_in.source_citation_ids,
            tags=note_in.tags,
            origin_prompt=note_in.origin_prompt,
            source_message_id=note_in.source_message_id,
            created_at=now,
            updated_at=now,
        )
        store.save_note(note)
        return note

    @router.get("/{project_id}/notes/{note_id}", response_model=ProjectNote)
    async def get_project_note(project_id: str, note_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        note = store.get_note(note_id)
        if not note or note.project_id != project_id:
            raise HTTPException(status_code=404, detail="Note not found")
        return note

    @router.put("/{project_id}/notes/{note_id}", response_model=ProjectNote)
    async def update_project_note(project_id: str, note_id: str, note_in: ProjectNoteUpdate):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        existing = store.get_note(note_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(status_code=404, detail="Note not found")

        updated_note = ProjectNote(
            id=existing.id,
            project_id=existing.project_id,
            title=note_in.title if note_in.title is not None else existing.title,
            content=note_in.content if note_in.content is not None else existing.content,
            source_citation_ids=note_in.source_citation_ids if note_in.source_citation_ids is not None else existing.source_citation_ids,
            tags=note_in.tags if note_in.tags is not None else existing.tags,
            origin_prompt=note_in.origin_prompt if note_in.origin_prompt is not None else existing.origin_prompt,
            source_message_id=note_in.source_message_id if note_in.source_message_id is not None else existing.source_message_id,
            created_at=existing.created_at,
            updated_at=datetime.now(timezone.utc),
        )
        store.save_note(updated_note)
        return updated_note

    @router.delete("/{project_id}/notes/{note_id}")
    async def delete_project_note(project_id: str, note_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        existing = store.get_note(note_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(status_code=404, detail="Note not found")
        store.delete_note(note_id)
        return {"status": "deleted", "id": note_id}

    # --- Consolidated Exporter Endpoint ---

    @router.get("/{project_id}/export")
    async def export_project_dossier(
        project_id: str,
        format: str = Query("markdown", pattern="^(markdown|bibtex)$")
    ):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        store = project_manager.get_store(project_id)
        sources = store.list_documents()

        if format == "bibtex":
            content = export_project_bibtex(sources)
            filename = f"{project.name.replace(' ', '_').lower()}_references.bib"
            return PlainTextResponse(
                content=content,
                media_type="text/plain; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
        else:
            notes = store.list_notes(project_id=project_id)
            dossiers = store.get_all_dossiers()
            messages = store.get_messages(limit=100)
            content = export_project_markdown(
                project=project,
                sources=sources,
                notes=notes,
                dossiers=dossiers,
                messages=messages
            )
            filename = f"{project.name.replace(' ', '_').lower()}_dossier.md"
            return PlainTextResponse(
                content=content,
                media_type="text/markdown; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )

    # --- Knowledge Graph & Semantic Citation Network ---

    @router.get("/{project_id}/network", response_model=NetworkGraph)
    async def get_project_network(
        project_id: str,
        min_similarity: float = Query(0.65, ge=0.0, le=1.0)
    ):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return active_network_builder.build_project_network(
            project_id=project_id,
            min_similarity=min_similarity
        )

    # --- Chronology & Timeline of Ideas ---

    @router.get("/{project_id}/timeline", response_model=ProjectTimeline)
    async def get_project_timeline(project_id: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return active_timeline_builder.build_timeline(project_id=project_id)

    @router.post("/{project_id}/timeline/narrative")
    async def generate_timeline_narrative(
        project_id: str,
        provider: Optional[str] = Query(None)
    ):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        narrative = await active_timeline_builder.synthesize_narrative(
            project_id=project_id,
            provider_override=provider
        )
        return {"narrative_arc": narrative}

    # --- Project Visual Assets (Figures, Schemas, Diagrams) ---

    @router.get("/{project_id}/assets/{doc_id}/{filename}")
    async def get_project_asset(project_id: str, doc_id: str, filename: str):
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        clean_doc_id = os.path.basename(doc_id)
        clean_filename = os.path.basename(filename)

        proj_dir = project_manager._get_project_dir(project_id)
        asset_path = os.path.join(proj_dir, "assets", clean_doc_id, clean_filename)

        if not os.path.exists(asset_path):
            raise HTTPException(status_code=404, detail="Asset not found")

        ext = os.path.splitext(clean_filename)[1].lower()
        media_type = "image/png" if ext == ".png" else "image/jpeg" if ext in (".jpg", ".jpeg") else "application/octet-stream"
        return FileResponse(asset_path, media_type=media_type)

    return router

