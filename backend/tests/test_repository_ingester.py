import io
import zipfile
import pytest
from app.adapters.repository_ingester import RepositoryIngester


def test_is_code_or_repo():
    assert RepositoryIngester.is_code_or_repo("project.zip") is True
    assert RepositoryIngester.is_code_or_repo("main.py") is True
    assert RepositoryIngester.is_code_or_repo("component.tsx") is True
    assert RepositoryIngester.is_code_or_repo("Dockerfile") is True
    assert RepositoryIngester.is_code_or_repo("document.pdf") is False
    assert RepositoryIngester.is_code_or_repo("notes.docx") is False


def test_ingest_single_code_file():
    ingester = RepositoryIngester()
    code_bytes = b"def greet():\n    print('Hello World')\n"

    doc = ingester.ingest_code_file(code_bytes, filename="hello.py")
    assert doc.filename == "hello.py"
    assert doc.mime_type == "text/x-python"
    assert doc.metadata["is_code"] is True
    assert doc.metadata["is_repo"] is False
    assert "def greet" in doc.raw_markdown


def test_ingest_zip_with_noise_filtering():
    ingester = RepositoryIngester()

    # Create mock in-memory zip archive
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        # Valid code files
        zf.writestr("my-project/src/index.ts", "console.log('App started');")
        zf.writestr("my-project/src/api.py", "def get_data(): return {'ok': True}")
        zf.writestr("my-project/README.md", "# My Project\nDocs here.")

        # Ignored noise directories & files
        zf.writestr("my-project/node_modules/lodash/index.js", "module.exports = {};")
        zf.writestr("my-project/.git/HEAD", "ref: refs/heads/main")
        zf.writestr("my-project/__pycache__/api.cpython-310.pyc", b"\x00\x01\x02")
        zf.writestr("my-project/dist/bundle.min.js", "var a=1;function b(){}")
        zf.writestr("my-project/assets/logo.png", b"\x89PNG\r\n\x1a\n")
        zf.writestr("my-project/package-lock.json", '{"lockfileVersion": 2}')

    zip_bytes = zip_buffer.getvalue()
    doc = ingester.ingest_zip(zip_bytes, filename="my-project.zip")

    assert doc.mime_type == "application/zip"
    assert doc.metadata["is_repo"] is True
    assert doc.metadata["is_code"] is True

    files = doc.metadata["files"]
    # Check valid files were kept
    assert any("src/index.ts" in k for k in files)
    assert any("src/api.py" in k for k in files)
    assert any("README.md" in k for k in files)

    # Check that noise was strictly filtered out
    for k in files:
        assert "node_modules" not in k
        assert ".git" not in k
        assert "__pycache__" not in k
        assert "dist" not in k
        assert not k.endswith(".png")
        assert not k.endswith(".lock")
        assert not k.endswith(".json") or not k.endswith("package-lock.json")
