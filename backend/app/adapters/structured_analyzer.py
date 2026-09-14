from __future__ import annotations
import json
import re
from typing import Optional, Any
from app.core.models import (
    SourceDocument,
    DocumentChunk,
    DocumentDossier,
    DocumentTypeEnum,
    AreaAnalysis,
    FODAMatrix,
)
from app.ports.document_analyzer import DocumentAnalyzerPort


ANALYSIS_SYSTEM_PROMPT = """Eres un Auditor Científico y Analista Senior de Documentos (CeNAT / OpenFolioLM).
Tu tarea es examinar el documento proporcionado y generar una FICHA TÉCNICA Y DOSSIER ESTRUCTURADO MULTIDIMENSIONAL.

Debes responder ÚNICAMENTE con un objeto JSON válido (sin explicaciones adicionales antes ni después) con el siguiente esquema exacto:

{
  "title": "Título preciso del documento o paper",
  "doc_type": "research_paper | policy_plan | technical_report | legal_regulatory | general",
  "executive_summary": "Resumen ejecutivo conciso de menos de 250 palabras",
  "authors_or_entities": ["Autor 1", "Institución / Entidad"],
  "key_claims": ["Tesis o propuesta principal 1", "Hallazgo o compromiso 2"],
  "methodology_or_approach": "Metodología científica, marco normativo o enfoque de implementación",
  "multidimensional_analysis": [
    {
      "area": "Nombre del área (ej. 'Técnica / Metodológica', 'Económica / Viabilidad', 'Social / Inclusión', 'Ambiental', 'Legal')",
      "summary": "Evaluación crítica del área",
      "strengths": ["Aspecto positivo 1"],
      "weaknesses": ["Omisión o punto débil 1"],
      "risks": ["Riesgo operacional o impacto adverso"]
    }
  ],
  "foda": {
    "strengths": ["Fortaleza interna del documento"],
    "weaknesses": ["Debilidad interna o falta de datos"],
    "opportunities": ["Oportunidad de impacto o aplicación"],
    "threats": ["Amenaza externa o riesgo de inviabilidad"]
  },
  "limitations": ["Limitación metodológica, vacíos en el documento o supuestos no comprobados"],
  "verdict": "Dictamen crítico final sobre solidez, coherencia y viabilidad",
  "confidence_score": 0.95
}
"""


class StructuredDocumentAnalyzer(DocumentAnalyzerPort):
    """
    Adapter for extracting structured analytical dossiers using LLMs with Pydantic validation.
    Synthesizes scientific extraction (CeNAT) and multidimensional policy evaluation (PASE matrix).
    """

    def __init__(
        self,
        providers: Optional[dict[str, Any]] = None,
        default_provider: str = "ollama",
        default_llm_client: Optional[Any] = None
    ):
        self.providers = providers or {}
        self.default_provider = default_provider
        self.default_llm_client = default_llm_client

    def _get_client(self, provider: Optional[str] = None) -> Any:
        if self.default_llm_client is not None:
            return self.default_llm_client
        target_provider = provider or self.default_provider
        client = self.providers.get(target_provider)
        if not client and self.providers:
            client = next(iter(self.providers.values()))
        if not client:
            raise RuntimeError("No LLM client configured for StructuredDocumentAnalyzer")
        return client

    def _select_representative_chunks(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        if not chunks:
            return []
        if len(chunks) <= 8:
            return chunks

        # Take beginning (intro/abstract), middle, and end (conclusions)
        head = chunks[:3]
        tail = chunks[-3:]
        middle_idx = len(chunks) // 2
        mid = chunks[middle_idx - 1: middle_idx + 1]

        selected = head + mid + tail
        seen = set()
        deduped = []
        for c in selected:
            if c.id not in seen:
                seen.add(c.id)
                deduped.append(c)
        return deduped

    def _clean_json_str(self, text: str) -> str:
        # Check for markdown code blocks ```json ... ``` or ``` ... ```
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()

        # Otherwise find outermost curly braces
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start:end + 1].strip()

        return text.strip()

    def analyze_document(
        self,
        document: SourceDocument,
        chunks: list[DocumentChunk],
        provider: Optional[str] = None
    ) -> DocumentDossier:
        rep_chunks = self._select_representative_chunks(chunks)
        combined_text = "\n\n---\n\n".join(
            f"[{c.id}] (Sección: {' > '.join(c.heading_hierarchy) if c.heading_hierarchy else 'General'}):\n{c.content}"
            for c in rep_chunks
        )

        user_prompt = (
            f"DOCUMENTO: '{document.filename}' (ID: {document.id})\n\n"
            f"CONTENIDO DEL DOCUMENTO:\n{combined_text}\n\n"
            "Instrucción: Genera la Ficha Técnica y Dossier Estructurado en JSON según las especificaciones."
        )

        client = self._get_client(provider)
        try:
            raw_response = client.generate(
                system_prompt=ANALYSIS_SYSTEM_PROMPT,
                user_prompt=user_prompt
            )
            cleaned_json = self._clean_json_str(raw_response)
            data = json.loads(cleaned_json)

            data["source_id"] = document.id
            if "title" not in data or not data["title"]:
                data["title"] = document.filename

            return DocumentDossier.model_validate(data)

        except Exception:
            # Fallback heuristic: construct safe dossier without crashing
            excerpt = document.raw_markdown[:300].strip()
            return DocumentDossier(
                source_id=document.id,
                title=document.filename,
                doc_type=DocumentTypeEnum.GENERAL,
                executive_summary=f"Resumen preliminar: {excerpt}..." if excerpt else "Documento sin contenido procesable.",
                authors_or_entities=[],
                key_claims=[],
                methodology_or_approach=None,
                multidimensional_analysis=[],
                foda=FODAMatrix(),
                limitations=["Análisis automático no concluyente debido a formato del modelo."],
                verdict="Se sugiere revisar el documento mediante consultas directas en el chat.",
                confidence_score=0.3
            )
