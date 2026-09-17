"""Semantic Scholar (S2) API adapter with thread-safe rate-limiting and metadata resolution."""

import re
import time
import uuid
import logging
import threading
from typing import Any, Optional
import httpx

from app.core.config import settings
from app.ports.academic_resolver import AcademicPaper

logger = logging.getLogger(__name__)

DOI_PATTERN = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", re.IGNORECASE)


def normalize_doi(query: Optional[str]) -> Optional[str]:
    if not query or not isinstance(query, str):
        return None
    cleaned = query.strip()
    match = DOI_PATTERN.search(cleaned)
    if match:
        return match.group(0).strip().rstrip(".").rstrip("/")
    return None


class SemanticScholarAdapter:
    """
    Client for the Semantic Scholar Academic Graph API (Allen Institute for AI).
    Enforces a strict rate-limit (default 1.1s between requests) to comply with
    the official 1 request/second cumulative policy and prevent HTTP 429 errors.
    """

    SEARCH_FIELDS = "title,authors,year,abstract,citationCount,isOpenAccess,openAccessPdf,venue,externalIds,url,tldr,publicationDate"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 15.0,
        min_interval_seconds: float = 1.1,
        http_client: Optional[httpx.Client] = None,
    ):
        self.api_key = api_key or settings.semantic_scholar_api_key
        self.base_url = (base_url or settings.semantic_scholar_api_url).rstrip("/")
        self.timeout = timeout
        self._min_interval = min_interval_seconds
        self._last_request_time = 0.0
        self._lock = threading.Lock()
        self._client = http_client

    def _get_client(self) -> httpx.Client:
        if self._client is not None:
            return self._client

        headers = {
            "User-Agent": "OpenFolioLM/1.0 (Academic Research Assistant)",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["x-api-key"] = self.api_key

        return httpx.Client(
            timeout=self.timeout,
            follow_redirects=True,
            headers=headers,
        )

    def _enforce_rate_limit(self) -> None:
        """Throttles outgoing requests to guarantee at least min_interval_seconds between calls."""
        with self._lock:
            now = time.time()
            elapsed = now - self._last_request_time
            if elapsed < self._min_interval:
                time.sleep(self._min_interval - elapsed)
            self._last_request_time = time.time()

    def search_papers(
        self,
        query: str,
        limit: int = 15,
        min_year: Optional[int] = None,
        min_citations: int = 0,
    ) -> list[AcademicPaper]:
        """
        Searches Semantic Scholar for relevant scientific papers matching the natural language query.
        """
        if not query or not query.strip():
            return []

        clean_query = query.strip()
        client = self._get_client()

        params: dict[str, Any] = {
            "query": clean_query,
            "limit": min(max(limit, 5), 50),
            "fields": self.SEARCH_FIELDS,
        }

        if min_year:
            params["year"] = f"{min_year}-"

        self._enforce_rate_limit()

        try:
            resp = client.get(f"{self.base_url}/paper/search", params=params)
            if resp.status_code == 429:
                logger.warning("Semantic Scholar rate limit reached (HTTP 429). Retrying after cooldown...")
                time.sleep(2.0)
                self._enforce_rate_limit()
                resp = client.get(f"{self.base_url}/paper/search", params=params)

            if resp.status_code != 200:
                logger.warning("Semantic Scholar search failed (HTTP %s): %s", resp.status_code, resp.text[:180])
                return []

            data = resp.json()
            raw_papers = data.get("data", [])
            papers: list[AcademicPaper] = []

            for item in raw_papers:
                paper = self._parse_s2_paper(item)
                if paper:
                    if min_citations > 0 and (paper.citations_count or 0) < min_citations:
                        continue
                    papers.append(paper)

            return papers
        except Exception as exc:
            logger.exception("Error querying Semantic Scholar search API: %s", exc)
            return []

    def resolve_paper(self, paper_id_or_doi: str) -> Optional[AcademicPaper]:
        """
        Resolves complete paper metadata from Semantic Scholar by DOI, ArXiv ID, or S2 Paper ID.
        """
        if not paper_id_or_doi or not paper_id_or_doi.strip():
            return None

        clean_id = paper_id_or_doi.strip()
        doi = normalize_doi(clean_id)
        if doi:
            target_id = f"DOI:{doi}"
        elif clean_id.startswith("http"):
            target_id = clean_id
        else:
            target_id = clean_id

        client = self._get_client()
        self._enforce_rate_limit()

        try:
            url = f"{self.base_url}/paper/{target_id}"
            resp = client.get(url, params={"fields": self.SEARCH_FIELDS})
            if resp.status_code == 200:
                return self._parse_s2_paper(resp.json())
            logger.debug("Semantic Scholar lookup for '%s' returned HTTP %s", target_id, resp.status_code)
        except Exception as exc:
            logger.debug("Semantic Scholar resolve error for '%s': %s", target_id, exc)

        return None

    def _parse_s2_paper(self, item: dict[str, Any]) -> Optional[AcademicPaper]:
        title = (item.get("title") or "").strip()
        if not title:
            return None

        paper_id = item.get("paperId") or ""
        external_ids = item.get("externalIds") or {}
        raw_doi = external_ids.get("DOI") or ""
        doi = normalize_doi(raw_doi) or (raw_doi.strip() if raw_doi else "")
        if not doi:
            doi = f"s2/{paper_id}" if paper_id else f"s2_{uuid.uuid4().hex[:8]}"

        authors = []
        for a in item.get("authors", []):
            name = (a.get("name") or "").strip()
            if name:
                authors.append(name)

        year = item.get("year")
        venue = (item.get("venue") or "").strip()
        abstract = (item.get("abstract") or "").strip()
        citations_count = item.get("citationCount")

        # Open Access PDF link
        oa_info = item.get("openAccessPdf") or {}
        pdf_url = oa_info.get("url") if isinstance(oa_info, dict) else None
        is_oa = item.get("isOpenAccess", bool(pdf_url))

        # Semantic Scholar TLDR summary
        tldr_info = item.get("tldr") or {}
        tldr = tldr_info.get("text") if isinstance(tldr_info, dict) else None

        landing_page_url = item.get("url") or (f"https://doi.org/{doi}" if "10." in doi else f"https://www.semanticscholar.org/paper/{paper_id}")

        # Construct BibTeX
        first_author = authors[0].split()[-1].lower() if authors else "paper"
        pub_year = str(year) if year else "nd"
        doi_slug = re.sub(r"[^a-zA-Z0-9]", "", doi)[-8:] if doi else uuid.uuid4().hex[:6]
        cite_key = f"{first_author}_{pub_year}_{doi_slug}"
        bibtex_authors = " and ".join(authors) if authors else "Unknown"

        bibtex = (
            f"@article{{{cite_key},\n"
            f"  title = {{{title}}},\n"
            f"  author = {{{bibtex_authors}}},\n"
            f"  journal = {{{venue or 'Semantic Scholar Scholarly Record'}}},\n"
            f"  year = {{{year or ''}}},\n"
            f"  doi = {{{doi}}},\n"
            f"  url = {{{landing_page_url}}}\n"
            f"}}"
        )

        return AcademicPaper(
            doi=doi,
            title=title,
            authors=authors,
            publication_year=year,
            venue=venue or None,
            abstract=abstract or None,
            is_open_access=is_oa,
            landing_page_url=landing_page_url,
            pdf_url=pdf_url,
            citations_count=citations_count,
            bibtex=bibtex,
            tldr=tldr,
            source_provider="semanticscholar",
        )
