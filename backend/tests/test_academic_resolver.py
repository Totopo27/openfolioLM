"""Tests for the Academic / DOI Resolver and Ingestion Pipeline."""

import shutil
import tempfile
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ports.academic_resolver import AcademicPaper, AcademicResolverPort
from app.adapters.academic_resolver import (
    CompositeAcademicResolver,
    normalize_doi,
    reconstruct_abstract,
)
from app.adapters.markitdown_adapter import MarkItDownAdapter, UnsafeURLError
from app.adapters.hybrid_ingester import HybridDocumentIngester
from app.adapters.project_manager import ProjectManager
from app.core.models import SourceDocument


def test_normalize_doi():
    assert normalize_doi("10.1353/pnm.2010.0009") == "10.1353/pnm.2010.0009"
    assert normalize_doi("https://doi.org/10.1353/pnm.2010.0009") == "10.1353/pnm.2010.0009"
    assert normalize_doi("http://dx.doi.org/10.1038/s41586-020-2649-2.") == "10.1038/s41586-020-2649-2"
    assert normalize_doi("doi: 10.1145/3372278.3390678") == "10.1145/3372278.3390678"
    assert normalize_doi("https://doi.org/10.1000/182/") == "10.1000/182"
    assert normalize_doi("https://es.wikipedia.org/wiki/Python") is None
    assert normalize_doi("random string without identifier") is None
    assert normalize_doi(None) is None


def test_reconstruct_abstract():
    inverted_index = {
        "Microtonal": [0],
        "music": [1, 5],
        "theories": [2],
        "and": [3],
        "algorithmic": [4],
        "composition": [6],
    }
    reconstructed = reconstruct_abstract(inverted_index)
    assert reconstructed == "Microtonal music theories and algorithmic music composition"
    assert reconstruct_abstract(None) == ""
    assert reconstruct_abstract({}) == ""


def test_resolve_openalex_oa_paper():
    mock_client = MagicMock()
    mock_oa_resp = MagicMock()
    mock_oa_resp.status_code = 200
    mock_oa_resp.json.return_value = {
        "title": "Open Access Paper on Quantum ML",
        "publication_year": 2023,
        "cited_by_count": 42,
        "authorships": [
            {"author": {"display_name": "Alice Turing"}},
            {"author": {"display_name": "Bob von Neumann"}},
        ],
        "primary_location": {
            "source": {"display_name": "Physical Review Research"},
            "landing_page_url": "https://doi.org/10.1103/PhysRevResearch.5.013000"
        },
        "open_access": {
            "is_oa": True,
            "oa_url": "https://journals.aps.org/prresearch/pdf/10.1103/PhysRevResearch.5.013000"
        },
        "best_oa_location": {
            "pdf_url": "https://journals.aps.org/prresearch/pdf/10.1103/PhysRevResearch.5.013000"
        },
        "biblio": {"volume": "5", "issue": "1", "first_page": "013000"}
    }
    mock_client.get.return_value = mock_oa_resp

    resolver = CompositeAcademicResolver(http_client=mock_client)
    paper = resolver.resolve("10.1103/PhysRevResearch.5.013000")

    assert paper is not None
    assert paper.title == "Open Access Paper on Quantum ML"
    assert paper.authors == ["Alice Turing", "Bob von Neumann"]
    assert paper.publication_year == 2023
    assert paper.is_open_access is True
    assert paper.pdf_url == "https://journals.aps.org/prresearch/pdf/10.1103/PhysRevResearch.5.013000"
    assert paper.citations_count == 42
    assert "@article{" in paper.bibtex


