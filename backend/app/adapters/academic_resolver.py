"""Composite Academic Resolver adapter integrating OpenAlex, Europe PMC, CrossRef, and Unpaywall.

Adapted from patterns in sdd-sota (litreview) into OpenFolioLM's hexagonal architecture.
"""

from concurrent.futures import ThreadPoolExecutor
import logging
import re
import uuid
from typing import Any, Optional
import httpx

from app.ports.academic_resolver import AcademicPaper, AcademicResolverPort
from app.adapters.semantic_scholar_adapter import SemanticScholarAdapter

logger = logging.getLogger(__name__)

DOI_PATTERN = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", re.IGNORECASE)
HTML_TAG_CLEANER = re.compile(r"<[^>]+>")


def normalize_doi(query: Optional[str]) -> Optional[str]:
    """Extracts and normalizes a standard DOI string.

    Examples:
        "https://doi.org/10.1353/pnm.2010.0009" -> "10.1353/pnm.2010.0009"
        "doi: 10.1038/s41586-020-2649-2." -> "10.1038/s41586-020-2649-2"
        "10.1371/journal.pone.0246282" -> "10.1371/journal.pone.0246282"
    """
    if not query or not isinstance(query, str):
        return None

    cleaned = query.strip()
    match = DOI_PATTERN.search(cleaned)
    if match:
        return match.group(0).strip().rstrip(".").rstrip("/")
    return None


def reconstruct_abstract(inverted_index: Optional[dict[str, list[int]]]) -> str:
    """Reconstruct full text abstract from OpenAlex inverted index.

    OpenAlex stores abstracts as an inverted index mapping words to integer
    word positions to optimize database storage.
    """
    if not inverted_index:
        return ""
    word_positions: list[tuple[int, str]] = []
    for word, positions in inverted_index.items():
        for pos in positions:
            word_positions.append((pos, word))
    word_positions.sort(key=lambda x: x[0])
    return " ".join(w for _, w in word_positions).strip()


