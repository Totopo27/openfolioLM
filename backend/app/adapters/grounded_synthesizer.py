import re
from typing import Any, Protocol, Optional
from app.core.models import (
    GroundedQuery,
    DocumentChunk,
    SourceDocument,
    GroundedResponse,
    Citation,
)
from app.ports.synthesizer import SynthesizerPort


class LLMClientProtocol(Protocol):
    """Protocol for interacting with any LLM (Ollama, OpenAI, Gemini, etc.)."""
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        ...


class GroundedSynthesizer(SynthesizerPort):
    """Synthesizer that enforces closed-domain factual grounding and extracts verifiable citations."""

    CITATION_REGEX = re.compile(r"\[\^(\d+)\]")

    SYSTEM_PROMPT = (
        "You are OpenFolioLM, a precision research assistant.\n"
        "Your task is to answer the user's question based EXCLUSIVELY on the provided <context>.\n\n"
        "STRICT GROUNDING RULES:\n"
        "1. Answer ONLY using the facts explicitly stated in the context chunks.\n"
        "2. Do NOT extrapolate, speculate, or introduce external knowledge.\n"
        "3. Every factual assertion must be attributed to its source chunk using inline markers like [^1], [^2] (or [1], [2]). "
        "Example: 'Federico Schumacher es el autor [^1].'\n"
        "4. If the provided context does not contain the answer, you MUST state: "
        "'The provided active documents do not contain information to answer this query.'\n"
        "5. Never invent or hallucinate citation numbers that are not in the context."
    )

    def __init__(
        self,
        llm_client: Optional[LLMClientProtocol] = None,
        providers: Optional[dict[str, LLMClientProtocol]] = None,
        default_provider: str = "gemini"
    ):
        self._llm_client = llm_client
        self._providers = providers or {}
        self._default_provider = default_provider

    def _get_client(self, requested_provider: Optional[str]) -> Optional[LLMClientProtocol]:
        if requested_provider and requested_provider in self._providers:
            return self._providers[requested_provider]
        if self._llm_client:
            return self._llm_client
        if self._default_provider in self._providers:
            return self._providers[self._default_provider]
        return None

    def _parse_provider_and_model(self, requested_provider: Optional[str]) -> tuple[Optional[LLMClientProtocol], Optional[str]]:
        if not requested_provider:
            return self._get_client(None), None

        if ":" in requested_provider:
            prov_name, model_name = requested_provider.split(":", 1)
            client = self._providers.get(prov_name) or self._llm_client or self._providers.get(self._default_provider)
            return client, model_name

        return self._get_client(requested_provider), None

    def synthesize(
        self,
        query: GroundedQuery,
        chunks: list[DocumentChunk],
        sources_map: dict[str, SourceDocument]
    ) -> GroundedResponse:
        # Refuse if no chunks are supplied or active sources are empty
        if not chunks or not query.active_source_ids:
            return GroundedResponse(
                answer="The provided active documents do not contain information to answer this query.",
                citations=[],
                active_sources_consulted=[],
                evidence_found=False
            )

        # Build numbered context
        context_parts = []
        for i, chunk in enumerate(chunks, start=1):
            source = sources_map.get(chunk.source_id)
            filename = source.filename if source else chunk.source_id
            header_str = " > ".join(chunk.heading_hierarchy) if chunk.heading_hierarchy else "General"
            context_parts.append(
                f"[Chunk {i}] File: {filename} | Section: {header_str}\n{chunk.content}"
            )

        context_block = "\n\n---\n\n".join(context_parts)
        user_prompt = f"<context>\n{context_block}\n</context>\n\nQuestion: {query.query}"

        # If an LLM client is configured, call it; otherwise construct a default fallback
        client, model_override = self._parse_provider_and_model(query.provider)
        if client:
            try:
                # Pass model_override if client supports it
                if hasattr(client, "generate") and "model_override" in client.generate.__code__.co_varnames:
                    raw_answer = client.generate(self.SYSTEM_PROMPT, user_prompt, model_override=model_override)
                else:
                    raw_answer = client.generate(self.SYSTEM_PROMPT, user_prompt)
            except TypeError:
                raw_answer = client.generate(self.SYSTEM_PROMPT, user_prompt)
        else:
            raw_answer = "The provided active documents do not contain information to answer this query."

        # Normalize bracket citations [Chunk 1], [1] into standard Markdown footnote citations [^1]
        raw_answer = re.sub(r'\[(?:Chunk\s*)(\d+)\]', r'[^\1]', raw_answer, flags=re.IGNORECASE)
        raw_answer = re.sub(r'\[(?!\^)(\d+)\]', r'[^\1]', raw_answer)

        # Extract citation numbers [^1], [^2], etc.
        citation_indices = sorted(list({int(m) for m in self.CITATION_REGEX.findall(raw_answer)}))
        citations: list[Citation] = []
        consulted_source_ids = set()

        for idx in citation_indices:
            # Map index (1-based) to chunk (0-based)
            if 1 <= idx <= len(chunks):
                chunk = chunks[idx - 1]
                source = sources_map.get(chunk.source_id)
                filename = source.filename if source else chunk.source_id
                consulted_source_ids.add(chunk.source_id)

                # Snippet preview: first 160 characters
                snippet = chunk.content[:160].strip()
                if len(chunk.content) > 160:
                    snippet += "..."

                citations.append(
                    Citation(
                        index=idx,
                        chunk_id=chunk.id,
                        source_id=chunk.source_id,
                        source_filename=filename,
                        heading_path=chunk.heading_hierarchy,
                        start_char=chunk.start_char,
                        end_char=chunk.end_char,
                        quote_snippet=snippet
                    )
                )

        evidence_found = (
            "do not contain" not in raw_answer.lower()
            and "no active documents" not in raw_answer.lower()
            and (len(citations) > 0 or not query.strict_grounding)
        )

        return GroundedResponse(
            answer=raw_answer,
            citations=citations,
            active_sources_consulted=list(consulted_source_ids),
            evidence_found=evidence_found
        )
