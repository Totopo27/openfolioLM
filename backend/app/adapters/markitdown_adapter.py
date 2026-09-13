import os
import uuid
import mimetypes
from typing import Optional
from markitdown import MarkItDown
from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort


class MarkItDownAdapter(IngestionPort):
    """Adapter wrapping Microsoft MarkItDown for heterogeneous document ingestion."""

    def __init__(self, markitdown_instance: Optional[MarkItDown] = None):
        self._md = markitdown_instance or MarkItDown()

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

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        }

        try:
            with httpx.Client(timeout=20.0, follow_redirects=True) as client:
                resp = client.get(url, headers=headers)
                resp.raise_for_status()
                html_content = resp.content
                text_response = resp.text
        except Exception as e:
            raise RuntimeError(f"Error al descargar la URL '{url}': {str(e)}")

        # Extract title from <title> tag if present
        extracted_title = ""
        title_match = re.search(r"<title>(.*?)</title>", text_response, flags=re.IGNORECASE | re.DOTALL)
        if title_match:
            extracted_title = re.sub(r"\s+", " ", title_match.group(1)).strip()

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
                "page_title": extracted_title
            }
        )
