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
    assert "[^1]" in response.answer
    assert "[1]" not in response.answer
    assert len(response.citations) == 1
    assert response.citations[0].index == 1
