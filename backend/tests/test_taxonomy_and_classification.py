import io
import json
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.core.models import SourceDocument, DocumentChunk
from app.adapters.project_manager import ProjectManager
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.structured_analyzer import StructuredDocumentAnalyzer


class MockTaxonomyLLM:
    """Mock LLM that returns pre-configured taxonomy classification JSON."""
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        if "eurorack" in user_prompt.lower():
            return json.dumps({
                "category": "Hardware & Eurorack",
                "tags": ["#Eurorack", "#Sintesis-Modular", "#Hardware"],
                "author": "Doepfer",
                "year_or_era": "Contemporáneo",
                "thematic_summary": "Manual de módulos de hardware para síntesis microtonal.",
                "confidence": 0.95
            })
        return json.dumps({
            "category": "Teoría & Afinación",
            "tags": ["#Microtonal", "#Escalas", "#Afinación-Justa"],
            "author": "Harry Partch",
            "year_or_era": "Pioneros siglo XX",
            "thematic_summary": "Fundamentos teóricos de entonación justa y escalas no convencionales.",
            "confidence": 0.92
        })


@pytest.fixture
def temp_project_setup():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
    mock_llm = MockTaxonomyLLM()
    analyzer = StructuredDocumentAnalyzer(default_llm_client=mock_llm)
    app = create_app(project_manager=mgr, analyzer=analyzer)
    client = TestClient(app)
    yield client, mgr, analyzer
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_sqlite_store_metadata_update_and_taxonomy():
    temp_dir = tempfile.mkdtemp()
    db_path = f"{temp_dir}/test.db"
    store = SQLiteDocumentStore(db_path=db_path)

    doc = SourceDocument(
        id="doc_1",
        filename="partch.pdf",
        raw_markdown="# Genesis of a Music\nHarry Partch on microtonal tuning.",
        metadata={"author": "Harry Partch"}
    )
    store.add_document(doc, chunks=[])

    # 1. Update metadata manually
    updated = store.update_document_metadata("doc_1", {
        "category": "Historia & Pioneros",
        "tags": ["#Partch", "#Microtonal", "#JustIntonation"],
        "year_or_era": "1949",
        "summary": "Obra seminal sobre entonación justa."
    })

    assert updated is not None
    assert updated.metadata["category"] == "Historia & Pioneros"
    assert updated.metadata["tags"] == ["#Partch", "#Microtonal", "#JustIntonation"]
    assert updated.metadata["year_or_era"] == "1949"

    # 2. Add second document
    doc2 = SourceDocument(
        id="doc_2",
        filename="eurorack.pdf",
        raw_markdown="# Modular Synth manual",
        metadata={"category": "Hardware & Eurorack", "tags": ["#Eurorack", "#Microtonal"]}
    )
    store.add_document(doc2, chunks=[])

    # 3. Query project taxonomy aggregation
    tax = store.get_project_taxonomy()
    assert tax["total_sources"] == 2
    cat_names = [c["name"] for c in tax["categories"]]
    assert "Historia & Pioneros" in cat_names
    assert "Hardware & Eurorack" in cat_names

    tag_names = [t["name"] for t in tax["tags"]]
    assert "#Microtonal" in tag_names
    # #Microtonal appears in both docs, so count should be 2
    micro_tag = next(t for t in tax["tags"] if t["name"] == "#Microtonal")
    assert micro_tag["count"] == 2

    shutil.rmtree(temp_dir, ignore_errors=True)


def test_analyzer_classify_document_taxonomy():
    mock_llm = MockTaxonomyLLM()
    analyzer = StructuredDocumentAnalyzer(default_llm_client=mock_llm)

    doc = SourceDocument(
        id="doc_euro",
        filename="eurorack_quantizer.pdf",
        raw_markdown="Manual del módulo Eurorack para afinaciones microtonales."
    )
    chunk = DocumentChunk(
        id="doc_euro#c0",
        source_id="doc_euro",
        start_char=0,
        end_char=50,
        content="Manual del módulo Eurorack para afinaciones microtonales."
    )

    result = analyzer.classify_document_taxonomy(
        document=doc,
        chunks=[chunk],
        existing_categories=["Hardware & Eurorack", "Teoría"]
    )

    assert result.category == "Hardware & Eurorack"
    assert "#Eurorack" in result.tags
    assert result.author == "Doepfer"
    assert result.confidence >= 0.9


def test_taxonomy_api_endpoints(temp_project_setup):
    client, mgr, analyzer = temp_project_setup

    # 1. Create project
    proj_res = client.post("/api/projects", json={"name": "Música Microtonal"})
    assert proj_res.status_code == 200
    proj_id = proj_res.json()["id"]

    # 2. Upload source
    file_bytes = b"# Eurorack Microtonal Quantizer\nModulo de hardware."
    up_res = client.post(
        f"/api/projects/{proj_id}/sources/upload",
        files={"file": ("eurorack.pdf", io.BytesIO(file_bytes), "application/pdf")}
    )
    assert up_res.status_code == 200
    source_id = up_res.json()["id"]

    # 3. Patch metadata manually
    patch_res = client.patch(
        f"/api/projects/{proj_id}/sources/{source_id}/metadata",
        json={
            "category": "Hardware & Síntesis",
            "tags": ["#Eurorack", "#Modular"],
            "author": "Dieter Doepfer"
        }
    )
    assert patch_res.status_code == 200
    patched_doc = patch_res.json()
    assert patched_doc["metadata"]["category"] == "Hardware & Síntesis"
    assert "#Eurorack" in patched_doc["metadata"]["tags"]

    # 4. Check /taxonomy summary
    tax_res = client.get(f"/api/projects/{proj_id}/taxonomy")
    assert tax_res.status_code == 200
    tax_data = tax_res.json()
    assert tax_data["total_sources"] == 1
    assert tax_data["categories"][0]["name"] == "Hardware & Síntesis"
    assert tax_data["tags"][0]["name"] == "#Eurorack"

    # 5. Autoclassify single source via IA
    ac_res = client.post(f"/api/projects/{proj_id}/sources/{source_id}/autoclassify")
    assert ac_res.status_code == 200
    ac_data = ac_res.json()
    assert ac_data["category"] == "Hardware & Eurorack"

    # Verify that the document in store now has the AI-classified metadata
    get_res = client.get(f"/api/projects/{proj_id}/sources/{source_id}")
    assert get_res.status_code == 200
    doc_after_ac = get_res.json()
    assert doc_after_ac["metadata"]["category"] == "Hardware & Eurorack"

    # 6. Autoclassify all sources in project
    all_res = client.post(f"/api/projects/{proj_id}/sources/autoclassify-all")
    assert all_res.status_code == 200
    all_data = all_res.json()
    assert all_data["classified_count"] == 1