def test_resolve_closed_paper_with_abstract_reconstruction():
    mock_client = MagicMock()
    mock_oa_resp = MagicMock()
    mock_oa_resp.status_code = 200
    mock_oa_resp.json.return_value = {
        "title": "A Computational Model for Rule-Based Microtonal Music",
        "publication_year": 2010,
        "cited_by_count": 15,
        "abstract_inverted_index": {
            "This": [0],
            "paper": [1],
            "presents": [2],
            "microtonal": [3],
            "constraints": [4],
        },
        "authorships": [
            {"author": {"display_name": "Torsten Anders"}},
            {"author": {"display_name": "Eduardo R. Miranda"}},
        ],
        "primary_location": {
            "source": {"display_name": "Perspectives of New Music"},
            "landing_page_url": "https://muse.jhu.edu/article/409605"
        },
        "open_access": {
            "is_oa": False,
            "oa_url": None
        },
        "best_oa_location": None,
        "biblio": {"volume": "48", "issue": "2", "first_page": "47", "last_page": "77"}
    }
    mock_client.get.return_value = mock_oa_resp

    resolver = CompositeAcademicResolver(http_client=mock_client)
    paper = resolver.resolve("10.1353/pnm.2010.0009")

    assert paper is not None
    assert paper.title == "A Computational Model for Rule-Based Microtonal Music"
    assert paper.abstract == "This paper presents microtonal constraints"
    assert paper.is_open_access is False
    assert paper.pdf_url is None
    assert paper.volume == "48"
    assert paper.pages == "47-77"

    markdown = resolver.build_academic_markdown(paper)
    assert "# A Computational Model for Rule-Based Microtonal Music" in markdown
    assert "Torsten Anders, Eduardo R. Miranda" in markdown
    assert "This paper presents microtonal constraints" in markdown
    assert "@article{" in markdown


def test_hybrid_ingester_oa_routes_to_docling():
    mock_resolver = MagicMock()
    mock_resolver.is_doi.return_value = True
    mock_resolver.resolve.return_value = AcademicPaper(
        doi="10.1371/journal.pone.0246282",
        title="PLOS ONE Water Startups",
        authors=["Author One"],
        publication_year=2021,
        is_open_access=True,
        pdf_url="https://journals.plos.org/plosone/article/file?id=test&type=printable",
        landing_page_url="https://doi.org/10.1371/journal.pone.0246282",
        bibtex="@article{test}"
    )

    mock_docling = MagicMock()
    mock_docling.convert.return_value = SourceDocument(
        id="doc_test123",
        filename="PLOS ONE Water Startups.pdf",
        mime_type="application/pdf",
        raw_markdown="## Deep parsed tables and text from Docling",
        char_count=50,
        metadata={}
    )

    ingester = HybridDocumentIngester(
        docling_adapter=mock_docling,
        academic_resolver=mock_resolver,
        enable_docling=True
    )

    mock_pdf_resp = MagicMock()
    mock_pdf_resp.status_code = 200
    pdf_bytes = b"%PDF-1.4 mock binary content" * 100
    mock_pdf_resp.raise_for_status = MagicMock()
    mock_pdf_resp.headers = {"content-length": str(len(pdf_bytes))}
    mock_pdf_resp.iter_bytes.return_value = [pdf_bytes]
    mock_pdf_resp.url = "https://journals.plos.org/plosone/article/file?id=test&type=printable"
    mock_stream = MagicMock()
    mock_stream.__enter__.return_value = mock_pdf_resp

    with (
        patch.object(MarkItDownAdapter, "_validate_public_url"),
        patch("httpx.Client.stream", return_value=mock_stream),
    ):
        doc = ingester.ingest_url("10.1371/journal.pone.0246282")

        assert doc.metadata["doi"] == "10.1371/journal.pone.0246282"
        assert doc.metadata["is_open_access"] is True
        assert "Deep parsed tables and text from Docling" in doc.raw_markdown
        assert "# PLOS ONE Water Startups" in doc.raw_markdown
        assert mock_docling.convert.called


def test_hybrid_ingester_rejects_private_academic_pdf_url():
    ingester = HybridDocumentIngester()

    with patch("httpx.Client.stream") as mock_stream:
        with pytest.raises(UnsafeURLError):
            ingester._download_public_pdf("http://127.0.0.1/private.pdf", {})

    mock_stream.assert_not_called()


