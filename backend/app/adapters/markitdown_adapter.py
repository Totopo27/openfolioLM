import io
import ipaddress
import mimetypes
import os
import re
import socket
import uuid
from typing import Any, Optional
from urllib.parse import ParseResult, urljoin, urlparse

import httpx
from markitdown import MarkItDown

from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort


class UnsafeURLError(ValueError):
    """Raised when a URL can reach a non-public network resource."""


class MarkItDownAdapter(IngestionPort):
    """MarkItDown adapter with bounded, public-network-only URL ingestion."""

    ALLOWED_URL_SCHEMES = frozenset({"http", "https"})
    REDIRECT_STATUS_CODES = frozenset({301, 302, 303, 307, 308})
    STEALTH_FALLBACK_STATUS_CODES = frozenset({401, 403, 429, 503})
    MAX_REDIRECTS = 5
    MAX_WEB_CONTENT_BYTES = 10 * 1024 * 1024

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
        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".pdf":
            try:
                from app.adapters.pdf_page_extractor import PageAwarePDFExtractor

                # Auto-detect project asset directory if file is inside a project upload folder
                assets_dir = None
                asset_url_prefix = ""
                parent = os.path.dirname(os.path.abspath(file_path))
                grandparent = os.path.dirname(parent)
                if os.path.basename(parent) == "uploads":
                    project_id = os.path.basename(grandparent)
                    assets_dir = os.path.join(grandparent, "assets", doc_id)
                    asset_url_prefix = f"/api/projects/{project_id}/assets/{doc_id}"

                extractor = PageAwarePDFExtractor(
                    extract_tables=True,
                    extract_figures=bool(assets_dir),
                    assets_dir=assets_dir,
                    asset_url_prefix=asset_url_prefix,
                )
                page_result = extractor.extract(file_path)
                if page_result.raw_markdown and page_result.raw_markdown.strip():
                    mime_type, _ = mimetypes.guess_type(filename)
                    return SourceDocument(
                        id=doc_id,
                        filename=filename,
                        mime_type=mime_type or "application/pdf",
                        raw_markdown=page_result.raw_markdown,
                        char_count=len(page_result.raw_markdown),
                        metadata={
                            "original_file_path": file_path,
                            "file_size_bytes": os.path.getsize(file_path),
                            "page_count": page_result.page_count,
                            "page_offsets": page_result.page_offsets,
                            "has_page_markers": True,
                            "has_tables": True,
                            "has_figures": bool(assets_dir and os.path.exists(assets_dir) and os.listdir(assets_dir)),
                        }
                    )
            except Exception:
                pass

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

    @classmethod
    def _validate_public_url(cls, url: str) -> ParseResult:
        """Validate the scheme and every resolved address before a request."""
        try:
            parsed = urlparse(url)
            port = parsed.port
        except ValueError as exc:
            raise UnsafeURLError("Malformed URL") from exc

        if parsed.scheme.lower() not in cls.ALLOWED_URL_SCHEMES:
            raise UnsafeURLError("Only http:// and https:// URLs are allowed")
        if not parsed.hostname:
            raise UnsafeURLError("URL must include a hostname")
        if parsed.username or parsed.password:
            raise UnsafeURLError("URLs containing credentials are not allowed")

        lookup_port = port or (443 if parsed.scheme.lower() == "https" else 80)
        try:
            addresses = socket.getaddrinfo(
                parsed.hostname,
                lookup_port,
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as exc:
            raise UnsafeURLError("URL hostname could not be resolved") from exc

        if not addresses:
            raise UnsafeURLError("URL hostname did not resolve to an address")

        for _family, _socktype, _proto, _canonname, sockaddr in addresses:
            raw_address = sockaddr[0].split("%", 1)[0]
            try:
                resolved_ip = ipaddress.ip_address(raw_address)
            except ValueError as exc:
                raise UnsafeURLError("URL resolved to an invalid address") from exc
            if not resolved_ip.is_global:
                raise UnsafeURLError("URL resolves to a non-public network address")

        return parsed

    @classmethod
    def _read_limited_body(cls, response: httpx.Response) -> bytes:
        content_length = response.headers.get("content-length")
        if content_length:
            try:
                declared_length = int(content_length)
            except ValueError:
                declared_length = None
            if declared_length is not None and declared_length > cls.MAX_WEB_CONTENT_BYTES:
                raise ValueError("Remote response exceeds the allowed size")

        body = bytearray()
        for chunk in response.iter_bytes():
            if len(body) + len(chunk) > cls.MAX_WEB_CONTENT_BYTES:
                raise ValueError("Remote response exceeds the allowed size")
            body.extend(chunk)
        return bytes(body)

    def _fetch_public_html(
        self,
        url: str,
        headers: dict[str, str],
    ) -> tuple[bytes, str, int]:
        """Fetch a URL while validating each redirect and bounding the body."""
        current_url = url
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            for redirect_count in range(self.MAX_REDIRECTS + 1):
                self._validate_public_url(current_url)
                with client.stream("GET", current_url, headers=headers) as response:
                    if response.status_code in self.REDIRECT_STATUS_CODES:
                        location = response.headers.get("location")
                        if not location:
                            response.raise_for_status()
                        if redirect_count >= self.MAX_REDIRECTS:
                            raise httpx.TooManyRedirects(
                                "URL exceeded the redirect limit",
                                request=response.request,
                            )
                        current_url = urljoin(str(response.url), location)
                        self._validate_public_url(current_url)
                        continue

                    if response.status_code in self.STEALTH_FALLBACK_STATUS_CODES:
                        return b"", current_url, response.status_code

                    response.raise_for_status()
                    return self._read_limited_body(response), current_url, response.status_code

        raise RuntimeError("URL redirect handling ended unexpectedly")

    def ingest_url(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None
    ) -> SourceDocument:
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
        final_url = url

        self._validate_public_url(url)

        # Tier 1: Fast-path via direct HTTP request
        try:
            html_content, final_url, status_code = self._fetch_public_html(url, headers)
            use_stealth = status_code in self.STEALTH_FALLBACK_STATUS_CODES
            if html_content:
                text_response = html_content.decode("utf-8", errors="replace")
                use_stealth = self._is_empty_spa_shell(text_response)
                if not use_stealth:
                    title_match = re.search(
                        r"<title>(.*?)</title>",
                        text_response,
                        flags=re.IGNORECASE | re.DOTALL,
                    )
                    if title_match:
                        extracted_title = re.sub(r"\s+", " ", title_match.group(1)).strip()
        except UnsafeURLError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            if self._stealth_scraper is None:
                raise RuntimeError("Unable to retrieve the requested public URL") from exc
            use_stealth = True

        # Browser rendering is opt-in: the supplied scraper must enforce equivalent
        # request interception. The default adapter never launches an unrestricted browser.
        if use_stealth:
            if self._stealth_scraper is None:
                raise RuntimeError(
                    "The URL requires browser rendering, but no hardened renderer is configured"
                )
            try:
                rendered = self._stealth_scraper.extract_rendered_html(url)
                self._validate_public_url(rendered.final_url)
                html_content = rendered.html.encode("utf-8")
                if len(html_content) > self.MAX_WEB_CONTENT_BYTES:
                    raise ValueError("Rendered response exceeds the allowed size")
                extracted_title = rendered.title
                fetch_engine = rendered.engine
                final_url = rendered.final_url
            except Exception as e:
                raise RuntimeError("Unable to render the requested public URL") from e

        parsed_url = urlparse(final_url)
        default_filename = extracted_title or (parsed_url.netloc + parsed_url.path).strip("/") or "web_document"
        final_filename = (title_override or default_filename).strip()

        # Convert HTML stream to Markdown
        result = self._md.convert_stream(io.BytesIO(html_content), file_extension=".html")
        markdown_text = result.text_content or ""

        # Prepend clean Title and Source URL header
        header_prefix = f"# {final_filename}\n\n*Fuente Web: [{final_url}]({final_url})*\n\n"
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
                "final_url": final_url,
                "content_bytes": len(html_content),
                "page_title": extracted_title,
                "fetch_engine": fetch_engine,
            }
        )
