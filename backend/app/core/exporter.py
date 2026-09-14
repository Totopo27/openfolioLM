import re
from datetime import datetime, timezone
from typing import Optional
from app.core.models import (
    Project,
    SourceDocument,
    ProjectNote,
    DocumentDossier,
    ChatMessageRecord,
)


def _slugify(text: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "_", cleaned)[:30]


def export_project_bibtex(sources: list[SourceDocument]) -> str:
    """Generate a clean BibTeX file for all sources in the project."""
    entries: list[str] = []

    for doc in sources:
        meta = doc.metadata or {}

        # If raw bibtex is already present in metadata, use it
        raw_bibtex = meta.get("bibtex")
        if raw_bibtex and isinstance(raw_bibtex, str) and raw_bibtex.strip().startswith("@"):
            entries.append(raw_bibtex.strip())
            continue

        # Otherwise synthesize entry
        title = meta.get("title") or doc.filename
        authors = meta.get("authors") or meta.get("author")
        if isinstance(authors, list):
            authors_str = " and ".join(str(a) for a in authors)
            first_author_surname = _slugify(str(authors[0]).split()[-1]) if authors else "unknown"
        elif isinstance(authors, str):
            authors_str = authors
            first_author_surname = _slugify(authors.split()[-1])
        else:
            authors_str = "OpenFolioLM Ingestion"
            first_author_surname = "doc"

        year = meta.get("publication_year") or meta.get("year") or datetime.now(timezone.utc).year
        key = f"{first_author_surname}{year}_{_slugify(title)[:15]}"

        doi = meta.get("doi")
        url = meta.get("url")
        journal = meta.get("journal") or meta.get("venue") or meta.get("publisher")

        entry_type = "article" if (journal or doi) else "misc"

        fields = [
            f"  title = {{{title}}}",
            f"  author = {{{authors_str}}}",
            f"  year = {{{year}}}",
        ]
        if journal:
            fields.append(f"  journal = {{{journal}}}")
        if doi:
            fields.append(f"  doi = {{{doi}}}")
        if url:
            fields.append(f"  url = {{{url}}}")
        fields.append(f"  note = {{Ingested into OpenFolioLM project: {doc.id}}}")

        entry = f"@{entry_type}{{{key},\n" + ",\n".join(fields) + "\n}"
        entries.append(entry)

    header = f"% OpenFolioLM BibTeX Export\n% Total entries: {len(entries)}\n% Generated at: {datetime.now(timezone.utc).isoformat()}\n\n"
    return header + "\n\n".join(entries) + "\n"


