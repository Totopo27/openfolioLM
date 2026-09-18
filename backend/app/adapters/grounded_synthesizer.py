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
        "3. Every factual assertion or definition must be attributed to its source chunk using inline markers like [1] or [2] (or [^1], [^2]). "
        "Example: 'Federico Schumacher es el autor [1].'\n"
        "4. When the user asks where something is located or for a page number, answer stating the exact page number given in the chunk header (e.g. 'se encuentra en la página 56 [1]'). NEVER use the chunk index or citation number as a page number.\n"
        "5. If the provided context does not contain the answer, you MUST state: "
        "'The provided active documents do not contain information to answer this query.'\n"
        "6. Never invent or hallucinate citation numbers that are not in the context."
    )

    STOPWORDS = {
        "este", "esta", "estos", "estas", "para", "como", "pero", "sobre", "entre", "donde", "cuando",
        "porque", "desde", "hasta", "hacia", "hace", "todo", "toda", "todos", "todas", "otro", "otra",
        "otros", "otras", "mismo", "misma", "cada", "unos", "unas", "cual", "cuales", "quien", "quienes",
        "algo", "nada", "poco", "mucho", "tanto", "tambien", "ademas", "segun", "puede", "pueden", "debe",
        "deben", "sino", "solo", "solamente", "esto", "aquello", "aqui", "alli", "alla", "bien", "forma",
        "the", "and", "for", "that", "this", "with", "from", "they", "will", "would", "there", "their"
    }

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

    def _extract_tokens(self, text: str) -> set[str]:
        """Extract meaningful alphanumeric tokens (>2 chars) excluding common stopwords."""
        words = set(re.findall(r"\b\w{3,}\b", text.lower()))
        return {w for w in words if w not in self.STOPWORDS}

    def _normalize_citations(self, text: str, max_chunk_idx: int) -> str:
        """
        Normalizes any citation format into standard Markdown footnote citations [^N].
        Handles:
        - Ranges: [1-3] -> [^1] [^2] [^3]
        - Prefixed brackets: [Chunk 1], [Fuente 1], [Doc 1], [Fragmento 1], [Ref 1], [#1]
        - Prefixed parentheses: (Chunk 1), (Fuente 1), (Doc 1), (Ref 1), (#1)
        - Multi-item brackets: [1, 2, 3], [1; 2], [1 y 2], [1 and 2]
        - Multi-item parentheses: (1, 2), (1; 2)
        - Standard brackets: [1] -> [^1]
        - Parenthetical numbers at clause/sentence end: 'texto (1).'
        """
        # 1. Expand ranges [1-3]
        def expand_range(m):
            start, end = int(m.group(1)), int(m.group(2))
            if 1 <= start <= end <= max_chunk_idx and (end - start) <= 10:
                return " ".join(f"[^{i}]" for i in range(start, end + 1))
            return m.group(0)

        text = re.sub(r"\[(\d+)\s*-\s*(\d+)\]", expand_range, text)

        # 2. Prefixed brackets: [Chunk 1], [Fuente 1], [Doc 1], [Ref 1], [#1]
        text = re.sub(
            r"\[(?:Chunk|Fragmento|Fuente|Doc(?:umento)?|Ref(?:erencia)?\.?|#)\s*(\d+)\]",
            r"[^\1]",
            text,
            flags=re.IGNORECASE
        )

        # 3. Prefixed parentheses: (Chunk 1), (Fuente 1), (Doc 1), (Ref 1), (#1)
        text = re.sub(
            r"\((?:Chunk|Fragmento|Fuente|Doc(?:umento)?|Ref(?:erencia)?\.?|#)\s*(\d+)\)",
            r"[^\1]",
            text,
            flags=re.IGNORECASE
        )

        # 4. Multi-item citations in brackets: [1, 2, 3], [1; 2], [1 y 2], [1 and 2]
        def unpack_multi(m):
            content = m.group(1)
            nums = re.findall(r"\b\d+\b", content)
            if nums and all(int(n) <= max_chunk_idx for n in nums):
                return " ".join(f"[^{n}]" for n in nums)
            return m.group(0)

        text = re.sub(r"\[(\d+(?:\s*(?:[,;]|y|and)\s*\d+)+)\]", unpack_multi, text, flags=re.IGNORECASE)

        # 5. Multi-item citations in parentheses: (1, 2), (1; 2)
        text = re.sub(r"\((\d+(?:\s*(?:[,;]|y|and)\s*\d+)+)\)", unpack_multi, text, flags=re.IGNORECASE)

        # 6. Standard bracket citations: [1] -> [^1]
        def single_bracket(m):
            num = int(m.group(1))
            if 1 <= num <= max_chunk_idx:
                return f"[^{num}]"
            return m.group(0)

        text = re.sub(r"\[(?!\^)(\d+)\]", single_bracket, text)

        # 7. Parenthetical numbers at clause or sentence end: e.g. 'palabra (1).' or 'palabra (1)'
        def single_paren(m):
            num = int(m.group(1))
            if 1 <= num <= max_chunk_idx:
                return f"[^{num}]"
            return m.group(0)

        text = re.sub(r"(?<=\w)\s*\((?!\^)(\d{1,2})\)(?=[\s.,;!?]|$)", single_paren, text)

        return text

    def _backfill_missing_citations(
        self,
        answer: str,
        chunks: list[DocumentChunk],
    ) -> tuple[str, list[int]]:
        """
        Deterministic safety net: when an LLM (especially SLMs like Ollama qwen2.5:3b)
        answers faithfully from the context chunks but forgets to include [N] citation brackets,
        detect lexical/semantic overlap against chunks and backfill verifiable citations.
        """
        if not chunks:
            return answer, []

        chunk_token_sets = [self._extract_tokens(c.content) for c in chunks]

        # Split into sentences preserving delimiters
        raw_sentences = re.split(r"((?<=[.!?])\s+)", answer)
        new_parts = []
        attributed_indices: set[int] = set()

        for part in raw_sentences:
            if not part.strip() or re.match(r"^\s+$", part):
                new_parts.append(part)
                continue

            sent_tokens = self._extract_tokens(part)
            if len(sent_tokens) >= 3:
                best_idx = -1
                best_score = 0.0
                for c_idx, c_tokens in enumerate(chunk_token_sets, start=1):
                    if not c_tokens:
                        continue
                    overlap = len(sent_tokens & c_tokens) / len(sent_tokens)
                    if overlap > best_score:
                        best_score = overlap
                        best_idx = c_idx

                if best_score >= 0.25 and best_idx != -1:
                    attributed_indices.add(best_idx)
                    m = re.search(r"([.!?]+)\s*$", part)
                    if m:
                        punc = m.group(1)
                        prefix = part[:m.start()]
                        new_parts.append(f"{prefix} [^{best_idx}]{punc}")
                    else:
                        new_parts.append(f"{part} [^{best_idx}]")
                    continue

            new_parts.append(part)

        result_text = "".join(new_parts)

        # If sentence-level matching found nothing, evaluate the entire answer
        if not attributed_indices:
            ans_tokens = self._extract_tokens(answer)
            best_idx = -1
            best_score = 0.0
            for c_idx, c_tokens in enumerate(chunk_token_sets, start=1):
                if not ans_tokens or not c_tokens:
                    continue
                overlap = len(ans_tokens & c_tokens) / len(ans_tokens)
                if overlap > best_score:
                    best_score = overlap
                    best_idx = c_idx

            # Do not lower the evidence threshold for a single chunk: incidental
            # token overlap is not sufficient to make an answer grounded.
            if best_idx != -1 and best_score >= 0.25:
                attributed_indices.add(best_idx)
                result_text = f"{result_text.rstrip()} [^{best_idx}]"

        return result_text, sorted(list(attributed_indices))

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
            page_info = f" | Pág. {chunk.page_number}" if chunk.page_number is not None else ""
            context_parts.append(
                f"[Chunk {i}] File: {filename}{page_info} | Section: {header_str}\n{chunk.content}"
            )

        context_block = "\n\n---\n\n".join(context_parts)
        user_prompt = (
            f"<context>\n{context_block}\n</context>\n\n"
            f"Question: {query.query}\n\n"
            f"IMPORTANT CITATION INSTRUCTIONS:\n"
            f"1. Base your answer EXCLUSIVELY on the provided <context> chunks.\n"
            f"2. You MUST include inline citation markers like [1] or [2] (matching the [Chunk N] numbers) at the end of each sentence, fact, or definition.\n"
            f"   Example: 'El sedentarismo cognitivo es un fenómeno estructural [1].'\n"
            f"3. OBLIGATORIO: Agrega siempre la cita entre corchetes [1], [2], etc., al final de cada afirmación. No omitas las citas."
        )

        # If an LLM client is configured, call it; otherwise construct a default fallback
        client, model_override = self._parse_provider_and_model(query.provider)
        if client:
            try:
                if hasattr(client, "generate"):
                    if model_override:
                        raw_answer = client.generate(self.SYSTEM_PROMPT, user_prompt, model_override=model_override)
                    else:
                        raw_answer = client.generate(self.SYSTEM_PROMPT, user_prompt)
                elif callable(client):
                    raw_answer = client(self.SYSTEM_PROMPT, user_prompt)
                else:
                    raw_answer = "The provided active documents do not contain information to answer this query."
            except (TypeError, AttributeError):
                if hasattr(client, "generate"):
                    raw_answer = client.generate(self.SYSTEM_PROMPT, user_prompt)
                elif callable(client):
                    raw_answer = client(self.SYSTEM_PROMPT, user_prompt)
                else:
                    raw_answer = "The provided active documents do not contain information to answer this query."
        else:
            raw_answer = "The provided active documents do not contain information to answer this query."

        # Check for explicit refusal phrases
        is_refusal = any(
            phrase in raw_answer.lower()
            for phrase in [
                "do not contain",
                "no active documents",
                "no contienen información",
                "no se encuentra información",
                "no proporcionan información",
                "does not contain",
            ]
        )

        if not is_refusal:
            # 1. Normalize all citation variations into Markdown footnote citations [^N]
            raw_answer = self._normalize_citations(raw_answer, max_chunk_idx=len(chunks))
            citation_indices = sorted(list({int(m) for m in self.CITATION_REGEX.findall(raw_answer)}))

            # 2. If no citation markers were detected in a non-refusal answer, run backfill safety net
            if not citation_indices and chunks:
                raw_answer, citation_indices = self._backfill_missing_citations(raw_answer, chunks)
        else:
            citation_indices = []

        # Extract Citation objects
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
                        quote_snippet=snippet,
                        page_number=chunk.page_number
                    )
                )

        evidence_found = (
            not is_refusal
            and (len(citations) > 0 or not query.strict_grounding)
        )

        return GroundedResponse(
            answer=raw_answer,
            citations=citations,
            active_sources_consulted=list(consulted_source_ids),
            evidence_found=evidence_found
        )
