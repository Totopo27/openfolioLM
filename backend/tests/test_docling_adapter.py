import os
import tempfile
import pytest
from unittest.mock import MagicMock
from app.adapters.docling_adapter import DoclingAdapter
from app.adapters.hybrid_ingester import HybridDocumentIngester
from app.adapters.markitdown_adapter import MarkItDownAdapter


@pytest.fixture
def sample_text_file():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write("# Introduction\n\nThis is a standard text file.\n")
        path = f.name
    yield path
    if os.path.exists(path):
        os.remove(path)


@pytest.fixture
def sample_pdf_file():
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".pdf", delete=False) as f:
        f.write(b"%PDF-1.4 mock content")
        path = f.name
    yield path
    if os.path.exists(path):
        os.remove(path)


def test_docling_adapter_fallback_on_text_file(sample_text_file):
    adapter = DoclingAdapter()
    doc = adapter.convert(sample_text_file, "sample.txt")
    assert doc.filename == "sample.txt"
    assert "This is a standard text file" in doc.raw_markdown


def test_docling_adapter_mock_converter(sample_pdf_file):
    mock_conv = MagicMock()
    mock_res = MagicMock()
    mock_res.document.export_to_markdown.return_value = "# Header 1\n| Col 1 | Col 2 |\n|---|---|\n| A | B |\n"
    mock_conv.convert.return_value = mock_res

    adapter = DoclingAdapter(converter_instance=mock_conv)
    doc = adapter.convert(sample_pdf_file, "paper.pdf")

    assert doc.filename == "paper.pdf"
    assert doc.metadata.get("parser") == "docling"
    assert "| Col 1 | Col 2 |" in doc.raw_markdown
    assert mock_conv.convert.called


def test_docling_adapter_exception_fallback(sample_pdf_file):
    mock_conv = MagicMock()
    mock_conv.convert.side_effect = RuntimeError("Docling parsing error")

    mock_fallback = MagicMock(spec=MarkItDownAdapter)
    mock_doc = MagicMock()
    mock_doc.raw_markdown = "Fallback markdown"
    mock_fallback.convert.return_value = mock_doc

    adapter = DoclingAdapter(fallback_ingester=mock_fallback, converter_instance=mock_conv)
    doc = adapter.convert(sample_pdf_file, "paper.pdf")

    assert doc.raw_markdown == "Fallback markdown"
    assert mock_fallback.convert.called


def test_hybrid_document_ingester_routing(sample_text_file, sample_pdf_file):
    mock_docling = MagicMock(spec=DoclingAdapter)
    mock_markitdown = MagicMock(spec=MarkItDownAdapter)

    mock_docling.convert.return_value = "docling_res"
    mock_markitdown.convert.return_value = "markitdown_res"

    hybrid = HybridDocumentIngester(
        docling_adapter=mock_docling,
        markitdown_adapter=mock_markitdown,
        enable_docling=True
    )

    # PDF goes to Docling
    res_pdf = hybrid.convert(sample_pdf_file, "doc.pdf")
    assert res_pdf == "docling_res"
    assert mock_docling.convert.called

    # TXT goes to MarkItDown
    res_txt = hybrid.convert(sample_text_file, "doc.txt")
    assert res_txt == "markitdown_res"
    assert mock_markitdown.convert.called


def test_hybrid_document_ingester_disabled(sample_pdf_file):
    mock_docling = MagicMock(spec=DoclingAdapter)
    mock_markitdown = MagicMock(spec=MarkItDownAdapter)

    mock_docling.convert.return_value = "docling_res"
    mock_markitdown.convert.return_value = "markitdown_res"

    hybrid = HybridDocumentIngester(
        docling_adapter=mock_docling,
        markitdown_adapter=mock_markitdown,
        enable_docling=False
    )

    # Even PDF goes to MarkItDown when docling is disabled
    res_pdf = hybrid.convert(sample_pdf_file, "doc.pdf")
    assert res_pdf == "markitdown_res"
    assert not mock_docling.convert.called
    assert mock_markitdown.convert.called
