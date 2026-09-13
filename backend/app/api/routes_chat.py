from fastapi import APIRouter
from app.core.models import GroundedQuery, GroundedResponse
from app.ports.store import DocumentStorePort
from app.ports.synthesizer import SynthesizerPort


def create_chat_router(
    store: DocumentStorePort,
    synthesizer: SynthesizerPort
) -> APIRouter:
    router = APIRouter(prefix="/api/chat", tags=["chat"])

    @router.post("", response_model=GroundedResponse)
    async def grounded_chat(query: GroundedQuery):
        # 1. Retrieve chunks filtered strictly by active sources
        chunks = store.search_chunks(
            query=query.query,
            active_source_ids=query.active_source_ids,
            top_k=query.top_k
        )

        # 2. Build map of source documents for metadata
        sources_map = {}
        for chunk in chunks:
            if chunk.source_id not in sources_map:
                doc = store.get_document(chunk.source_id)
                if doc:
                    sources_map[chunk.source_id] = doc

        # 3. Grounded synthesis
        response = synthesizer.synthesize(
            query=query,
            chunks=chunks,
            sources_map=sources_map
        )

        return response

    return router
