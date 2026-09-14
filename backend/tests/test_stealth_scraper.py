"""Unit tests for StealthWebScraper adapter."""

from unittest.mock import MagicMock, patch
import pytest
from app.adapters.stealth_scraper import StealthWebScraper, RenderedPage


def test_stealth_scraper_invalid_url():
    scraper = StealthWebScraper()
    with pytest.raises(ValueError, match="URL inválida"):
        scraper.extract_rendered_html("not-a-valid-url")


def test_stealth_scraper_playwright_extraction():
    scraper = StealthWebScraper(headless=True)

    mock_playwright = MagicMock()
    mock_browser = MagicMock()
    mock_context = MagicMock()
    mock_page = MagicMock()

    mock_page.title.return_value = "Protected Cloudflare Site"
    mock_page.content.return_value = "<html><body><h1>Hydrated SPA Content</h1><p>Full article text rendered by JS.</p></body></html>"
    mock_page.url = "https://protected-site.com/article"

    mock_context.new_page.return_value = mock_page
    mock_browser.new_context.return_value = mock_context
    mock_playwright.chromium.launch.return_value = mock_browser

    with patch("playwright.sync_api.sync_playwright") as mock_sync_p:
        mock_sync_p.return_value.__enter__.return_value = mock_playwright
        # Ensure _OMNI_SCRAPER_AVAILABLE is bypassed for autonomous playwright testing
        with patch("app.adapters.stealth_scraper._OMNI_SCRAPER_AVAILABLE", False):
            result = scraper.extract_rendered_html("https://protected-site.com/article")

            assert isinstance(result, RenderedPage)
            assert result.title == "Protected Cloudflare Site"
            assert "Hydrated SPA Content" in result.html
            assert result.final_url == "https://protected-site.com/article"
            assert result.engine == "playwright_stealth"

            # Verify anti-detection flags were supplied to launch
            call_kwargs = mock_playwright.chromium.launch.call_args[1]
            assert "--disable-blink-features=AutomationControlled" in call_kwargs["args"]


def test_stealth_scraper_omni_scraper_bridge_when_available():
    scraper = StealthWebScraper(headless=True)

    mock_rendered = RenderedPage(
        html="<html><body><h1>Extracted via Omni-Scraper</h1></body></html>",
        title="Omni Extracted",
        final_url="https://example.org/omni",
        engine="omni_scraper_session"
    )

    with patch("app.adapters.stealth_scraper._OMNI_SCRAPER_AVAILABLE", True):
        with patch.object(scraper, "_extract_via_omni_scraper", return_value=mock_rendered):
            res = scraper.extract_rendered_html("https://example.org/omni")
            assert res.engine == "omni_scraper_session"
            assert "Extracted via Omni-Scraper" in res.html
