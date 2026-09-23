import asyncio
from typing import Optional
from fastapi import APIRouter
from app.core.models import GroundedQuery, GroundedResponse
from app.ports.store import DocumentStorePort
from app.ports.synthesizer import SynthesizerPort
from app.ports.fact_checker import FactCheckerPort


def create_chat_router(
    store: DocumentStorePort,
    synthesizer: SynthesizerPort,
    fact_checker: Optional[FactCheckerPort] = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/chat", tags=["chat"])

    @router.post("", response_model=GroundedResponse)
    async def grounded_chat(query: GroundedQuery):
        # 1. Retrieve chunks filtered strictly by active sources
        chunks = await asyncio.to_thread(
            store.search_chunks,
            query=query.query,
            active_source_ids=query.active_source_ids,
            top_k=query.top_k,
        )

        # 2. Build map of source documents for metadata
        def _build_sources_map():
            sources_map = {}
            for chunk in chunks:
                if chunk.source_id not in sources_map:
                    doc = store.get_document(chunk.source_id)
                    if doc:
                        sources_map[chunk.source_id] = doc
            return sources_map

        sources_map = await asyncio.to_thread(_build_sources_map)

        # 3. Grounded synthesis
        response = await asyncio.to_thread(
            synthesizer.synthesize,
            query=query,
            chunks=chunks,
            sources_map=sources_map,
        )

        # 4. Factual Audit & Hallucination Guardrail
        if fact_checker and chunks and response.evidence_found and response.answer:
            audit = await asyncio.to_thread(
                fact_checker.audit,
                premise_chunks=chunks,
                hypothesis_text=response.answer,
            )
            response.factual_score = audit.factual_score
            response.hallucination_risk = audit.hallucination_risk

        return response

    return router
