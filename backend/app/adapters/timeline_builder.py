import re
import logging
from collections import defaultdict
from typing import Optional
from app.core.models import SourceDocument, DocumentDossier
from app.adapters.project_manager import ProjectManager
from app.adapters.citation_network import CitationNetworkBuilder
from app.ports.synthesizer import SynthesizerPort
from app.ports.timeline_builder import (
    TimelineBuilderPort,
    ProjectTimeline,
    TimelineEra,
    TimelineEvent,
    LineageLink,
)

logger = logging.getLogger(__name__)


def _extract_year_from_text(text: str) -> Optional[int]:
    match = re.search(r"\b(19\d{2}|20\d{2})\b", text)
    if match:
        val = int(match.group(1))
        if 1950 <= val <= 2030:
            return val
    return None


class TimelineBuilder(TimelineBuilderPort):
    """
    Synthesizes chronological trajectories of scientific ideas and intellectual lineage.
    Integrates document metadata, CeNAT dossiers, and network science citation edges.
    """

    def __init__(
        self,
        project_manager: ProjectManager,
        synthesizer: Optional[SynthesizerPort] = None
    ):
        self.project_manager = project_manager
        self.synthesizer = synthesizer

    def build_timeline(self, project_id: str) -> ProjectTimeline:
        store = self.project_manager.get_store(project_id)
        docs = store.list_documents()

        if not docs:
            return ProjectTimeline(project_id=project_id)

        dossiers = store.get_all_dossiers()
        network_builder = CitationNetworkBuilder(self.project_manager)
        network = network_builder.build_project_network(project_id, min_similarity=0.60)

        # Index network nodes for role and citation metadata
        node_role_map = {node.id: node.role for node in network.nodes}
        node_citations_map = {node.id: node.citations_count for node in network.nodes}

        # Index edges where edge.source cites or connects to edge.target
        citation_targets_by_source: dict[str, set[str]] = defaultdict(set)
        for edge in network.edges:
            citation_targets_by_source[edge.source].add(edge.target)

        # 1. Process documents into timeline events
        events_by_year: dict[int, list[TimelineEvent]] = defaultdict(list)
        doc_year_map: dict[str, int] = {}
        doc_title_map: dict[str, str] = {}

        for doc in docs:
            meta = doc.metadata or {}
            title = meta.get("title") or doc.filename
            doc_title_map[doc.id] = title

            # Extract year safely
            year_raw = meta.get("publication_year") or meta.get("year") or meta.get("year_or_era")
            year = None
            if year_raw is not None:
                try:
                    year = int(str(year_raw).strip())
                except ValueError:
                    year = _extract_year_from_text(str(year_raw))
            if not year:
                year = _extract_year_from_text(doc.filename) or doc.created_at.year
            doc_year_map[doc.id] = int(year)

        for doc in docs:
            meta = doc.metadata or {}
            title = doc_title_map[doc.id]
            year = doc_year_map[doc.id]
            dossier: Optional[DocumentDossier] = dossiers.get(doc.id)

            authors = meta.get("authors")
            if isinstance(authors, str):
                authors = [authors]
            elif not isinstance(authors, list):
                authors = []

            # Determine headline & summary from CeNAT dossier if available
            if dossier:
                headline = dossier.key_claims[0] if dossier.key_claims else dossier.title
                summary = dossier.executive_summary
                methodology = dossier.methodology_or_approach
                limitations = dossier.limitations
            else:
                headline = title
                # Clean Markdown snippet for preview
                clean_preview = re.sub(r"[#*`_]", "", doc.raw_markdown[:260]).strip()
                summary = clean_preview + ("..." if len(doc.raw_markdown) > 260 else "")
                methodology = None
                limitations = []

            # Lineage: detect older papers cited by this paper
            built_upon: list[LineageLink] = []
            target_ids = citation_targets_by_source.get(doc.id, set())
            for target_id in target_ids:
                if target_id in doc_year_map and doc_year_map[target_id] <= year and target_id != doc.id:
                    built_upon.append(
                        LineageLink(
                            source_id=target_id,
                            title=doc_title_map.get(target_id, target_id),
                            year=doc_year_map.get(target_id)
                        )
                    )

            role = node_role_map.get(doc.id, "corpus")
            citations_count = node_citations_map.get(doc.id, 0)

            event = TimelineEvent(
                id=f"evt_{doc.id}",
                source_id=doc.id,
                title=title,
                year=year,
                authors=authors,
                headline=headline,
                summary=summary,
                methodology=methodology,
                limitations=limitations,
                role=role,
                citations_count=citations_count,
                built_upon_sources=built_upon,
            )
            events_by_year[year].append(event)

        # 2. Group into chronological eras
        sorted_years = sorted(events_by_year.keys())
        eras: list[TimelineEra] = []

        for y in sorted_years:
            era_events = events_by_year[y]
            # Order events in year: foundation first, then frontier, bridge, corpus
            role_order = {"foundation": 0, "frontier": 1, "bridge": 2, "corpus": 3}
            era_events.sort(key=lambda ev: (role_order.get(ev.role, 4), -ev.citations_count))

            era_name = f"Era {y}"
            if any(ev.role == "foundation" for ev in era_events):
                era_name += ": Fundaciones y Primeros Principios"
            elif any(ev.role == "frontier" for ev in era_events):
                era_name += ": Frontera y Nuevos Paradigmas"
            elif any(ev.role == "bridge" for ev in era_events):
                era_name += ": Convergencia e Interdisciplinariedad"

            eras.append(TimelineEra(year=y, era_name=era_name, events=era_events))

        total_events = sum(len(e.events) for e in eras)
        year_span = (sorted_years[0], sorted_years[-1]) if sorted_years else (0, 0)

        return ProjectTimeline(
            project_id=project_id,
            total_events=total_events,
            year_span=year_span,
            eras=eras,
            narrative_arc=None,
        )

    async def synthesize_narrative(
        self,
        project_id: str,
        provider_override: Optional[str] = None
    ) -> str:
        timeline = self.build_timeline(project_id)
        if not timeline.eras:
            return "No hay suficientes documentos con datos cronológicos en este proyecto."

        # Compile chronological briefing
        briefing_lines: list[str] = []
        for era in timeline.eras:
            briefing_lines.append(f"### Año {era.year} ({era.era_name})")
            for ev in era.events:
                built_str = ""
                if ev.built_upon_sources:
                    built_str = f" [Construye sobre: {', '.join(b.title for b in ev.built_upon_sources)}]"
                briefing_lines.append(
                    f"- **{ev.title}** ({', '.join(ev.authors[:2]) if ev.authors else 'Autores'}): {ev.headline}. {ev.summary}{built_str}"
                )

        corpus_text = "\n".join(briefing_lines)

        if self.synthesizer:
            try:
                system_prompt = (
                    "Eres un historiador científico de primer nivel y Senior Architect. "
                    "A partir del siguiente registro cronológico de documentos y papers de un proyecto, "
                    "redacta una narrativa evolutiva sintética (3 a 5 párrafos) en Markdown, estructurada por épocas, "
                    "que explique con rigor técnico cómo evolucionaron las ideas, qué supuestos se rompieron "
                    "y cómo los primeros trabajos fundacionales abrieron camino a las metodologías de frontera."
                )
                from app.core.models import GroundedQuery
                ans = await self.synthesizer.generate_grounded_answer(
                    GroundedQuery(
                        query=f"Redacta la narrativa histórica evolutiva de este corpus científico:\n\n{corpus_text}",
                        active_source_ids=[],
                        strict_grounding=False,
                        provider=provider_override,
                    ),
                    retrieved_chunks=[]
                )
                if ans and ans.answer:
                    return ans.answer
            except Exception as e:
                logger.warning(f"Failed to generate LLM narrative: {e}")

        # Deterministic fallback synthesis
        fallback_lines = [
            "## ⏳ Trayectoria Intelectual y Evolución de Ideas",
            "",
            f"El corpus analizado abarca desde **{timeline.year_span[0]}** hasta **{timeline.year_span[1]}**, registrando un total de **{timeline.total_events} hitos científicos**.",
            "",
        ]
        for era in timeline.eras:
            fallback_lines.append(f"#### {era.era_name}")
            for ev in era.events:
                fallback_lines.append(f"- **{ev.title}** ({ev.year}): {ev.headline}")
            fallback_lines.append("")

        return "\n".join(fallback_lines)