def export_project_markdown(
    project: Project,
    sources: list[SourceDocument],
    notes: list[ProjectNote],
    dossiers: Optional[dict[str, DocumentDossier]] = None,
    messages: Optional[list[ChatMessageRecord]] = None,
) -> str:
    """Generate a consolidated executive research dossier in Markdown format."""
    dossiers = dossiers or {}
    messages = messages or []

    lines: list[str] = [
        f"# Dossier de Investigación: {project.name}",
        "",
        f"> **Generado por OpenFolioLM** · {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "",
    ]

    if project.description:
        lines.extend([
            "## 📌 Resumen del Proyecto",
            "",
            project.description,
            "",
        ])

    # Stats
    lines.extend([
        "## 📊 Métricas del Corpus",
        "",
        f"- **Fuentes Ingeridas:** {len(sources)}",
        f"- **Notas de Síntesis en Cuaderno:** {len(notes)}",
        f"- **Consultas & Evidencia Grounded:** {len([m for m in messages if m.sender == 'assistant'])}",
        f"- **Fichas Analíticas CeNAT/PASE Generadas:** {len(dossiers)}",
        "",
    ])

    # Section 1: Sources & Dossiers
    lines.extend([
        "## 📚 Corpus Documental y Evidencia Científica",
        "",
    ])

    if not sources:
        lines.append("_No hay fuentes registradas en este proyecto._\n")
    else:
        for i, doc in enumerate(sources, 1):
            meta = doc.metadata or {}
            title = meta.get("title") or doc.filename
            authors = meta.get("authors")
            authors_str = ", ".join(authors) if isinstance(authors, list) else (authors or "No especificado")
            year = meta.get("publication_year") or meta.get("year") or "N/D"
            doi = meta.get("doi")
            url = meta.get("url")

            lines.append(f"### {i}. {title}")
            lines.append(f"- **Archivo / ID:** `{doc.filename}` (`{doc.id}`)")
            lines.append(f"- **Autores:** {authors_str}")
            lines.append(f"- **Año:** {year}")
            if doi:
                lines.append(f"- **DOI:** [{doi}](https://doi.org/{doi})")
            if url:
                lines.append(f"- **Enlace:** [{url}]({url})")
            lines.append(f"- **Caracteres:** {doc.char_count:,}")

            # Check if dossier exists
            dossier = dossiers.get(doc.id)
            if dossier:
                lines.extend([
                    "",
                    "#### 📑 Ficha CeNAT / PASE",
                    f"**Tipología:** `{dossier.doc_type.value}` | **Confianza:** {dossier.confidence_score * 100:.0f}%",
                    "",
                    f"**Resumen Ejecutivo:** {dossier.executive_summary}",
                    "",
                ])
                if dossier.key_claims:
                    lines.append("**Tesis y Hallazgos Principales:**")
                    for claim in dossier.key_claims:
                        lines.append(f"- {claim}")
                    lines.append("")

                if dossier.methodology_or_approach:
                    lines.append(f"**Metodología / Marco:** {dossier.methodology_or_approach}\n")

                if dossier.verdict:
                    lines.append(f"**Veredicto / Juicio Crítico:** {dossier.verdict}\n")
            lines.append("---")
            lines.append("")

    # Section 2: Studio Notes
    lines.extend([
        "## 📝 Cuaderno de Síntesis y Notas Analíticas",
        "",
    ])

    if not notes:
        lines.append("_No se han registrado notas en el cuaderno aún._\n")
    else:
        for i, note in enumerate(notes, 1):
            tags_str = " ".join(f"`#{t}`" for t in note.tags) if note.tags else "_Sin etiquetas_"
            lines.extend([
                f"### {i}. {note.title}",
                f"> **Etiquetas:** {tags_str} | **Actualizado:** {note.updated_at.strftime('%Y-%m-%d %H:%M')}",
                "",
                note.content,
                "",
                "---",
                "",
            ])

    # Section 3: Consolidated SWOT / FODA (if available)
    all_strengths = []
    all_weaknesses = []
    all_opportunities = []
    all_threats = []

    for d in dossiers.values():
        if d.foda:
            all_strengths.extend(d.foda.strengths)
            all_weaknesses.extend(d.foda.weaknesses)
            all_opportunities.extend(d.foda.opportunities)
            all_threats.extend(d.foda.threats)

    if all_strengths or all_weaknesses or all_opportunities or all_threats:
        lines.extend([
            "## 🧭 Matriz FODA / PASE Consolidada del Corpus",
            "",
            "| Fortalezas | Oportunidades |",
            "| :--- | :--- |",
        ])
        max_so = max(len(all_strengths), len(all_opportunities), 1)
        for idx in range(max_so):
            s = f"• {all_strengths[idx]}" if idx < len(all_strengths) else ""
            o = f"• {all_opportunities[idx]}" if idx < len(all_opportunities) else ""
            lines.append(f"| {s} | {o} |")

        lines.extend([
            "",
            "| Debilidades | Amenazas & Riesgos |",
            "| :--- | :--- |",
        ])
        max_wt = max(len(all_weaknesses), len(all_threats), 1)
        for idx in range(max_wt):
            w = f"• {all_weaknesses[idx]}" if idx < len(all_weaknesses) else ""
            t = f"• {all_threats[idx]}" if idx < len(all_threats) else ""
            lines.append(f"| {w} | {t} |")
        lines.append("")

    # Section 4: Chat QA Trail
    assistant_msgs = [m for m in messages if m.sender == "assistant"]
    if assistant_msgs:
        lines.extend([
            "## 💬 Registro de Hallazgos y Consultas Clave",
            "",
        ])
        for i, msg in enumerate(assistant_msgs[-5:], 1):
            lines.extend([
                f"#### Consulta #{i}",
                "",
                msg.text,
                "",
            ])
            if msg.citations:
                lines.append("**Citas y Evidencia Consultada:**")
                for c in msg.citations:
                    lines.append(f"- [^{c.index}] **{c.source_filename}**: *\"{c.quote_snippet}\"*")
                lines.append("")

    return "\n".join(lines)
