import json
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from app.main import create_app
from app.core.models import DocumentChunk, GroundedQuery, SourceDocument
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.grounded_synthesizer import GroundedSynthesizer
from app.adapters.lancedb_store import LanceDBVectorStore
from app.adapters.llm_client import LLMProviderError, OpenAICompatibleLLMClient
from app.adapters.project_manager import ProjectManager
from app.adapters.timeline_builder import TimelineBuilder


class DummyEmbeddingModel:
    def embed(self, texts):
        for _ in texts:
            yield [0.1] * 8


def test_shared_chat_not_found_returns_404_not_name_error():
    test_store = SQLiteDocumentStore(db_path=":memory:")
    app = create_app(store=test_store)
    client = TestClient(app)

    res = client.get("/api/chat/shared/share_nonexistent_xyz")
    # Must be clean 404, not 500 NameError on HTTPException
    assert res.status_code == 404
    assert res.json()["detail"] == "Shared conversation not found"


def test_ping_model_unsupported_provider_returns_400():
    test_store = SQLiteDocumentStore(db_path=":memory:")
    app = create_app(store=test_store)
    client = TestClient(app)

    res = client.post("/api/models/ping?model_id=unsupported:some-model")
    # Must be clean 400, not 500 NameError on HTTPException
    assert res.status_code == 400
    assert "does not support pinging" in res.json()["detail"]


def test_project_chat_invalid_project_id_returns_404(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    app = create_app(project_manager=pm)
    client = TestClient(app)

    payload = {
        "query": "Test question?",
        "active_source_ids": ["doc_123"],
        "top_k": 3,
        "strict_grounding": True
    }
    res = client.post("/api/projects/proj_nonexistent_abc/chat", json=payload)
    assert res.status_code == 404
    assert res.json()["detail"] == "Project not found"


def test_lancedb_preserves_page_number(tmp_path):
    lance_dir = str(tmp_path / "vectors.lance")
    store = LanceDBVectorStore(
        db_dir=lance_dir,
        embedding_model=DummyEmbeddingModel()
    )

    chunks = [
        DocumentChunk(
            id="doc1#c0",
            source_id="doc1",
            heading_hierarchy=["Chapter 1"],
            start_char=0,
            end_char=50,
            content="Federico Schumacher es un compositor y teórico chileno.",
            token_estimate=12,
            page_number=56
        ),
        DocumentChunk(
            id="doc1#c1",
            source_id="doc1",
            heading_hierarchy=["Chapter 1"],
            start_char=51,
            end_char=100,
            content="La música electroacústica en Latinoamérica data de los años 50.",
            token_estimate=11,
            page_number=None
        ),
    ]

    store.add_chunks(chunks)

    results = store.search_vectors(query="compositor chileno", active_source_ids=["doc1"], top_k=5)
    assert len(results) == 2

    # Check that chunk 0 preserved page_number 56
    c0 = next(c for c, _ in results if c.id == "doc1#c0")
    assert c0.page_number == 56

    # Check that chunk 1 handled None gracefully
    c1 = next(c for c, _ in results if c.id == "doc1#c1")
    assert c1.page_number is None


def test_llm_client_resilience_on_empty_choices_and_none_content(monkeypatch):
    client = OpenAICompatibleLLMClient(
        base_url="http://fake-llm-api/v1",
        api_key="fake-key",
        model="primary-model",
        fallback_models=["fallback-model"],
        max_retries=0
    )

    # Mock response returning choices with content=None (Gemini refusal)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [
            {"message": {"role": "assistant", "content": None}}
        ]
    }

    import httpx
    monkeypatch.setattr(httpx.Client, "post", lambda *args, **kwargs: mock_resp)

    # A provider refusal is a typed failure, never ordinary answer content.
    with pytest.raises(LLMProviderError, match="null content"):
        client.generate("system", "user")


def test_grounded_synthesizer_with_mock_callable_without_code_attr():
    # Callable without __code__ or wrapped
    class CustomCallable:
        def __call__(self, system_prompt: str, user_prompt: str):
            return "Resultado válido de prueba [^1]."

    synth = GroundedSynthesizer(
        llm_client=CustomCallable()  # type: ignore
    )

    chunk = DocumentChunk(
        id="d1#c0",
        source_id="d1",
        heading_hierarchy=["Intro"],
        start_char=0,
        end_char=20,
        content="Contenido de prueba.",
        token_estimate=5,
        page_number=10
    )
    doc = SourceDocument(
        id="d1",
        filename="prueba.pdf",
        raw_markdown="Contenido de prueba.",
        char_count=20
    )

    query = GroundedQuery(
        query="¿Qué dice?",
        active_source_ids=["d1"],
        provider="default"
    )

    res = synth.synthesize(query=query, chunks=[chunk], sources_map={"d1": doc})
    assert res.evidence_found is True
    assert len(res.citations) == 1
    assert res.citations[0].page_number == 10


def test_timeline_builder_qualitative_year_resilience(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project("Musica Experimental")
    store = pm.get_store(proj.id)

    # Document 1 with qualitative year_or_era "Años 70"
    doc1 = SourceDocument(
        id="doc_70s",
        filename="Tratado_Años_70.pdf",
        raw_markdown="Texto sobre síntesis sonora en los años 70.",
        metadata={"year_or_era": "Años 70", "title": "Tratado Años 70"}
    )
    # Document 2 with qualitative year string "1984 (edición rev)"
    doc2 = SourceDocument(
        id="doc_80s",
        filename="Sintesis_FM.pdf",
        raw_markdown="Texto sobre modulación de frecuencia.",
        metadata={"year": "1984 (edición rev)", "title": "Síntesis FM"}
    )

    store.add_document(doc1, [])
    store.add_document(doc2, [])

    builder = TimelineBuilder(project_manager=pm)
    timeline = builder.build_timeline(proj.id)

    assert timeline.project_id == proj.id
    assert len(timeline.eras) > 0
    all_events = [ev for era in timeline.eras for ev in era.events]
    assert len(all_events) == 2
    years = {ev.year for ev in all_events}
    # 1970 and 1984 should be extracted cleanly
    assert 1970 in years or 1984 in years
