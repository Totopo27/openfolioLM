"""Resilient stealth web scraper adapter inspired by omni-scraper."""

import os
import sys
import time
import random
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

# Optional dynamic import bridge to omni_scraper if available in local filesystem or env
_OMNI_SCRAPER_AVAILABLE = False
try:
    import omni_scraper  # noqa: F401
    _OMNI_SCRAPER_AVAILABLE = True
except ImportError:
    candidate_paths = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../omni-scraper/src")),
        r"D:\DocumentosDiscoD\omni-scraper\src",
    ]
    for p in candidate_paths:
        if os.path.isdir(p) and p not in sys.path:
            sys.path.insert(0, p)
            try:
                import omni_scraper  # noqa: F401
                _OMNI_SCRAPER_AVAILABLE = True
                break
            except ImportError:
                pass


@dataclass
class RenderedPage:
    """Represents the rendered content of a web page after JavaScript execution."""
    html: str
    title: str
    final_url: str
    engine: str = "playwright_stealth"


SANITIZED_STEALTH_JS = """
// Set consistent navigator languages without tampering with native getters
try {
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-ES', 'es', 'en-US', 'en'],
      configurable: true,
    });
  }
} catch (e) {}
"""


class StealthWebScraper:
    """
    Headless Chromium scraper that uses native stealth flags to bypass
    anti-bot protections (Cloudflare, Datadome) and render client-side JavaScript.
    Modeled after the stealth session architecture of omni-scraper.
    """

    def __init__(
        self,
        headless: bool = True,
        cdp_url: Optional[str] = None,
        timeout_ms: int = 25000,
        user_agent: Optional[str] = None,
    ):
        self.headless = headless
        self.cdp_url = cdp_url
        self.timeout_ms = timeout_ms
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )

    def extract_rendered_html(self, url: str) -> RenderedPage:
        """
        Navigates to the given URL using headless Chromium with stealth anti-detection
        flags, waits for DOMContentLoaded and hydration, and returns the fully rendered HTML.
        """
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"URL inválida: '{url}'. Debe incluir http:// o https://")

        # Check if omni_scraper's BrowserSession can be utilized
        if _OMNI_SCRAPER_AVAILABLE:
            try:
                return self._extract_via_omni_scraper(url)
            except Exception:
                # If omni_scraper session raises for any reason, fallback to internal engine
                pass

        return self._extract_via_playwright(url)

    def _extract_via_omni_scraper(self, url: str) -> RenderedPage:
        """Use omni_scraper's BrowserSession and HumanActions directly."""
        from omni_scraper.config import BrowserConfig, ViewportConfig
        from omni_scraper.core.session import BrowserSession
        from omni_scraper.core.actions import HumanActions

        config = BrowserConfig(
            headless=self.headless,
            cdp_url=self.cdp_url,
            slow_mo_ms=0,
            user_agent=self.user_agent,
            viewport=ViewportConfig(width=1366, height=768),
        )

        session = BrowserSession(config)
        with session as (context, page):
            page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
            actions = HumanActions()
            actions.organic_sleep(0.8, 1.5)

            # Micro-scroll to trigger lazy-loaded sections
            try:
                page.evaluate("window.scrollBy({ top: 350, behavior: 'smooth' });")
                actions.organic_sleep(0.4, 0.8)
            except Exception:
                pass

            title = page.title() or ""
            html = page.content() or ""
            final_url = page.url or url

            return RenderedPage(
                html=html,
                title=title.strip(),
                final_url=final_url,
                engine="omni_scraper_session"
            )

    def _extract_via_playwright(self, url: str) -> RenderedPage:
        """Autonomous Playwright execution with omni-scraper stealth flags."""
        from playwright.sync_api import sync_playwright

        args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-component-update",
        ]

        with sync_playwright() as p:
            if self.cdp_url:
                browser = p.chromium.connect_over_cdp(self.cdp_url)
                contexts = browser.contexts
                context = contexts[0] if contexts else browser.new_context()
            else:
                browser = p.chromium.launch(
                    headless=self.headless,
                    args=args,
                )
                context = browser.new_context(
                    user_agent=self.user_agent,
                    viewport={"width": 1366, "height": 768},
                    locale="es-ES",
                    timezone_id="America/Argentina/Buenos_Aires",
                )

            context.add_init_script(SANITIZED_STEALTH_JS)
            page = context.new_page()

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
                # Brief organic pause for SPA hydration
                time.sleep(random.uniform(0.6, 1.2))

                # Smooth micro-scroll to activate intersection observers
                try:
                    page.evaluate("window.scrollBy({ top: 300, behavior: 'smooth' });")
                    time.sleep(0.4)
                except Exception:
                    pass

                title = page.title() or ""
                html = page.content() or ""
                final_url = page.url or url

                return RenderedPage(
                    html=html,
                    title=title.strip(),
                    final_url=final_url,
                    engine="playwright_stealth"
                )
            finally:
                page.close()
                context.close()
                browser.close()