def test_hybrid_ingester_validates_academic_pdf_redirects():
    ingester = HybridDocumentIngester()
    redirect_response = MagicMock()
    redirect_response.status_code = 302
    redirect_response.headers = {"location": "http://127.0.0.1/private.pdf"}
    redirect_response.url = "https://example.com/paper.pdf"
    redirect_response.request = MagicMock()
    mock_stream = MagicMock()
    mock_stream.__enter__.return_value = redirect_response

    def validate(url):
        if url.startswith("http://127.0.0.1"):
            raise UnsafeURLError("private target")

    with (
        patch.object(MarkItDownAdapter, "_validate_public_url", side_effect=validate),
        patch("httpx.Client.stream", return_value=mock_stream),
        pytest.raises(UnsafeURLError),
    ):
        ingester._download_public_pdf("https://example.com/paper.pdf", {})


def test_hybrid_ingester_limits_streamed_academic_pdf(monkeypatch):
    ingester = HybridDocumentIngester()
    response = MagicMock()
    response.status_code = 200
    response.headers = {}
    response.url = "https://example.com/paper.pdf"
    response.iter_bytes.return_value = [b"%PDF", b"overflow"]
    mock_stream = MagicMock()
    mock_stream.__enter__.return_value = response
    monkeypatch.setattr("app.adapters.hybrid_ingester.MAX_ACADEMIC_PDF_BYTES", 4)

    with (
        patch.object(MarkItDownAdapter, "_validate_public_url"),
        patch("httpx.Client.stream", return_value=mock_stream),
        pytest.raises(ValueError, match="exceeds the allowed size"),
    ):
        ingester._download_public_pdf("https://example.com/paper.pdf", {})


def test_hybrid_ingester_closed_access_synthesizes_markdown():
    mock_resolver = MagicMock()
    mock_resolver.is_doi.return_value = True
    paper = AcademicPaper(
        doi="10.1353/pnm.2010.0009",
        title="Microtonal Music Theories",
        authors=["Torsten Anders", "Eduardo R. Miranda"],
        abstract="Constraint satisfaction in microtonal composition.",
        publication_year=2010,
        venue="Perspectives of New Music",
        is_open_access=False,
        pdf_url=None,
        landing_page_url="https://doi.org/10.1353/pnm.2010.0009",
        citations_count=18,
        bibtex="@article{anders2010}"
    )
    mock_resolver.resolve.return_value = paper
    mock_resolver.build_academic_markdown.return_value = "# Microtonal Music Theories\n\nAbstract content here."

    ingester = HybridDocumentIngester(academic_resolver=mock_resolver)
    doc = ingester.ingest_url("10.1353/pnm.2010.0009")

    assert doc.filename == "Microtonal Music Theories"
    assert doc.mime_type == "text/markdown"
    assert doc.metadata["doi"] == "10.1353/pnm.2010.0009"
    assert doc.metadata["is_open_access"] is False
    assert "Abstract content here." in doc.raw_markdown


