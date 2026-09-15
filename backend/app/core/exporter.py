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
        f"- **Fichas Analíticas y Guías de Estudio Generadas:** {len(dossiers)}",
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
                    "#### 📑 Estructura & Guía de Estudio de la Obra",
                    f"**Tipología:** `{dossier.doc_type.value}` | **Confianza:** {dossier.confidence_score * 100:.0f}%",
                    "",
                    f"**Resumen Ejecutivo:** {dossier.executive_summary}",
                    "",
                ])
                if dossier.key_claims:
                    lines.append("**Tesis y Fundamentos Principales:**")
                    for claim in dossier.key_claims:
                        lines.append(f"- {claim}")
                    lines.append("")

                if dossier.methodology_or_approach:
                    lines.append(f"**Enfoque Pedagógico / Metodología:** {dossier.methodology_or_approach}\n")

                if dossier.study_guide:
                    sg = dossier.study_guide
                    lines.append(f"**Público Objetivo:** {sg.target_audience} | **Dificultad:** `{sg.difficulty_level}`")
                    if sg.prerequisites:
                        lines.append(f"**Prerrequisitos:** {', '.join(sg.prerequisites)}")
                    if sg.key_takeaways:
                        lines.append("**Competencias y Aprendizajes Clave:**")
                        for kt in sg.key_takeaways:
                            lines.append(f"- {kt}")
                    if sg.recommended_reading_path:
                        lines.append(f"**Ruta de Lectura Aconsejada:** {sg.recommended_reading_path}")
                    lines.append("")

                if dossier.thematic_modules:
                    lines.append("**Módulos Temáticos y Conceptos Axiomáticos:**")
                    for mod in dossier.thematic_modules:
                        lines.append(f"- **{mod.topic}**: {mod.summary}")
                        if mod.core_concepts:
                            lines.append(f"  - _Conceptos clave:_ {', '.join(mod.core_concepts)}")
                        if mod.practical_applications:
                            lines.append(f"  - _Aplicaciones prácticas:_ {', '.join(mod.practical_applications)}")
                    lines.append("")

                if dossier.limitations:
                    lines.append("**Límites y Alcance Temático:**")
                    for lim in dossier.limitations:
                        lines.append(f"- {lim}")
                    lines.append("")

                if dossier.verdict:
                    lines.append(f"**Dictamen Editorial / Juicio Crítico:** {dossier.verdict}\n")
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
            note_lines = [
                f"### {i}. {note.title}",
                f"> **Etiquetas:** {tags_str} | **Actualizado:** {note.updated_at.strftime('%Y-%m-%d %H:%M')}",
            ]
            if note.origin_prompt:
                note_lines.append(f"> 💡 **Pregunta de Origen:** _{note.origin_prompt}_")
            note_lines.extend([
                "",
                note.content,
                "",
                "---",
                "",
            ])
            lines.extend(note_lines)

    # Section 3: Consolidated Study Guide & Thematic Architecture
    all_prereqs = []
    all_takeaways = []
    all_modules = []

    for d in dossiers.values():
        if d.study_guide:
            all_prereqs.extend(d.study_guide.prerequisites)
            all_takeaways.extend(d.study_guide.key_takeaways)
        if d.thematic_modules:
            all_modules.extend(d.thematic_modules)

    if all_prereqs or all_takeaways or all_modules:
        lines.extend([
            "## 📚 Guía de Estudio Consolidada y Mapa Temático del Corpus",
            "",
        ])
        if all_prereqs:
            lines.append("### 🔑 Prerrequisitos Globales del Corpus")
            for pr in set(all_prereqs):
                lines.append(f"- {pr}")
            lines.append("")

        if all_takeaways:
            lines.append("### 🎯 Competencias y Aprendizajes Clave Consolidados")
            for tk in all_takeaways:
                lines.append(f"- {tk}")
            lines.append("")

        if all_modules:
            lines.append("### 🗺️ Ejes y Módulos Conceptuales del Corpus")
            for mod in all_modules:
                lines.append(f"- **{mod.topic}**: {mod.summary}")
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
