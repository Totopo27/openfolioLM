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


def test_vlm_quota_and_smart_dimension_filtering(tmp_path):
    mock_page = MagicMock()
    mock_page.width = 600
    mock_page.height = 800
    mock_page.extract_text.return_value = "Página con figuras"
    mock_page.flush_cache = MagicMock()

    # Create fake PIL image for page.to_image
    from PIL import Image
    fake_im = Image.new("RGB", (600, 800), color="white")
    mock_page_im = MagicMock()
    mock_page_im.original = fake_im
    mock_page.to_image.return_value = mock_page_im

    # 4 images on page:
    # 1. small icon: 80x80 (area 6400 < 15000 -> not for VLM)
    # 2. large diagram A: 300x200 (area 60000 -> for VLM)
    # 3. large diagram B: 400x300 (area 120000 -> for VLM)
    # 4. medium figure: 200x150 (area 30000 -> max_figures_per_page=2 caps to top 2)
    mock_page.images = [
        {"x0": 10, "top": 10, "width": 80, "height": 80},
        {"x0": 10, "top": 100, "width": 300, "height": 200},
        {"x0": 10, "top": 350, "width": 400, "height": 300},
        {"x0": 10, "top": 680, "width": 200, "height": 150},
    ]

    mock_pdf = MagicMock()
    mock_pdf.pages = [mock_page]

    mock_transcriber = MagicMock()
    mock_transcriber.transcribe.return_value = "```mermaid\ngraph TD\nA-->B\n```"

    assets_dir = str(tmp_path / "assets")

    with patch("pdfplumber.open") as mock_open:
        mock_open.return_value.__enter__.return_value = mock_pdf
        with patch("os.path.exists", return_value=True):
            extractor = PageAwarePDFExtractor(
                extract_figures=True,
                assets_dir=assets_dir,
                vision_transcriber=mock_transcriber,
                min_figure_dimension=60.0,
                min_vlm_dimension=120.0,
                min_vlm_area=15000.0,
                max_vlm_figures=1,  # Quota of 1 across document
                max_figures_per_page=2,
            )
            result = extractor.extract("doc_with_figs.pdf")

            # max_vlm_figures was 1, so transcribe must be called exactly once
            assert mock_transcriber.transcribe.call_count == 1
            # flush_cache must have been invoked
            mock_page.flush_cache.assert_called_once()
            # The markdown should contain the VLM transcription
            assert "Análisis Visual de Figura" in result.raw_markdown
