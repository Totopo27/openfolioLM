import io
import os
import shutil
import tempfile
from unittest.mock import patch, MagicMock
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.adapters.pdf_page_extractor import PageAwarePDFExtractor, format_table_to_markdown
from app.adapters.llm_client import OpenAICompatibleLLMClient
from app.adapters.vision_transcriber import VisionTranscriber
from app.adapters.project_manager import ProjectManager
from app.main import create_app


def test_format_table_to_markdown():
    raw_table = [
        ["Métrica", "Valor", "Observaciones"],
        ["Rendimiento", "85%", "Excelente resultado\nen prueba piloto"],
        ["Latencia", "45ms", None],
        ["Costo", "$120", "Estimado mensual"],
    ]

    md = format_table_to_markdown(raw_table)
    assert "| Métrica | Valor | Observaciones |" in md
    assert "| :--- | :--- | :--- |" in md
    assert "| Rendimiento | 85% | Excelente resultado en prueba piloto |" in md or "Excelente resultado" in md
    assert "| Latencia | 45ms |  |" in md
    assert "\n\n" in md


def test_format_table_jagged_rows():
    raw_table = [
        ["A", "B", "C"],
        ["1", "2"],
        ["X", "Y", "Z", "EXTRA"],
    ]
    md = format_table_to_markdown(raw_table)
    assert "| A | B | C | Columna 4 |" in md
    assert "| 1 | 2 |  |  |" in md
    assert "| X | Y | Z | EXTRA |" in md


def test_format_table_empty():
    assert format_table_to_markdown([]) == ""
    assert format_table_to_markdown([[], []]) == ""


def test_llm_client_generate_with_image():
    client = OpenAICompatibleLLMClient(base_url="https://mock.ai/v1", api_key="test-key")

    # Create dummy 10x10 PNG
    img = Image.new("RGB", (10, 10), color="blue")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="PNG")
    raw_bytes = img_byte_arr.getvalue()

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "```mermaid\ngraph TD\nA --> B\n```"}}]
    }

    with patch("httpx.Client.post", return_value=mock_response) as mock_post:
        result = client.generate_with_image(
            system_prompt="Analyze diagrams",
            user_prompt="Transcribe figure",
            image_bytes=raw_bytes,
            mime_type="image/png"
        )
        assert "graph TD" in result
        assert mock_post.called

        called_payload = mock_post.call_args[1]["json"]
        user_msg = called_payload["messages"][1]
        assert isinstance(user_msg["content"], list)
        assert user_msg["content"][0]["type"] == "text"
        assert user_msg["content"][1]["type"] == "image_url"
        assert user_msg["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_vision_transcriber_service():
    mock_llm = MagicMock()
    mock_llm.generate_with_image.return_value = (
        "```mermaid\n"
        "graph TD\n"
        "  Sensor --> Controller\n"
        "  Controller --> Actuator\n"
        "```\n"
        "Diagrama de lazo de control cerrado."
    )

    transcriber = VisionTranscriber(llm_client=mock_llm, enabled=True)

    img = Image.new("RGB", (50, 50), color="red")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="PNG")

    res = transcriber.transcribe(img_byte_arr.getvalue(), page_number=3, figure_index=1)
    assert res is not None
    assert "```mermaid" in res
    assert "Sensor --> Controller" in res


def test_pdf_page_extractor_with_tables():
    # Use the real sample PDF in repository with known tables
    sample_path = "backend/data/projects/proj_2_939f2e/uploads/38ac6bdf1f034bb8b8d1e38345cf2e10_AgroTrace_TerraPass_Antecedentes_y_Casos_de_Estudio.pdf"
    if not os.path.exists(sample_path):
        pytest.skip("Sample PDF not found")

    extractor = PageAwarePDFExtractor(extract_tables=True)
    res = extractor.extract(sample_path)

    assert res.page_count == 2
    assert ("| :---" in res.raw_markdown) or ("| ---" in res.raw_markdown)


def test_pdf_page_extractor_figure_extraction():
    sample_path = "backend/data/projects/proj_default/uploads/Electronic Music and Sound Design - Theory and Practice with Max_MSP - volume 1.pdf"
    if not os.path.exists(sample_path):
        pytest.skip("Max MSP sample PDF not found")

    temp_assets_dir = tempfile.mkdtemp()
    try:
        extractor = PageAwarePDFExtractor(
            extract_tables=True,
            extract_figures=True,
            assets_dir=temp_assets_dir,
            max_pages=5,  # Test first 5 pages for speed
            asset_url_prefix="/api/projects/p1/assets/doc1"
        )
        res = extractor.extract(sample_path)

        assert res.page_count > 0
        # Check that figure links were inserted in markdown and assets saved
        saved_files = os.listdir(temp_assets_dir)
        if saved_files:
            assert any(f.endswith(".png") for f in saved_files)
            assert "/api/projects/p1/assets/doc1/" in res.raw_markdown
    finally:
        shutil.rmtree(temp_assets_dir, ignore_errors=True)


def test_api_project_assets_endpoint():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
    app = create_app(project_manager=mgr)
    client = TestClient(app)

    try:
        # Create project
        create_res = client.post("/api/projects", json={"name": "Asset Test"})
        assert create_res.status_code == 200
        proj_id = create_res.json()["id"]

        # Create dummy asset in project assets dir
        proj_assets_dir = os.path.join(temp_dir, proj_id, "assets", "doc_test123")
        os.makedirs(proj_assets_dir, exist_ok=True)
        img_path = os.path.join(proj_assets_dir, "fig_p1_1.png")

        img = Image.new("RGB", (20, 20), color="green")
        img.save(img_path, format="PNG")

        # Request asset via API endpoint
        resp = client.get(f"/api/projects/{proj_id}/assets/doc_test123/fig_p1_1.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert len(resp.content) > 0

        # Request nonexistent asset
        resp_404 = client.get(f"/api/projects/{proj_id}/assets/doc_test123/nonexistent.png")
        assert resp_404.status_code == 404
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_minicpm_vlm_config_and_wiring():
    from app.core.config import settings
    from app.adapters.hybrid_ingester import HybridDocumentIngester
    from app.adapters.markitdown_adapter import MarkItDownAdapter

    # Check defaults
    assert settings.vision_model == "minicpm-v4.6"
    assert settings.vision_provider == "ollama"
    assert settings.enable_vision_transcription is True

    # Check wiring from HybridDocumentIngester down to MarkItDownAdapter
    mock_transcriber = MagicMock()
    hybrid = HybridDocumentIngester(vision_transcriber=mock_transcriber)
    assert hybrid._vision_transcriber is mock_transcriber
    assert hybrid._markitdown._vision_transcriber is mock_transcriber

    # Check MarkItDownAdapter holds vision_transcriber
    md = MarkItDownAdapter(vision_transcriber=mock_transcriber)
    assert md._vision_transcriber is mock_transcriber

