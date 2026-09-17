import pytest
from app.core.models import SourceDocument, DocumentChunk, GroundedQuery
from app.adapters.grounded_synthesizer import GroundedSynthesizer


class MockLLMClient:
    """Mock LLM that returns pre-configured answers with citations."""
    def __init__(self, answer_to_return: str):
        self.answer_to_return = answer_to_return
        self.last_prompt = ""

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.last_prompt = f"{system_prompt}\n\n{user_prompt}"
        return self.answer_to_return


def test_synthesizer_refuses_when_no_chunks_provided():
    synthesizer = GroundedSynthesizer(llm_client=MockLLMClient(""))

    query = GroundedQuery(query="What is the OAuth timeout?", active_source_ids=["doc_1"])
    response = synthesizer.synthesize(query=query, chunks=[], sources_map={})

    assert response.evidence_found is False
    assert len(response.citations) == 0
    assert "no active documents" in response.answer.lower() or "do not contain" in response.answer.lower()


def test_synthesizer_extracts_citations_and_maps_coordinates():
    doc = SourceDocument(
        id="doc_auth",
        filename="security.md",
        raw_markdown="# Security Guide\n\nThe access token expires after 900 seconds (15 minutes)."
    )
    chunk = DocumentChunk(
        id="doc_auth#c0",
        source_id="doc_auth",
        heading_hierarchy=["# Security Guide"],
        start_char=18,
        end_char=80,
        content="The access token expires after 900 seconds (15 minutes)."
    )

    llm_output = "The access token expires after 15 minutes [^1]."
    mock_llm = MockLLMClient(llm_output)
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    query = GroundedQuery(query="When does the token expire?", active_source_ids=["doc_auth"])
    response = synthesizer.synthesize(
        query=query,
        chunks=[chunk],
        sources_map={"doc_auth": doc}
    )

    assert response.evidence_found is True
    assert "[^1]" in response.answer
    assert len(response.citations) == 1

    citation = response.citations[0]
    assert citation.index == 1
    assert citation.chunk_id == "doc_auth#c0"
    assert citation.source_id == "doc_auth"
    assert citation.source_filename == "security.md"
    assert citation.start_char == 18
    assert citation.end_char == 80
    assert "900 seconds" in citation.quote_snippet


def test_synthesizer_normalizes_standard_bracket_citations():
    doc = SourceDocument(
        id="doc_ami",
        filename="ami.pdf",
        raw_markdown="Schumacher, Federico. AMI: herramienta."
    )
    chunk = DocumentChunk(
        id="doc_ami#c0",
        source_id="doc_ami",
        start_char=0,
        end_char=39,
        content="Schumacher, Federico. AMI: herramienta."
    )

    # Local LLMs like Qwen 2.5:3b often output standard academic brackets [1] instead of [^1]
    llm_output = "El autor del libro es Federico Schumacher [1]."
    mock_llm = MockLLMClient(llm_output)
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    query = GroundedQuery(query="¿Quién es el autor?", active_source_ids=["doc_ami"])
    response = synthesizer.synthesize(
        query=query,
        chunks=[chunk],
        sources_map={"doc_ami": doc}
    )

    assert response.evidence_found is True
    assert len(response.citations) == 1
    assert response.citations[0].index == 1


def test_synthesizer_propagates_page_number_to_citation():
    doc = SourceDocument(
        id="doc_corvalan",
        filename="sedentarismo.pdf",
        raw_markdown="Del mandato al algoritmo en página 56."
    )
    chunk = DocumentChunk(
        id="doc_corvalan#c56",
        source_id="doc_corvalan",
        start_char=0,
        end_char=38,
        content="Del mandato al algoritmo en página 56.",
        page_number=56
    )

    mock_llm = MockLLMClient("Se encuentra en la página 56 [^1].")
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    response = synthesizer.synthesize(
        query=GroundedQuery(query="¿En qué página está?", active_source_ids=["doc_corvalan"]),
        chunks=[chunk],
        sources_map={"doc_corvalan": doc}
    )

    assert response.evidence_found is True
    assert len(response.citations) == 1
    assert response.citations[0].page_number == 56
    assert "Pág. 56" in mock_llm.last_prompt


