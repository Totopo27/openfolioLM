import pytest
import os
from unittest.mock import MagicMock, patch
from app.adapters.pdf_page_extractor import PageAwarePDFExtractor, FOLIO_REGEX


def test_folio_regex_matches_various_formats():
    assert FOLIO_REGEX.match("56").group(1) == "56"
    assert FOLIO_REGEX.match("| 56").group(1) == "56"
    assert FOLIO_REGEX.match("56 |").group(1) == "56"
    assert FOLIO_REGEX.match("Pág. 56").group(1) == "56"
    assert FOLIO_REGEX.match("--- 56 ---").group(1) == "56"
    assert FOLIO_REGEX.match("• 120 •").group(1) == "120"
    assert FOLIO_REGEX.match("random text with 56 inside") is None


def test_pdf_extractor_handles_mocked_pdf():
    mock_page_1 = MagicMock()
    mock_page_1.extract_text.return_value = "Portada del libro\nSin número"

    mock_page_2 = MagicMock()
    mock_page_2.extract_text.return_value = "Capítulo 1\nConceptos clave de arquitectura.\n| 1"

    mock_page_3 = MagicMock()
    mock_page_3.extract_text.return_value = "Capítulo 2\nContinuación del análisis.\n| 2"

    mock_pdf = MagicMock()
    mock_pdf.pages = [mock_page_1, mock_page_2, mock_page_3]

    with patch("pdfplumber.open") as mock_open:
        mock_open.return_value.__enter__.return_value = mock_pdf

        with patch("os.path.exists", return_value=True):
            extractor = PageAwarePDFExtractor()
            result = extractor.extract("dummy.pdf")

            assert result.page_count == 3
            assert "--- [Pág. 1] ---" in result.raw_markdown
            assert "--- [Pág. 2] ---" in result.raw_markdown
            assert len(result.page_offsets) == 3
            assert result.page_offsets[1]["page"] == 1
            assert result.page_offsets[2]["page"] == 2