def test_api_project_doi_ingestion():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)

    mock_resolver = MagicMock()
    mock_resolver.is_doi.return_value = True
    paper = AcademicPaper(
        doi="10.1353/pnm.2010.0009",
        title="Microtonal Theories and Composition",
        authors=["Torsten Anders", "Eduardo R. Miranda"],
        abstract="Novel algorithmic music theory based on pitch constraints.",
        publication_year=2010,
        venue="Perspectives of New Music",
        is_open_access=False,
        landing_page_url="https://doi.org/10.1353/pnm.2010.0009",
        bibtex="@article{anders2010}"
    )
    mock_resolver.resolve.return_value = paper
    mock_resolver.build_academic_markdown.return_value = (
        "# Microtonal Theories and Composition\n\nNovel algorithmic music theory based on pitch constraints."
    )

    ingester = HybridDocumentIngester(academic_resolver=mock_resolver)
    app = create_app(project_manager=mgr, ingester=ingester, academic_resolver=mock_resolver)
    client = TestClient(app)

    try:
        create_res = client.post("/api/projects", json={"name": "Music AI Research"})
        assert create_res.status_code == 200
        proj_id = create_res.json()["id"]

        # Ingest DOI via sources/url endpoint
        url_res = client.post(
            f"/api/projects/{proj_id}/sources/url",
            json={"url": "10.1353/pnm.2010.0009"}
        )
        assert url_res.status_code == 200
        data = url_res.json()
        assert data["filename"] == "Microtonal Theories and Composition"
        assert data["metadata"]["doi"] == "10.1353/pnm.2010.0009"

        # Verify stored in SQLite and searchable via FTS5
        store = mgr.get_store(proj_id)
        docs = store.list_documents()
        assert len(docs) == 1
        assert docs[0].id == data["id"]

        chunks = store.search_chunks("algorithmic", active_source_ids=[data["id"]])
        assert len(chunks) > 0
        assert "algorithmic" in chunks[0].content

        # Verify deduplication: ingesting the exact same DOI again does NOT create a 2nd document
        url_res_dup = client.post(
            f"/api/projects/{proj_id}/sources/url",
            json={"url": "https://doi.org/10.1353/pnm.2010.0009"}
        )
        assert url_res_dup.status_code == 200
        docs_after = store.list_documents()
        assert len(docs_after) == 1
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_search_literature_mocked():
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "results": [
            {
                "id": "https://openalex.org/W123456",
                "doi": "https://doi.org/10.1038/s41586-020-2649-2",
                "title": "Quantum Supremacy using a Programmable Superconducting Processor",
                "publication_year": 2019,
                "cited_by_count": 2500,
                "authorships": [{"author": {"display_name": "John Martinis"}}],
                "abstract_inverted_index": {"Quantum": [0], "computational": [1], "advantage": [2]},
                "open_access": {"is_oa": True, "oa_url": "https://example.com/quantum.pdf"},
                "best_oa_location": {"pdf_url": "https://example.com/quantum.pdf"}
            }
        ]
    }
    mock_client.get.return_value = mock_resp

    resolver = CompositeAcademicResolver(http_client=mock_client)
    papers = resolver.search_literature(query="quantum supremacy", limit=5)

    assert len(papers) == 1
    assert papers[0].doi == "10.1038/s41586-020-2649-2"
    assert papers[0].title == "Quantum Supremacy using a Programmable Superconducting Processor"
    assert papers[0].citations_count == 2500
    assert papers[0].is_open_access is True
    assert papers[0].abstract == "Quantum computational advantage"


def test_api_discovery_search_and_batch_ingest():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)

    mock_resolver = MagicMock()
    paper = AcademicPaper(
        doi="10.1038/s41586-020-2649-2",
        title="Quantum Supremacy Nature",
        authors=["John Martinis"],
        abstract="Demonstrating quantum computational advantage.",
        publication_year=2019,
        venue="Nature",
        is_open_access=False,
        landing_page_url="https://doi.org/10.1038/s41586-020-2649-2",
        citations_count=2500,
        bibtex="@article{martinis2019}"
    )
    mock_resolver.search_literature.return_value = [paper]
    mock_resolver.is_doi.return_value = True
    mock_resolver.resolve.return_value = paper
    mock_resolver.build_academic_markdown.return_value = "# Quantum Supremacy Nature\n\nFull abstract here."

    ingester = HybridDocumentIngester(academic_resolver=mock_resolver)
    app = create_app(project_manager=mgr, ingester=ingester, academic_resolver=mock_resolver)
    client = TestClient(app)

    try:
        create_res = client.post("/api/projects", json={"name": "Quantum Research"})
        proj_id = create_res.json()["id"]

        # Search discovery
        search_res = client.get(f"/api/projects/{proj_id}/discovery/search?query=quantum+supremacy")
        assert search_res.status_code == 200
        papers_data = search_res.json()
        assert len(papers_data) == 1
        assert papers_data[0]["doi"] == "10.1038/s41586-020-2649-2"

        # Ingest selected papers
        ingest_res = client.post(
            f"/api/projects/{proj_id}/discovery/ingest",
            json={"dois": ["10.1038/s41586-020-2649-2"]}
        )
        assert ingest_res.status_code == 200
        docs_data = ingest_res.json()
        assert len(docs_data) == 1
        assert docs_data[0]["filename"] == "Quantum Supremacy Nature"

        # Verify in store
        store = mgr.get_store(proj_id)
        assert store.count_documents() == 1
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

