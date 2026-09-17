import shutil
import tempfile
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.adapters.youtube_ingester import YouTubeIngester
from app.adapters.hybrid_ingester import HybridDocumentIngester
from app.adapters.project_manager import ProjectManager
from app.main import create_app


def test_is_youtube_url():
    ingester = YouTubeIngester()
    assert ingester.is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert ingester.is_youtube_url("https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share")
    assert ingester.is_youtube_url("https://youtu.be/dQw4w9WgXcQ")
    assert ingester.is_youtube_url("http://youtu.be/dQw4w9WgXcQ?t=120")
    assert ingester.is_youtube_url("https://www.youtube.com/embed/dQw4w9WgXcQ")
    assert ingester.is_youtube_url("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    assert ingester.is_youtube_url("https://www.youtube.com/live/dQw4w9WgXcQ")
    assert ingester.is_youtube_url("youtube.com/watch?v=dQw4w9WgXcQ")

    assert not ingester.is_youtube_url("https://example.com/video")
    assert not ingester.is_youtube_url("https://vimeo.com/12345678")
    assert not ingester.is_youtube_url("10.1038/nature12345")


def test_extract_video_id():
    ingester = YouTubeIngester()
    expected = "dQw4w9WgXcQ"
    assert ingester.extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == expected
    assert ingester.extract_video_id("https://youtube.com/watch?v=dQw4w9WgXcQ&t=45s") == expected
    assert ingester.extract_video_id("https://youtu.be/dQw4w9WgXcQ") == expected
    assert ingester.extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == expected
    assert ingester.extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == expected
    assert ingester.extract_video_id("https://www.youtube.com/live/dQw4w9WgXcQ?si=123") == expected
    assert ingester.extract_video_id("https://example.com") is None


def test_format_seconds():
    ingester = YouTubeIngester()
    assert ingester._format_timestamp(45) == "00:45"
    assert ingester._format_timestamp(75) == "01:15"
    assert ingester._format_timestamp(3665) == "01:01:05"


def test_format_transcript_to_markdown():
    ingester = YouTubeIngester()
    metadata = {
        "title": "Quantum Mechanics 101",
        "author_name": "MIT OpenCourseWare",
        "author_url": "https://www.youtube.com/@mitocw",
        "thumbnail_url": "https://i.ytimg.com/vi/test/hqdefault.jpg",
        "video_id": "test_video_123",
        "video_url": "https://www.youtube.com/watch?v=test_video_123",
    }
    raw_snippets = [
        {"text": "Welcome to quantum mechanics.", "start": 0.0, "duration": 2.5},
        {"text": "Today we will discuss the double slit experiment.", "start": 3.0, "duration": 3.2},
        {"text": "Particles act as waves when not observed.", "start": 7.0, "duration": 2.8},
        {"text": "Now let us move to wave function collapse.", "start": 310.0, "duration": 4.0},
        {"text": "This leads directly to Schrodinger's equation.", "start": 315.0, "duration": 3.5},
    ]

    md = ingester.format_transcript_to_markdown(
        metadata=metadata,
        transcript_entries=raw_snippets,
        language="en",
        is_generated=False,
    )

    assert "# Quantum Mechanics 101" in md
    assert "MIT OpenCourseWare" in md
    assert "https://www.youtube.com/watch?v=test_video_123" in md
    assert "[00:00]" in md
    assert "Welcome to quantum mechanics." in md
    assert "[05:10]" in md or "05:" in md
    assert "Schrodinger's equation" in md


def test_youtube_ingester_success():
    ingester = YouTubeIngester()
    mock_metadata = {
        "title": "Lex Fridman Podcast #400 - AI Architecture",
        "author_name": "Lex Fridman",
        "author_url": "https://www.youtube.com/@lexfridman",
        "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }
    mock_transcript = [
        {"text": "Welcome everyone.", "start": 0.0, "duration": 2.0},
        {"text": "Today we discuss deep neural models.", "start": 2.5, "duration": 3.0},
    ]

    with patch.object(ingester, "fetch_metadata", return_value=mock_metadata):
        with patch.object(ingester, "fetch_transcript", return_value=(mock_transcript, "en", False)):
            doc = ingester.ingest("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

            assert doc.id.startswith("doc_")
            assert doc.filename == "Lex Fridman Podcast #400 - AI Architecture"
            assert doc.mime_type == "text/markdown"
            assert doc.metadata["is_youtube"] is True
            assert doc.metadata["video_id"] == "dQw4w9WgXcQ"
            assert doc.metadata["channel"] == "Lex Fridman"
            assert doc.metadata["author"] == "Lex Fridman"
            assert doc.metadata["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            assert "Welcome everyone" in doc.raw_markdown


def test_youtube_ingester_with_title_override():
    ingester = YouTubeIngester()
    mock_metadata = {
        "title": "Original YouTube Title",
        "author_name": "Tech Talks",
        "author_url": "https://www.youtube.com/@tech",
        "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }
    mock_transcript = [
        {"text": "Hello world.", "start": 0.0, "duration": 1.5},
    ]

    with patch.object(ingester, "fetch_metadata", return_value=mock_metadata):
        with patch.object(ingester, "fetch_transcript", return_value=(mock_transcript, "en", True)):
            doc = ingester.ingest(
                "https://youtu.be/dQw4w9WgXcQ",
                title_override="Custom Lecture Title"
            )
            assert doc.filename == "Custom Lecture Title"
            assert doc.metadata["is_generated_transcript"] is True


def test_youtube_ingestion_routed_in_hybrid_ingester():
    hybrid = HybridDocumentIngester()
    mock_metadata = {
        "title": "Stanford CS229: Machine Learning",
        "author_name": "Stanford Online",
        "author_url": "https://www.youtube.com/@stanfordonline",
        "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }
    mock_transcript = [
        {"text": "Welcome to CS229.", "start": 0.0, "duration": 2.0},
    ]

    with patch.object(hybrid._youtube_ingester, "fetch_metadata", return_value=mock_metadata):
        with patch.object(hybrid._youtube_ingester, "fetch_transcript", return_value=(mock_transcript, "en", False)):
            doc = hybrid.ingest_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
            assert doc.metadata["is_youtube"] is True
            assert doc.metadata["channel"] == "Stanford Online"
            assert "Welcome to CS229" in doc.raw_markdown


def test_youtube_api_project_url_endpoint():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
    app = create_app(project_manager=mgr)
    client = TestClient(app)

    try:
        # Create project
        create_res = client.post("/api/projects", json={"name": "Video Research"})
        assert create_res.status_code == 200
        proj_id = create_res.json()["id"]

        mock_metadata = {
            "title": "Neural Networks Demystified",
            "author_name": "3Blue1Brown",
            "author_url": "https://www.youtube.com/@3blue1brown",
            "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        }
        mock_transcript = [
            {"text": "Backpropagation calculates gradients efficiently.", "start": 120.0, "duration": 5.0},
        ]

        with patch.object(YouTubeIngester, "fetch_metadata", return_value=mock_metadata):
            with patch.object(YouTubeIngester, "fetch_transcript", return_value=(mock_transcript, "en", False)):
                url_res = client.post(
                    f"/api/projects/{proj_id}/sources/url",
                    json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
                )
                assert url_res.status_code == 200
                data = url_res.json()
                assert data["metadata"]["is_youtube"] is True
                assert data["metadata"]["video_id"] == "dQw4w9WgXcQ"
                assert "Neural Networks" in data["filename"]

                # Verify chunk index and searchability in store
                store = mgr.get_store(proj_id)
                sources = store.list_documents()
                assert len(sources) == 1
                assert sources[0].id == data["id"]

                chunks = store.search_chunks("Backpropagation", active_source_ids=[data["id"]])
                assert len(chunks) > 0
                assert "Backpropagation" in chunks[0].content
                assert "[02:00]" in chunks[0].content
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
