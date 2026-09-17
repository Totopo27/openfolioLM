import time
from unittest.mock import MagicMock
import tempfile
import shutil
import pytest
from fastapi.testclient import TestClient

from app.adapters.semantic_scholar_adapter import SemanticScholarAdapter, normalize_doi
from app.adapters.academic_resolver import CompositeAcademicResolver
from app.ports.academic_resolver import AcademicPaper
from app.adapters.project_manager import ProjectManager
from app.adapters.hybrid_ingester import HybridDocumentIngester
from app.main import create_app


def test_normalize_doi_s2():
    assert normalize_doi("10.1145/12345.67890") == "10.1145/12345.67890"
    assert normalize_doi("https://doi.org/10.1038/s41586-020-2649-2") == "10.1038/s41586-020-2649-2"
    assert normalize_doi("doi: 10.1007/978-3-642-12345-6.") == "10.1007/978-3-642-12345-6"
    assert normalize_doi("invalid-string") is None


def test_rate_limiter_enforces_interval():
    adapter = SemanticScholarAdapter(api_key="mock", min_interval_seconds=0.08)
    t0 = time.time()
    adapter._enforce_rate_limit()
    adapter._enforce_rate_limit()
    elapsed = time.time() - t0
    assert elapsed >= 0.075


def test_parse_s2_paper_metadata():
    adapter = SemanticScholarAdapter(api_key="mock")
    raw_item = {
        "paperId": "abc123def456",
        "title": "Real-time Granular Synthesis in Max/MSP",
        "authors": [{"name": "Miller Puckette"}, {"name": "Curtis Roads"}],
        "year": 2021,
        "venue": "Computer Music Journal",
        "abstract": "A comprehensive study on digital signal processing algorithms.",
        "citationCount": 42,
        "isOpenAccess": True,
        "openAccessPdf": {
            "url": "https://example.com/granular_synthesis.pdf",
            "status": "GREEN",
        },
        "tldr": {
            "model": "tldr@v2.0.0",
            "text": "This paper presents efficient granular synthesis techniques for real-time audio systems."
        },
        "externalIds": {
            "DOI": "10.1162/COMJ_a_00550",
            "ArXiv": "2101.12345"
        },
        "url": "https://www.semanticscholar.org/paper/abc123def456"
    }

    paper = adapter._parse_s2_paper(raw_item)
    assert paper is not None
    assert paper.doi == "10.1162/COMJ_a_00550"
    assert paper.title == "Real-time Granular Synthesis in Max/MSP"
    assert paper.authors == ["Miller Puckette", "Curtis Roads"]
    assert paper.publication_year == 2021
    assert paper.venue == "Computer Music Journal"
    assert paper.citations_count == 42
    assert paper.is_open_access is True
    assert paper.pdf_url == "https://example.com/granular_synthesis.pdf"
    assert paper.tldr == "This paper presents efficient granular synthesis techniques for real-time audio systems."
    assert paper.source_provider == "semanticscholar"
    assert "@article{" in (paper.bibtex or "")
    assert "roads" in (paper.bibtex or "").lower() or "puckette" in (paper.bibtex or "").lower()


def test_search_papers_with_mock_client():
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [
            {
                "paperId": "s2_1",
                "title": "Faust: A Functional Language for DSP",
                "authors": [{"name": "Yann Orlarey"}],
                "year": 2009,
                "citationCount": 350,
                "openAccessPdf": {"url": "https://faust.grame.fr/paper.pdf"},
                "externalIds": {"DOI": "10.1007/s10543-009-0218-8"},
                "tldr": {"text": "Faust is a domain-specific programming language for DSP."}
            },
            {
                "paperId": "s2_2",
                "title": "Low Citation Paper",
                "authors": [{"name": "Anonymous"}],
                "year": 2024,
                "citationCount": 2,
                "externalIds": {},
            }
        ]
    }
    mock_client.get.return_value = mock_resp

    adapter = SemanticScholarAdapter(api_key="mock", min_interval_seconds=0.0, http_client=mock_client)
    results = adapter.search_papers(query="faust audio", limit=10, min_citations=10)

    assert len(results) == 1
    assert results[0].title == "Faust: A Functional Language for DSP"
    assert results[0].citations_count == 350
    assert results[0].tldr == "Faust is a domain-specific programming language for DSP."


