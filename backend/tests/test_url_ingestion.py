import io
import shutil
import tempfile
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.adapters.markitdown_adapter import MarkItDownAdapter
from app.adapters.project_manager import ProjectManager


def test_markitdown_ingest_url_success():
    adapter = MarkItDownAdapter()
    sample_html = b"<!DOCTYPE html><html><head><title>Econ 101 Guide</title></head><body><h1>Microeconomics</h1><p>Supply and demand dictate market equilibrium.</p></body></html>"
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = sample_html
    mock_resp.text = sample_html.decode("utf-8")
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.Client.get", return_value=mock_resp):
        doc = adapter.ingest_url("https://example.com/econ-guide", title_override="Custom Economics")
        assert doc.id.startswith("doc_")
        assert doc.filename == "Custom Economics"
        assert doc.mime_type == "text/html"
        assert "Supply and demand" in doc.raw_markdown
        assert doc.metadata["source_url"] == "https://example.com/econ-guide"
        assert doc.metadata["page_title"] == "Econ 101 Guide"


def test_markitdown_ingest_url_default_title():
    adapter = MarkItDownAdapter()
    sample_html = b"<!DOCTYPE html><html><head><title>Default Page Title</title></head><body><p>Article body.</p></body></html>"
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = sample_html
    mock_resp.text = sample_html.decode("utf-8")
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.Client.get", return_value=mock_resp):
        doc = adapter.ingest_url("https://example.com/article")
        assert doc.filename == "Default Page Title"
        assert "Article body" in doc.raw_markdown


def test_api_project_url_ingestion():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
    app = create_app(project_manager=mgr)
    client = TestClient(app)

    try:
        # Create project
        create_res = client.post("/api/projects", json={"name": "Web Research"})
        assert create_res.status_code == 200
        proj_id = create_res.json()["id"]

        sample_html = b"<!DOCTYPE html><html><head><title>Quantum Computing</title></head><body><p>Qubits leverage superposition.</p></body></html>"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = sample_html
        mock_resp.text = sample_html.decode("utf-8")
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.Client.get", return_value=mock_resp):
            url_res = client.post(
                f"/api/projects/{proj_id}/sources/url",
                json={"url": "https://example.com/quantum", "title": "Quantum Intro"}
            )
            assert url_res.status_code == 200
            data = url_res.json()
            assert data["filename"] == "Quantum Intro"
            assert data["mime_type"] == "text/html"

        # Verify source is stored and searchable in store
        store = mgr.get_store(proj_id)
        sources = store.list_documents()
        assert len(sources) == 1
        assert sources[0].id == data["id"]
        
        chunks = store.search_chunks("superposition", active_source_ids=[data["id"]])
        assert len(chunks) > 0
        assert "superposition" in chunks[0].content
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_markitdown_ingest_url_fallback_on_403():
    from app.adapters.stealth_scraper import RenderedPage
    mock_stealth = MagicMock()
    mock_stealth.extract_rendered_html.return_value = RenderedPage(
        html="<!DOCTYPE html><html><head><title>Cloudflare Passed</title></head><body><h1>Deep Article</h1><p>Content rendered after bot challenge bypass.</p></body></html>",
        title="Cloudflare Passed",
        final_url="https://protected.com/article",
        engine="playwright_stealth"
    )

    adapter = MarkItDownAdapter(stealth_scraper=mock_stealth)

    # Simulate 403 Forbidden from httpx
    mock_resp = MagicMock()
    mock_resp.status_code = 403

    with patch("httpx.Client.get", return_value=mock_resp):
        doc = adapter.ingest_url("https://protected.com/article")
        assert doc.filename == "Cloudflare Passed"
        assert "Content rendered after bot challenge bypass" in doc.raw_markdown
        assert doc.metadata["fetch_engine"] == "playwright_stealth"
        assert mock_stealth.extract_rendered_html.called


def test_markitdown_ingest_url_fallback_on_spa_shell():
    from app.adapters.stealth_scraper import RenderedPage
    mock_stealth = MagicMock()
    mock_stealth.extract_rendered_html.return_value = RenderedPage(
        html="<!DOCTYPE html><html><head><title>Hydrated React App</title></head><body><div id='root'><h1>Dashboard</h1><p>Client side metrics loaded successfully.</p></div></body></html>",
        title="Hydrated React App",
        final_url="https://react-spa.io/app",
        engine="omni_scraper_session"
    )

    adapter = MarkItDownAdapter(stealth_scraper=mock_stealth)

    # Simulate an empty SPA shell returned by HTTP GET
    spa_html = b"<!DOCTYPE html><html><head><title>React App</title></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id='root'></div></body></html>"
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = spa_html
    mock_resp.text = spa_html.decode("utf-8")
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.Client.get", return_value=mock_resp):
        doc = adapter.ingest_url("https://react-spa.io/app")
        assert doc.filename == "Hydrated React App"
        assert "Client side metrics loaded successfully" in doc.raw_markdown
        assert doc.metadata["fetch_engine"] == "omni_scraper_session"
        assert mock_stealth.extract_rendered_html.called

