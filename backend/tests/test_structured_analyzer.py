import json
import pytest
from app.core.models import (
    SourceDocument,
    DocumentChunk,
    DocumentDossier,
    DocumentTypeEnum,
)
from app.adapters.structured_analyzer import StructuredDocumentAnalyzer


class MockLLMClient:
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.last_prompt = ""

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.last_prompt = user_prompt
        return self.response_text


def _make_sample_doc():
    doc = SourceDocument(
        id="doc_sample_123",
        filename="plan_nacional_energia.md",
        mime_type="text/markdown",
        raw_markdown="# Plan Nacional de Energía\n\nAutores: MINAE\n\nEste plan propone descarbonizar la matriz energética para 2050 mediante incentivos solares y eólicos.",
        char_count=160
    )
    chunks = [
        DocumentChunk(
            id="doc_sample_123#c0",
            source_id="doc_sample_123",
            heading_hierarchy=["# Plan Nacional de Energía"],
            start_char=0,
            end_char=160,
            content=doc.raw_markdown,
            token_estimate=40
        )
    ]
    return doc, chunks


def test_structured_analyzer_valid_json():
    valid_payload = {
        "title": "Plan Nacional de Energía",
        "doc_type": "policy_plan",
        "executive_summary": "Estrategia integral para descarbonizar la matriz energética nacional hacia el 2050.",
        "authors_or_entities": ["MINAE", "Dirección Sectorial de Energía"],
        "key_claims": [
            "Meta de carbono neutralidad al 2050",
            "Exoneración fiscal para paneles solares"
        ],
        "methodology_or_approach": "Modelación prospectiva LEAP y consulta interinstitucional",
        "multidimensional_analysis": [
            {
                "area": "Ambiental / Sostenibilidad",
                "summary": "Reducción sustantiva de emisiones de gases de efecto invernadero.",
                "strengths": ["Metas cuantificables", "Alineación con el Acuerdo de París"],
                "weaknesses": ["Falta plan de reciclaje de paneles solares"],
                "risks": ["Impacto hídrico por cambio climático"]
            },
            {
                "area": "Económica / Viabilidad",
                "summary": "Requiere inversión inicial significativa en infraestructura de red.",
                "strengths": ["Atracción de inversión verde"],
                "weaknesses": ["Costo de modernización del tendido"],
                "risks": ["Incremento transitorio en tarifas eléctricas"]
            }
        ],
        "foda": {
            "strengths": ["Matriz eléctrica 99% renovable como base"],
            "weaknesses": ["Dependencia de hidrocarburos en transporte"],
            "opportunities": ["Acceso a fondos verdes internacionales"],
            "threats": ["Fluctuaciones del mercado global"]
        },
        "limitations": [
            "No aborda en detalle el régimen tarifario para generación distribuida"
        ],
        "verdict": "Propuesta técnicamente sólida y urgente, cuya viabilidad depende del consenso tarifario.",
        "confidence_score": 0.95
    }

    mock_client = MockLLMClient(json.dumps(valid_payload))
    analyzer = StructuredDocumentAnalyzer(default_llm_client=mock_client)

    doc, chunks = _make_sample_doc()
    dossier = analyzer.analyze_document(doc, chunks)

    assert isinstance(dossier, DocumentDossier)
    assert dossier.source_id == doc.id
    assert dossier.title == "Plan Nacional de Energía"
    assert dossier.doc_type == DocumentTypeEnum.POLICY_PLAN
    assert len(dossier.authors_or_entities) == 2
    assert len(dossier.multidimensional_analysis) == 2
    assert dossier.multidimensional_analysis[0].area == "Ambiental / Sostenibilidad"
    assert len(dossier.foda.strengths) == 1
    assert dossier.confidence_score == 0.95


def test_structured_analyzer_markdown_wrapped_json():
    payload = {
        "title": "Quantum Error Correction in Neutral Atoms",
        "doc_type": "research_paper",
        "executive_summary": "Demonstration of topological surface codes in Rydberg arrays.",
        "authors_or_entities": ["Harvard", "MIT", "QuEra"],
        "key_claims": ["Break-even threshold achieved"],
        "methodology_or_approach": "Optical tweezers and laser cooling",
        "multidimensional_analysis": [
            {
                "area": "Técnica / Física",
                "summary": "Fidelidades de compuerta superiores al 99.5%.",
                "strengths": ["Escalabilidad geométrica"],
                "weaknesses": ["Tiempos de preparación de átomos"],
                "risks": ["Pérdida de átomos por colisiones"]
            }
        ],
        "foda": {
            "strengths": ["Gran conectividad"],
            "weaknesses": ["Latencia de movimiento"],
            "opportunities": ["Computación tolerante a fallas"],
            "threats": ["Competencia de iones atrapados"]
        },
        "limitations": ["Experimento restringido a 48 qubits lógicos"],
        "verdict": "Hito experimental en computación cuántica.",
        "confidence_score": 0.98
    }
    wrapped_response = f"Aquí está el análisis estructurado:\n```json\n{json.dumps(payload)}\n```\nFin del reporte."

    mock_client = MockLLMClient(wrapped_response)
    analyzer = StructuredDocumentAnalyzer(default_llm_client=mock_client)

    doc, chunks = _make_sample_doc()
    dossier = analyzer.analyze_document(doc, chunks)

    assert isinstance(dossier, DocumentDossier)
    assert dossier.doc_type == DocumentTypeEnum.RESEARCH_PAPER
    assert dossier.title == "Quantum Error Correction in Neutral Atoms"
    assert dossier.foda.strengths[0] == "Gran conectividad"


def test_structured_analyzer_fallback_on_malformed_json():
    mock_client = MockLLMClient("Esto no es un JSON válido {sin cerrar...")
    analyzer = StructuredDocumentAnalyzer(default_llm_client=mock_client)

    doc, chunks = _make_sample_doc()
    dossier = analyzer.analyze_document(doc, chunks)

    # Must produce a valid fallback dossier without crashing
    assert isinstance(dossier, DocumentDossier)
    assert dossier.source_id == doc.id
    assert dossier.title == doc.filename or "Plan Nacional de Energía" in dossier.title
    assert dossier.confidence_score <= 0.5
    assert len(dossier.verdict) > 0