class CompositeAcademicResolver(AcademicResolverPort):
    """Multi-tier scholarly metadata resolver combining OpenAlex, Europe PMC, CrossRef, and Unpaywall."""

    OPENALEX_API_URL = "https://api.openalex.org/works"
    EUROPE_PMC_API_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    CROSSREF_API_URL = "https://api.crossref.org/works"
    UNPAYWALL_API_URL = "https://api.unpaywall.org/v2"

    def __init__(
        self,
        mailto: str = "researcher@openfoliolm.local",
        timeout: float = 12.0,
        http_client: Optional[httpx.Client] = None,
        semantic_scholar: Optional[SemanticScholarAdapter] = None,
    ):
        self.mailto = mailto
        self.timeout = timeout
        self._client = http_client
        self.semantic_scholar = semantic_scholar or SemanticScholarAdapter(http_client=http_client)

    def _get_client(self) -> httpx.Client:
        if self._client is not None:
            return self._client
        return httpx.Client(
            timeout=self.timeout,
            follow_redirects=True,
            headers={
                "User-Agent": f"OpenFolioLM/1.0 (mailto:{self.mailto})"
            }
        )

    def is_doi(self, query: str) -> bool:
        if not query or not isinstance(query, str):
            return False
        if normalize_doi(query) is not None:
            return True
        cleaned = query.strip()
        if cleaned.startswith("s2/") or "semanticscholar.org/paper/" in cleaned:
            return True
        return False

    def normalize_doi(self, query: str) -> Optional[str]:
        return normalize_doi(query)

    def _resolve_openalex(self, client: httpx.Client, doi: str) -> Optional[dict[str, Any]]:
        url = f"{self.OPENALEX_API_URL}/https://doi.org/{doi}"
        try:
            resp = client.get(url, params={"mailto": self.mailto})
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.debug(f"OpenAlex lookup failed for {doi}: {e}")
        return None

    def _resolve_europe_pmc(self, client: httpx.Client, doi: str) -> Optional[dict[str, Any]]:
        try:
            params = {
                "query": f'DOI:"{doi}"',
                "format": "json",
                "resultType": "core",
            }
            resp = client.get(self.EUROPE_PMC_API_URL, params=params)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("resultList", {}).get("result", [])
                if results:
                    return results[0]
        except Exception as e:
            logger.debug(f"Europe PMC lookup failed for {doi}: {e}")
        return None

    def _resolve_crossref(self, client: httpx.Client, doi: str) -> Optional[dict[str, Any]]:
        url = f"{self.CROSSREF_API_URL}/{doi}"
        try:
            resp = client.get(url)
            if resp.status_code == 200:
                return resp.json().get("message", {})
        except Exception as e:
            logger.debug(f"CrossRef lookup failed for {doi}: {e}")
        return None

    def _resolve_unpaywall(self, client: httpx.Client, doi: str) -> Optional[dict[str, Any]]:
        url = f"{self.UNPAYWALL_API_URL}/{doi}"
        try:
            resp = client.get(url, params={"email": self.mailto})
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.debug(f"Unpaywall lookup failed for {doi}: {e}")
        return None

    def resolve(self, doi_or_url: str) -> Optional[AcademicPaper]:
        doi = self.normalize_doi(doi_or_url)
        clean_target = (doi_or_url or "").strip()

        if not doi:
            if clean_target.startswith("s2/") or "semanticscholar.org" in clean_target:
                if self.semantic_scholar:
                    return self.semantic_scholar.resolve_paper(clean_target)
            return None

        client_owner = self._client is None
        client = self._get_client()

        try:
            # 1. Primary Source: OpenAlex
            oa_data = self._resolve_openalex(client, doi)
            
            title: str = ""
            authors: list[str] = []
            abstract: Optional[str] = None
            year: Optional[int] = None
            venue: Optional[str] = None
            volume: Optional[str] = None
            issue: Optional[str] = None
            pages: Optional[str] = None
            publisher: Optional[str] = None
            is_oa: bool = False
            pdf_url: Optional[str] = None
            landing_page_url: str = f"https://doi.org/{doi}"
            citations_count: Optional[int] = None
            source_db = "openalex"

            if oa_data:
                title = oa_data.get("title") or ""
                inv_index = oa_data.get("abstract_inverted_index")
                if inv_index:
                    abstract = reconstruct_abstract(inv_index)
                
                year = oa_data.get("publication_year")
                citations_count = oa_data.get("cited_by_count", 0)

                for authorship in oa_data.get("authorships", []):
                    name = authorship.get("author", {}).get("display_name")
                    if name:
                        authors.append(name)

                primary_loc = oa_data.get("primary_location") or {}
                venue = (primary_loc.get("source") or {}).get("display_name")
                landing_page_url = primary_loc.get("landing_page_url") or landing_page_url

                open_access = oa_data.get("open_access") or {}
                is_oa = open_access.get("is_oa", False)
                best_oa = oa_data.get("best_oa_location") or {}
                pdf_url = best_oa.get("pdf_url") or open_access.get("oa_url")

                biblio = oa_data.get("biblio") or {}
                volume = biblio.get("volume")
                issue = biblio.get("issue")
                first_page = biblio.get("first_page")
                last_page = biblio.get("last_page")
                if first_page and last_page:
                    pages = f"{first_page}-{last_page}"
                elif first_page:
                    pages = str(first_page)

            # 2. Secondary Enrichment: Europe PMC (for missing abstract or OA PDF)
            if not abstract or not is_oa or not pdf_url:
                epmc_data = self._resolve_europe_pmc(client, doi)
                if epmc_data:
                    if not title and epmc_data.get("title"):
                        title = epmc_data.get("title", "").rstrip(".")
                    if not abstract and epmc_data.get("abstractText"):
                        abstract = HTML_TAG_CLEANER.sub("", epmc_data.get("abstractText", "")).strip()
                    if not venue and epmc_data.get("journalTitle"):
                        venue = epmc_data.get("journalTitle")
                    if not year and epmc_data.get("pubYear"):
                        try:
                            year = int(epmc_data.get("pubYear"))
                        except (ValueError, TypeError):
                            pass
                    if not authors and epmc_data.get("authorString"):
                        authors = [a.strip() for a in epmc_data.get("authorString", "").split(",") if a.strip()]

                    if epmc_data.get("isOpenAccess") == "Y":
                        is_oa = True
                        if not pdf_url:
                            for u in epmc_data.get("fullTextUrlList", {}).get("fullTextUrl", []):
                                if u.get("documentStyle") == "pdf":
                                    pdf_url = u.get("url")
                                    break

            # 3. Tertiary Enrichment: CrossRef (canonical titles, publisher, volume/issue)
            if not title or not publisher or not volume or not authors:
                cr_data = self._resolve_crossref(client, doi)
                if cr_data:
                    if not title and cr_data.get("title"):
                        cr_titles = cr_data.get("title")
                        title = cr_titles[0] if isinstance(cr_titles, list) and cr_titles else str(cr_titles)
                    if not publisher and cr_data.get("publisher"):
                        publisher = cr_data.get("publisher")
                    if not venue and cr_data.get("container-title"):
                        containers = cr_data.get("container-title")
                        venue = containers[0] if isinstance(containers, list) and containers else str(containers)
                    if not volume and cr_data.get("volume"):
                        volume = str(cr_data.get("volume"))
                    if not issue and cr_data.get("issue"):
                        issue = str(cr_data.get("issue"))
                    if not pages and cr_data.get("page"):
                        pages = str(cr_data.get("page"))
                    if not year:
                        date_parts = (cr_data.get("published-print") or cr_data.get("published-online") or {}).get("date-parts", [])
                        if date_parts and date_parts[0]:
                            year = date_parts[0][0]
                    if not authors and cr_data.get("author"):
                        for a in cr_data.get("author", []):
                            given = a.get("given", "").strip()
                            family = a.get("family", "").strip()
                            name = f"{given} {family}".strip()
                            if name:
                                authors.append(name)
                    if not abstract and cr_data.get("abstract"):
                        abstract = HTML_TAG_CLEANER.sub("", cr_data.get("abstract", "")).strip()

            # 4. Quaternary Fallback: Unpaywall (final verification of OA status/PDF)
            if not is_oa or not pdf_url:
                upw_data = self._resolve_unpaywall(client, doi)
                if upw_data:
                    if upw_data.get("is_oa"):
                        is_oa = True
                        best_loc = upw_data.get("best_oa_location") or {}
                        pdf_url = best_loc.get("url_for_pdf") or best_loc.get("url") or pdf_url

            if not title:
                title = f"Documento Académico ({doi})"

            # Build BibTeX record
            first_author = authors[0].split()[-1].lower() if authors else "paper"
            pub_year = str(year) if year else "nd"
            doi_slug = re.sub(r"[^a-zA-Z0-9]", "", doi)[-8:]
            cite_key = f"{first_author}_{pub_year}_{doi_slug}"
            
            bibtex_authors = " and ".join(authors) if authors else "Unknown"
            bibtex_lines = [
                f"@article{{{cite_key},",
                f"  title = {{{title}}},",
                f"  author = {{{bibtex_authors}}},",
            ]
            if venue:
                bibtex_lines.append(f"  journal = {{{venue}}},")
            if year:
                bibtex_lines.append(f"  year = {{{year}}},")
            if volume:
                bibtex_lines.append(f"  volume = {{{volume}}},")
            if issue:
                bibtex_lines.append(f"  number = {{{issue}}},")
            if pages:
                bibtex_lines.append(f"  pages = {{{pages}}},")
            if publisher:
                bibtex_lines.append(f"  publisher = {{{publisher}}},")
            bibtex_lines.append(f"  doi = {{{doi}}},")
            bibtex_lines.append(f"  url = {{{landing_page_url}}}")
            bibtex_lines.append("}")
            bibtex = "\n".join(bibtex_lines)

            paper = AcademicPaper(
                doi=doi,
                title=title,
                authors=authors,
                abstract=abstract,
                publication_year=year,
                venue=venue,
                volume=volume,
                issue=issue,
                pages=pages,
                publisher=publisher,
                is_open_access=is_oa,
                pdf_url=pdf_url,
                landing_page_url=landing_page_url,
                citations_count=citations_count,
                source_database=source_db,
                bibtex=bibtex,
                source_provider="openalex" if oa_data else "crossref",
            )

            if self.semantic_scholar:
                try:
                    s2_paper = self.semantic_scholar.resolve_paper(doi)
                    if s2_paper:
                        if s2_paper.tldr:
                            paper.tldr = s2_paper.tldr
                        if not paper.pdf_url and s2_paper.pdf_url:
                            paper.pdf_url = s2_paper.pdf_url
                            paper.is_open_access = True
                        if paper.citations_count is None and s2_paper.citations_count is not None:
                            paper.citations_count = s2_paper.citations_count
                        if not paper.abstract and s2_paper.abstract:
                            paper.abstract = s2_paper.abstract
                except Exception as exc:
                    logger.debug("Semantic Scholar enrichment error for %s: %s", doi, exc)

            return paper
        finally:
            if client_owner:
                client.close()

    def build_academic_markdown(self, paper: AcademicPaper) -> str:
        """Synthesizes structured research markdown from an AcademicPaper record."""
        oa_badge = "🔓 **Open Access**" if paper.is_open_access else "🔒 **Acceso Cerrado / Ficha Bibliográfica**"
        authors_str = ", ".join(paper.authors) if paper.authors else "Autores no consignados"
        venue_str = paper.venue or paper.publisher or "Publicación académica"
        vol_issue = []
        if paper.volume:
            vol_issue.append(f"Vol. {paper.volume}")
        if paper.issue:
            vol_issue.append(f"N° {paper.issue}")
        if paper.pages:
            vol_issue.append(f"pp. {paper.pages}")
        vol_str = f" ({', '.join(vol_issue)})" if vol_issue else ""

        lines = [
            f"# {paper.title}",
            "",
            f"- **DOI Canónico**: [{paper.doi}]({paper.landing_page_url})",
            f"- **Autores**: {authors_str}",
            f"- **Revista / Conferencia**: *{venue_str}*{vol_str}",
            f"- **Año de Publicación**: {paper.publication_year or 'N/D'}",
            f"- **Estado de Acceso**: {oa_badge}",
        ]

        if paper.citations_count is not None:
            lines.append(f"- **Impacto (Citas Registradas)**: {paper.citations_count}")

        if paper.tldr:
            lines.extend([
                "",
                "---",
                "",
                "## Síntesis Clave (AI TL;DR - Semantic Scholar)",
                "",
                f"> 💡 **TL;DR**: {paper.tldr}",
            ])

        lines.extend([
            "",
            "---",
            "",
            "## Resumen del Trabajo (Abstract)",
            "",
            paper.abstract or "*Resumen no disponible en repositorios abiertos. Se recomienda consultar el enlace DOI canónico para acceso al texto completo.*",
            "",
            "---",
            "",
            "## Referencia Bibliográfica (BibTeX)",
            "",
            "```bibtex",
            paper.bibtex or "",
            "```",
            ""
        ])

        return "\n".join(lines)

    def _search_openalex(
        self,
        query: str,
        limit: int = 15,
        min_year: Optional[int] = None,
        min_citations: int = 0
    ) -> list[AcademicPaper]:
        """Searches OpenAlex scholarly works dataset for a natural language query."""
        if not query or not query.strip():
            return []

        client_owner = self._client is None
        client = self._get_client()

        papers: list[AcademicPaper] = []
        try:
            filters = ["has_abstract:true"]
            if min_year:
                filters.append(f"from_publication_date:{min_year}-01-01")
            if min_citations > 0:
                filters.append(f"cited_by_count:>{min_citations - 1}")

            params: dict[str, Any] = {
                "search": query.strip(),
                "per-page": min(max(limit, 5), 50),
                "mailto": self.mailto,
            }
            if filters:
                params["filter"] = ",".join(filters)

            resp = client.get(self.OPENALEX_API_URL, params=params)
            if resp.status_code != 200:
                logger.warning(f"OpenAlex search error {resp.status_code}: {resp.text[:150]}")
                return []

            data = resp.json()
            results = data.get("results", [])

            for work in results:
                raw_doi = work.get("doi") or ""
                doi = self.normalize_doi(raw_doi) or (raw_doi.replace("https://doi.org/", "").strip() if raw_doi else "")
                if not doi:
                    work_id = work.get("id", "").split("/")[-1]
                    doi = f"openalex/{work_id}" if work_id else f"oa_{uuid.uuid4().hex[:8]}"

                title = (work.get("title") or "").strip()
                if not title:
                    continue

                abstract = reconstruct_abstract(work.get("abstract_inverted_index"))

                authors = []
                for authorship in work.get("authorships", []):
                    name = authorship.get("author", {}).get("display_name")
                    if name:
                        authors.append(name)

                primary_loc = work.get("primary_location") or {}
                venue = (primary_loc.get("source") or {}).get("display_name")
                landing_page = primary_loc.get("landing_page_url") or (f"https://doi.org/{doi}" if "10." in doi else "")

                open_access = work.get("open_access") or {}
                is_oa = open_access.get("is_oa", False)
                best_oa = work.get("best_oa_location") or {}
                pdf_url = best_oa.get("pdf_url") or open_access.get("oa_url")

                year = work.get("publication_year")
                citations = work.get("cited_by_count", 0)

                first_author = authors[0].split()[-1].lower() if authors else "paper"
                pub_year = str(year) if year else "nd"
                doi_slug = re.sub(r"[^a-zA-Z0-9]", "", doi)[-8:]
                cite_key = f"{first_author}_{pub_year}_{doi_slug}"

                bibtex_authors = " and ".join(authors) if authors else "Unknown"
                bibtex = (
                    f"@article{{{cite_key},\n"
                    f"  title = {{{title}}},\n"
                    f"  author = {{{bibtex_authors}}},\n"
                    f"  journal = {{{venue or 'Scholarly Publication'}}},\n"
                    f"  year = {{{year or ''}}},\n"
                    f"  doi = {{{doi}}},\n"
                    f"  url = {{{landing_page}}}\n"
                    f"}}"
                )

                paper = AcademicPaper(
                    doi=doi,
                    title=title,
                    authors=authors,
                    abstract=abstract,
                    publication_year=year,
                    venue=venue,
                    is_open_access=is_oa,
                    pdf_url=pdf_url,
                    landing_page_url=landing_page,
                    citations_count=citations,
                    source_database="openalex",
                    bibtex=bibtex,
                    source_provider="openalex",
                )
                papers.append(paper)
                if len(papers) >= limit:
                    break

        except Exception as e:
            logger.error(f"Error in search_literature: {e}")
        finally:
            if client_owner:
                client.close()

        return papers

    def search_literature(
        self,
        query: str,
        limit: int = 15,
        min_year: Optional[int] = None,
        min_citations: int = 0,
        provider: str = "all",
    ) -> list[AcademicPaper]:
        """
        Searches scholarly literature across academic graph providers.
        Supports provider: 'all' (Federated S2 + OpenAlex with RRF deduplication),
        'semanticscholar' (Semantic Scholar only), or 'openalex' (OpenAlex only).
        """
        if not query or not query.strip():
            return []

        prov = (provider or "all").lower().strip()

        if prov in ("semanticscholar", "s2"):
            if self.semantic_scholar:
                return self.semantic_scholar.search_papers(
                    query=query, limit=limit, min_year=min_year, min_citations=min_citations
                )
            return []

        if prov == "openalex":
            return self._search_openalex(
                query=query, limit=limit, min_year=min_year, min_citations=min_citations
            )

        # Federated Search (provider == 'all' or hybrid)
        s2_papers: list[AcademicPaper] = []
        oa_papers: list[AcademicPaper] = []

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_s2 = (
                executor.submit(
                    self.semantic_scholar.search_papers,
                    query,
                    limit,
                    min_year,
                    min_citations,
                )
                if self.semantic_scholar
                else None
            )
            future_oa = executor.submit(
                self._search_openalex,
                query,
                limit,
                min_year,
                min_citations,
            )

            if future_s2:
                try:
                    s2_papers = future_s2.result()
                except Exception as exc:
                    logger.warning("Semantic Scholar federated query error: %s", exc)

            try:
                oa_papers = future_oa.result()
            except Exception as exc:
                logger.warning("OpenAlex federated query error: %s", exc)

        def _clean_title(t: str) -> str:
            return re.sub(r"[^\w\s]", "", (t or "").lower()).strip()

        def _clean_doi(d: Optional[str]) -> Optional[str]:
            if not d:
                return None
            norm = normalize_doi(d) or d.strip()
            if norm.startswith("s2/") or norm.startswith("openalex/"):
                return None
            return norm.lower()

        merged_papers: dict[str, AcademicPaper] = {}
        rrf_scores: dict[str, float] = {}
        doi_to_id: dict[str, str] = {}
        title_to_id: dict[str, str] = {}

        for i, paper in enumerate(s2_papers):
            item_id = f"s2_{i}_{uuid.uuid4().hex[:6]}"
            paper.source_provider = "semanticscholar"
            merged_papers[item_id] = paper
            rrf_scores[item_id] = 1.0 / (60.0 + i)

            doi_key = _clean_doi(paper.doi)
            if doi_key:
                doi_to_id[doi_key] = item_id

            title_key = _clean_title(paper.title)
            if title_key and len(title_key) > 5:
                title_to_id[title_key] = item_id

        for j, paper in enumerate(oa_papers):
            doi_key = _clean_doi(paper.doi)
            title_key = _clean_title(paper.title)

            matched_id = None
            if doi_key and doi_key in doi_to_id:
                matched_id = doi_to_id[doi_key]
            elif title_key and title_key in title_to_id:
                matched_id = title_to_id[title_key]

            if matched_id:
                existing = merged_papers[matched_id]
                existing.source_provider = "both"
                if not existing.abstract and paper.abstract:
                    existing.abstract = paper.abstract
                if not existing.pdf_url and paper.pdf_url:
                    existing.pdf_url = paper.pdf_url
                    existing.is_open_access = True
                if (existing.citations_count or 0) < (paper.citations_count or 0):
                    existing.citations_count = paper.citations_count
                if existing.doi.startswith("s2/") and paper.doi and not paper.doi.startswith("openalex/"):
                    existing.doi = paper.doi
                rrf_scores[matched_id] += 1.0 / (60.0 + j)
            else:
                new_id = f"oa_{j}_{uuid.uuid4().hex[:6]}"
                paper.source_provider = "openalex"
                merged_papers[new_id] = paper
                rrf_scores[new_id] = 1.0 / (60.0 + j)
                if doi_key:
                    doi_to_id[doi_key] = new_id
                if title_key and len(title_key) > 5:
                    title_to_id[title_key] = new_id

        sorted_ids = sorted(rrf_scores.keys(), key=lambda k: rrf_scores[k], reverse=True)
        return [merged_papers[k] for k in sorted_ids][:limit]