def test_federated_search_deduplication():
    mock_s2 = MagicMock()
    mock_s2.search_papers.return_value = [
        AcademicPaper(
            doi="10.1038/s41586-020-2649-2",
            title="Quantum Advantage in Computing",
            authors=["John Martinis"],
            publication_year=2019,
            venue="Nature",
            citations_count=3000,
            tldr="Demonstration of quantum supremacy using 53 qubits.",
            pdf_url="https://nature.com/article.pdf",
            is_open_access=True,
            source_provider="semanticscholar",
        ),
        AcademicPaper(
            doi="10.1145/s2-only",
            title="Semantic Scholar Unique Paper",
            authors=["S2 Author"],
            publication_year=2022,
            citations_count=15,
            source_provider="semanticscholar",
        )
    ]

    resolver = CompositeAcademicResolver(semantic_scholar=mock_s2)
    resolver._search_openalex = MagicMock(return_value=[
        AcademicPaper(
            doi="10.1038/s41586-020-2649-2",
            title="Quantum Advantage in Computing",
            authors=["J. Martinis", "A. Megrant"],
            abstract="Detailed experimental quantum advantage study.",
            publication_year=2019,
            venue="Nature",
            citations_count=2900,
            source_provider="openalex",
        ),
        AcademicPaper(
            doi="10.1145/openalex-only",
            title="OpenAlex Unique Paper",
            authors=["OA Author"],
            publication_year=2023,
            citations_count=20,
            source_provider="openalex",
        )
    ])

    # Test 'all' (Federated)
    federated_papers = resolver.search_literature(query="quantum", limit=10, provider="all")
    assert len(federated_papers) == 3

    # Deduplicated paper should have source_provider="both", S2's TLDR, and merged abstract
    dup = next(p for p in federated_papers if p.doi == "10.1038/s41586-020-2649-2")
    assert dup.source_provider == "both"
    assert dup.tldr == "Demonstration of quantum supremacy using 53 qubits."
    assert dup.abstract == "Detailed experimental quantum advantage study."
    assert dup.citations_count == 3000

    # Test provider selection
    s2_only = resolver.search_literature(query="quantum", limit=10, provider="semanticscholar")
    assert len(s2_only) == 2
    assert s2_only[0].title == "Quantum Advantage in Computing"

    oa_only = resolver.search_literature(query="quantum", limit=10, provider="openalex")
    assert len(oa_only) == 2
    assert oa_only[1].doi == "10.1145/openalex-only"


def test_api_discovery_search_with_provider():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)

    mock_resolver = MagicMock()
    paper_s2 = AcademicPaper(
        doi="10.1145/sound.2023",
        title="Digital Audio Synthesis with Max/MSP",
        authors=["IRCAM Researcher"],
        publication_year=2023,
        citations_count=88,
        tldr="Analysis of real-time audio algorithms in MSP.",
        source_provider="semanticscholar",
    )
    mock_resolver.search_literature.return_value = [paper_s2]

    ingester = HybridDocumentIngester(academic_resolver=mock_resolver)
    app = create_app(project_manager=mgr, ingester=ingester, academic_resolver=mock_resolver)
    client = TestClient(app)

    try:
        create_res = client.post("/api/projects", json={"name": "Audio Lab"})
        proj_id = create_res.json()["id"]

        # Call endpoint with provider=semanticscholar
        res = client.get(f"/api/projects/{proj_id}/discovery/search?query=audio+synthesis&provider=semanticscholar")
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["title"] == "Digital Audio Synthesis with Max/MSP"
        assert data[0]["tldr"] == "Analysis of real-time audio algorithms in MSP."
        assert data[0]["source_provider"] == "semanticscholar"
        mock_resolver.search_literature.assert_called_with(
            query="audio synthesis",
            limit=15,
            min_year=None,
            min_citations=0,
            provider="semanticscholar",
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