def test_synthesizer_normalizes_multi_and_prefixed_citations():
    doc1 = SourceDocument(id="d1", filename="doc1.pdf", raw_markdown="Text 1")
    doc2 = SourceDocument(id="d2", filename="doc2.pdf", raw_markdown="Text 2")
    c1 = DocumentChunk(id="d1#c1", source_id="d1", start_char=0, end_char=10, content="Text 1", page_number=10)
    c2 = DocumentChunk(id="d2#c2", source_id="d2", start_char=0, end_char=10, content="Text 2", page_number=20)

    # Test multi-item brackets [1, 2] and prefixed (Fuente 2)
    llm_output = "El fenómeno ocurre por múltiples causas [1, 2]. También ver [Fuente 1] y (Chunk 2)."
    mock_llm = MockLLMClient(llm_output)
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    response = synthesizer.synthesize(
        query=GroundedQuery(query="Causas", active_source_ids=["d1", "d2"]),
        chunks=[c1, c2],
        sources_map={"d1": doc1, "d2": doc2}
    )

    assert response.evidence_found is True
    assert len(response.citations) == 2
    indices = [c.index for c in response.citations]
    assert indices == [1, 2]
    assert "[^1]" in response.answer
    assert "[^2]" in response.answer


def test_synthesizer_normalizes_parenthetical_citations():
    doc = SourceDocument(id="d1", filename="doc1.pdf", raw_markdown="El sedentarismo atrofia.")
    c1 = DocumentChunk(id="d1#c1", source_id="d1", start_char=0, end_char=24, content="El sedentarismo atrofia.", page_number=5)

    llm_output = "El cerebro sufre atrofia gradual debido al desuso sostenido (1)."
    mock_llm = MockLLMClient(llm_output)
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    response = synthesizer.synthesize(
        query=GroundedQuery(query="¿Qué ocurre?", active_source_ids=["d1"]),
        chunks=[c1],
        sources_map={"d1": doc}
    )

    assert response.evidence_found is True
    assert len(response.citations) == 1
    assert response.citations[0].index == 1
    assert "[^1]" in response.answer


def test_synthesizer_backfills_missing_citations_for_small_models():
    """
    Test real Ollama qwen2.5:3b failure case:
    The model accurately reproduces or synthesizes content from a chunk, but completely
    omits [N] citation brackets from its text.
    The backfill engine must detect lexical overlap, attribute the citation, and mark evidence_found=True.
    """
    doc = SourceDocument(
        id="doc_sed",
        filename="sedentarismo-cognitivo.pdf",
        raw_markdown="En el ecosistema agéntico, el riesgo se potencia aún más: el agente no solo propone una solución convergente, sino que la ejecuta, cerrando el espacio de deliberación antes de que el pensamiento divergente pueda operar."
    )
    c1 = DocumentChunk(
        id="doc_sed#c137",
        source_id="doc_sed",
        start_char=0,
        end_char=220,
        content="En el ecosistema agéntico, el riesgo se potencia aún más: el agente no solo propone una solución convergente, sino que la ejecuta, cerrando el espacio de deliberación antes de que el pensamiento divergente pueda operar.",
        page_number=53
    )

    # Exact text from the Ollama qwen2.5:3b screenshot without brackets:
    llm_output_no_citations = (
        "El sedentarismo es un fenómeno estructural en el ecosistema agéntico, donde el agente no solo propone "
        "una solución convergente, sino que la ejecuta, cerrando el espacio de deliberación antes de que el "
        "pensamiento divergente pueda operar."
    )
    mock_llm = MockLLMClient(llm_output_no_citations)
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    response = synthesizer.synthesize(
        query=GroundedQuery(query="qué es el sedentarismo", active_source_ids=["doc_sed"]),
        chunks=[c1],
        sources_map={"doc_sed": doc}
    )

    # Must be grounded and attributed, NOT Missing Evidence!
    assert response.evidence_found is True
    assert len(response.citations) == 1
    citation = response.citations[0]
    assert citation.index == 1
    assert citation.source_filename == "sedentarismo-cognitivo.pdf"
    assert citation.page_number == 53
    assert "[^1]" in response.answer


def test_synthesizer_does_not_backfill_on_explicit_refusal():
    """When context actually lacks information, do not force citations on refusal."""
    doc = SourceDocument(id="d1", filename="doc1.pdf", raw_markdown="Texto irrelevante.")
    c1 = DocumentChunk(id="d1#c1", source_id="d1", start_char=0, end_char=18, content="Texto irrelevante.")

    llm_output = "The provided active documents do not contain information to answer this query."
    mock_llm = MockLLMClient(llm_output)
    synthesizer = GroundedSynthesizer(llm_client=mock_llm)

    response = synthesizer.synthesize(
        query=GroundedQuery(query="¿Cuál es la fórmula cuántica?", active_source_ids=["d1"]),
        chunks=[c1],
        sources_map={"d1": doc}
    )

    assert response.evidence_found is False
    assert len(response.citations) == 0

