import os
import tempfile
import pytest
from app.adapters.markitdown_adapter import MarkItDownAdapter, UnsafeURLError


def test_markitdown_adapter_converts_text_file():
    adapter = MarkItDownAdapter()

    sample_content = "# Sample Title\n\nThis is a test document with markdown content."
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(sample_content)
        temp_path = f.name

    try:
        doc = adapter.convert(file_path=temp_path, filename="sample.txt")
        assert doc.filename == "sample.txt"
        assert doc.char_count > 0
        assert "Sample Title" in doc.raw_markdown
        assert doc.id is not None
        assert len(doc.id) > 0
    finally:
        os.remove(temp_path)


def test_markitdown_adapter_custom_id():
    adapter = MarkItDownAdapter()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write("Some markdown content.")
        temp_path = f.name

    try:
        doc = adapter.convert(file_path=temp_path, filename="custom.md", source_id="doc_custom_42")
        assert doc.id == "doc_custom_42"
        assert doc.filename == "custom.md"
    finally:
        os.remove(temp_path)


def test_markitdown_adapter_file_not_found():
    adapter = MarkItDownAdapter()
    with pytest.raises(FileNotFoundError):
        adapter.convert(file_path="non_existent_file.pdf", filename="ghost.pdf")


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://127.0.0.1/private",
        "http://[::1]/private",
        "http://169.254.169.254/latest/meta-data",
        "http://user:password@example.com/private",
    ],
)
def test_markitdown_adapter_rejects_unsafe_urls(url):
    adapter = MarkItDownAdapter()
    with pytest.raises(UnsafeURLError):
        adapter.ingest_url(url)
