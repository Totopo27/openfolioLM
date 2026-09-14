import os
import uuid
import mimetypes
from typing import Optional
from markitdown import MarkItDown
from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort


class MarkItDownAdapter(IngestionPort):
    """Adapter wrapping Microsoft MarkItDown for heterogeneous document ingestion with stealth web fallback."""

    def __init__(
        self,
        markitdown_instance: Optional[MarkItDown] = None,
        stealth_scraper: Optional[Any] = None
    ):
        self._md = markitdown_instance or MarkItDown()
        self._stealth_scraper = stealth_scraper

    def convert(
        self,
        file_path: str,
        filename: str,
        source_id: Optional[str] = None
    ) -> SourceDocument:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Source file not found at: {file_path}")

        result = self._md.convert(file_path)
        markdown_text = result.text_content or ""

        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
        mime_type, _ = mimetypes.guess_type(filename)

        return SourceDocument(
            id=doc_id,
            filename=filename,
            mime_type=mime_type or "application/octet-stream",
            raw_markdown=markdown_text,
            char_count=len(markdown_text),
            metadata={
                "original_file_path": file_path,
                "file_size_bytes": os.path.getsize(file_path)
            }
        )

    @staticmethod
    def _is_empty_spa_shell(html: str) -> bool:
        """Detects if an HTML response is an unhydrated Single Page App skeleton."""
        import re
        has_noscript_alert = bool(
            re.search(r"you need to enable javascript|requires javascript|habilitar javascript", html, re.IGNORECASE)
        )
        has_empty_root = bool(
            re.search(r'<div\s+id=["\'](root|app|__next)["\']\s*>\s*</div>', html, re.IGNORECASE)
        )
        stripped_text = re.sub(r"<[^>]+>", " ", html)
        stripped_text = re.sub(r"\s+", " ", stripped_text).strip()

        if (has_noscript_alert or has_empty_root) and len(stripped_text) < 200:
            return True
        return False

    def ingest_url(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None
    ) -> SourceDocument:
        import io
        import re
        from urllib.parse import urlparse
        import httpx
        from app.adapters.stealth_scraper import StealthWebScraper

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        }

        html_content: bytes = b""
        text_response: str = ""
        extracted_title: str = ""
        fetch_engine: str = "httpx"
        use_stealth: bool = False

        # Tier 1: Fast-path via direct HTTP request
        try:
            with httpx.Client(timeout=15.0, follow_redirects=True) as client:
                resp = client.get(url, headers=headers)
                # Check for anti-bot challenges or rate limiting
                if resp.status_code in (401, 403, 429, 503):
                    use_stealth = True
                else:
                    resp.raise_for_status()
                    html_content = resp.content
                    text_response = resp.text

                    # Check for unhydrated SPA shells
                    if self._is_empty_spa_shell(text_response):
                        use_stealth = True
                    else:
                        title_match = re.search(r"<title>(.*?)</title>", text_response, flags=re.IGNORECASE | re.DOTALL)
                        if title_match:
                            extracted_title = re.sub(r"\s+", " ", title_match.group(1)).strip()
        except Exception:
            use_stealth = True

        # Tier 2: Resilient Stealth Browser Fallback (inspired by omni-scraper)
        if use_stealth:
            try:
                scraper = self._stealth_scraper or StealthWebScraper()
                rendered = scraper.extract_rendered_html(url)
                html_content = rendered.html.encode("utf-8")
                extracted_title = rendered.title
                fetch_engine = rendered.engine
            except Exception as e:
                # If stealth also fails, raise clear explanatory error
                raise RuntimeError(
                    f"Error al extraer la URL '{url}' mediante motor rápido y stealth browser: {str(e)}"
                )

        parsed_url = urlparse(url)
        default_filename = extracted_title or (parsed_url.netloc + parsed_url.path).strip("/") or "web_document"
        final_filename = title_override or default_filename

        # Convert HTML stream to Markdown
        result = self._md.convert_stream(io.BytesIO(html_content), file_extension=".html")
        markdown_text = result.text_content or ""

        # Prepend clean Title and Source URL header
        header_prefix = f"# {final_filename}\n\n*Fuente Web: [{url}]({url})*\n\n"
        full_markdown = header_prefix + markdown_text

        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"

        return SourceDocument(
            id=doc_id,
            filename=final_filename,
            mime_type="text/html",
            raw_markdown=full_markdown,
            char_count=len(full_markdown),
            metadata={
                "source_url": url,
                "content_bytes": len(html_content),
                "page_title": extracted_title,
                "fetch_engine": fetch_engine,
            }
        )
