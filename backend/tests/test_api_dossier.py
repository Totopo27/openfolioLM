import io
import json
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.adapters.project_manager import ProjectManager
from app.adapters.structured_analyzer import StructuredDocumentAnalyzer
from app.core.models import DocumentTypeEnum


class MockAnalyzerLLM:
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "title": "Ley de Aguas y Recursos Hídricos",
            "doc_type": "legal_regulatory",
            "executive_summary": "Marco normativo para la gestión integrada del recurso hídrico.",
            "authors_or_entities": ["Asamblea Legislativa"],
            "key_claims": ["El agua como bien de dominio público", "Prioridad para consumo humano"],
            "methodology_or_approach": "Enfoque ecosistémico y canon hídrico",
            "thematic_modules": [
                {
                    "topic": "Régimen Sancionatorio y Tutela Hídrica",
                    "summary": "Establece un régimen sancionatorio estricto para contaminación.",
                    "core_concepts": ["Dominio público", "Canon hídrico"],
                    "practical_applications": ["Inspección y clausura de vertederos ilegales"]
                }
            ],
            "study_guide": {
                "target_audience": "Abogados ambientalistas, ingenieros civiles y administradores",
                "prerequisites": ["Derecho administrativo general"],
                "difficulty_level": "Intermedio",
                "key_takeaways": ["Aplicación práctica de la normativa sobre vertidos"],
                "recommended_reading_path": "Revisar primero principios rectores y luego catálogo de sanciones"
            },
            "limitations": ["No incluye acuíferos transfronterizos"],
            "verdict": "Ley fundamental para la seguridad hídrica nacional.",
            "confidence_score": 0.96
        }
        return json.dumps(payload)


@pytest.fixture
def dossier_client():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
    mock_analyzer = StructuredDocumentAnalyzer(default_llm_client=MockAnalyzerLLM())
    app = create_app(project_manager=mgr, analyzer=mock_analyzer)
    client = TestClient(app)
    yield client, mgr
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_dossier_analyze_and_get_endpoints(dossier_client):
    client, mgr = dossier_client

    # 1. Create project
    proj_res = client.post("/api/projects", json={"name": "Recursos Hídricos", "description": "Leyes"})
    assert proj_res.status_code == 200
    proj_id = proj_res.json()["id"]

    # 2. Upload file
    file_bytes = b"# Ley de Aguas\n\nArticulo 1: El agua es un bien publico."
    upload_res = client.post(
        f"/api/projects/{proj_id}/sources/upload",
        files={"file": ("ley_aguas.md", io.BytesIO(file_bytes), "text/markdown")}
    )
    assert upload_res.status_code == 200
    source_id = upload_res.json()["id"]

    # 3. GET dossier before analysis -> 404
    get_early = client.get(f"/api/projects/{proj_id}/sources/{source_id}/dossier")
    assert get_early.status_code == 404

    # 4. POST analyze
    analyze_res = client.post(f"/api/projects/{proj_id}/sources/{source_id}/analyze")
    assert analyze_res.status_code == 200
    dossier = analyze_res.json()
    assert dossier["source_id"] == source_id
    assert dossier["title"] == "Ley de Aguas y Recursos Hídricos"
    assert dossier["doc_type"] == "legal_regulatory"
    assert len(dossier["key_claims"]) == 2
    assert len(dossier["thematic_modules"]) == 1
    assert dossier["thematic_modules"][0]["topic"] == "Régimen Sancionatorio y Tutela Hídrica"
    assert dossier["study_guide"]["difficulty_level"] == "Intermedio"
    assert dossier["confidence_score"] == 0.96

    # 5. GET dossier after analysis -> 200 cached
    get_cached = client.get(f"/api/projects/{proj_id}/sources/{source_id}/dossier")
    assert get_cached.status_code == 200
    assert get_cached.json()["title"] == "Ley de Aguas y Recursos Hídricos"
