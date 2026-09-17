"""Hybrid composite document ingester combining IBM Docling, Microsoft MarkItDown, and Academic/DOI Resolvers."""

import logging
import os
import tempfile
import uuid
from typing import Optional
import httpx

from app.core.config import settings
from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort
from app.ports.academic_resolver import AcademicResolverPort
from app.adapters.docling_adapter import DoclingAdapter
from app.adapters.markitdown_adapter import MarkItDownAdapter
from app.adapters.academic_resolver import CompositeAcademicResolver
from app.adapters.youtube_ingester import YouTubeIngester

logger = logging.getLogger(__name__)

DOCLING_EXTENSIONS = {".pdf", ".docx"}


class HybridDocumentIngester(IngestionPort):
    """
    Composite ingester routing rich multi-column documents (PDF, DOCX) through IBM Docling,
    academic DOIs through the Academic Resolver, YouTube videos through YouTubeIngester,
    and web URLs / code through MarkItDown.
    """

    def __init__(
        self,
        docling_adapter: Optional[DoclingAdapter] = None,
        markitdown_adapter: Optional[MarkItDownAdapter] = None,
        academic_resolver: Optional[AcademicResolverPort] = None,
        youtube_ingester: Optional[YouTubeIngester] = None,
        enable_docling: Optional[bool] = None,
        vision_transcriber: Optional[Any] = None,
    ):
        self._vision_transcriber = vision_transcriber
        self._markitdown = markitdown_adapter or MarkItDownAdapter(vision_transcriber=vision_transcriber)
        self._docling = docling_adapter or DoclingAdapter(fallback_ingester=self._markitdown)
        self._academic_resolver = academic_resolver or CompositeAcademicResolver()
        self._youtube_ingester = youtube_ingester or YouTubeIngester()
        self.enable_docling = enable_docling if enable_docling is not None else settings.enable_docling

    def convert(
        self,
        file_path: str,
        filename: str,
        source_id: Optional[str] = None
    ) -> SourceDocument:
        ext = os.path.splitext(filename)[1].lower()
        if self.enable_docling and ext in DOCLING_EXTENSIONS:
            return self._docling.convert(file_path, filename, source_id)
        return self._markitdown.convert(file_path, filename, source_id)

    def ingest_url(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None
    ) -> SourceDocument:
        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"

        # Tier 1: Check if the input is or contains a scholarly DOI
        if self._academic_resolver and self._academic_resolver.is_doi(url):
            try:
                paper = self._academic_resolver.resolve(url)
                if paper:
                    # Branch A: Open Access with direct PDF link
                    if paper.is_open_access and paper.pdf_url:
                        try:
                            headers = {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                            }
                            with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as client:
                                resp = client.get(paper.pdf_url)
                                resp.raise_for_status()
                                pdf_bytes = resp.content

                            # Verify valid PDF payload
                            if pdf_bytes.startswith(b"%PDF") or len(pdf_bytes) > 2048:
                                temp_file = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                                temp_path = temp_file.name
                                try:
                                    temp_file.write(pdf_bytes)
                                    temp_file.flush()
                                    temp_file.close()

                                    filename = f"{paper.title}.pdf" if not title_override else f"{title_override}.pdf"
                                    # Route through Docling or fallback
                                    doc = self.convert(file_path=temp_path, filename=filename, source_id=doc_id)
                                    
                                    # Prepend academic metadata header and bibtex to full-text markdown
                                    header_block = (
                                        f"# {paper.title}\n\n"
                                        f"- **DOI**: [{paper.doi}]({paper.landing_page_url}) | **Año**: {paper.publication_year or 'N/D'} | 🔓 **Open Access**\n"
                                        f"- **Autores**: {', '.join(paper.authors) or 'N/D'}\n"
                                        f"- **Revista / Conferencia**: *{paper.venue or paper.publisher or 'N/D'}*\n\n"
                                        f"---\n\n"
                                    )
                                    doc.raw_markdown = header_block + doc.raw_markdown
                                    doc.char_count = len(doc.raw_markdown)
                                    doc.metadata.update({
                                        "doi": paper.doi,
                                        "authors": paper.authors,
                                        "publication_year": paper.publication_year,
                                        "venue": paper.venue,
                                        "is_open_access": True,
                                        "pdf_url": paper.pdf_url,
                                        "source_database": paper.source_database,
                                        "bibtex": paper.bibtex,
                                    })
                                    return doc
                                finally:
                                    if os.path.exists(temp_path):
                                        try:
                                            os.remove(temp_path)
                                        except Exception:
                                            pass
                        except Exception as pdf_err:
                            logger.warning(
                                f"Could not download OA PDF from {paper.pdf_url} ({pdf_err}). "
                                "Falling back to structured academic metadata."
                            )

                    # Branch B: Closed Access / Paywall (or PDF download fallback)
                    markdown_content = self._academic_resolver.build_academic_markdown(paper)
                    final_title = title_override or paper.title
                    return SourceDocument(
                        id=doc_id,
                        filename=final_title,
                        mime_type="text/markdown",
                        raw_markdown=markdown_content,
                        char_count=len(markdown_content),
                        metadata={
                            "source_url": f"https://doi.org/{paper.doi}",
                            "doi": paper.doi,
                            "authors": paper.authors,
                            "publication_year": paper.publication_year,
                            "venue": paper.venue,
                            "is_open_access": paper.is_open_access,
                            "landing_page_url": paper.landing_page_url,
                            "citations_count": paper.citations_count,
                            "source_database": paper.source_database,
                            "bibtex": paper.bibtex,
                        }
                    )
            except Exception as e:
                logger.warning(f"Academic resolver failed for query '{url}': {e}. Falling back to standard URL scraper.")

        # Tier 2: Check if the input is a YouTube video / lecture URL
        if self._youtube_ingester and self._youtube_ingester.is_youtube_url(url):
            try:
                return self._youtube_ingester.ingest(
                    url=url,
                    source_id=source_id,
                    title_override=title_override
                )
            except Exception as yt_err:
                logger.error(f"YouTube ingestion failed for '{url}': {yt_err}")
                raise yt_err

        # Tier 3: Standard Web Ingestion via MarkItDown
        return self._markitdown.ingest_url(url, source_id=source_id, title_override=title_override)
