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
        "doc_type": "technical_report",
        "executive_summary": "Estrategia integral para descarbonizar la matriz energética nacional hacia el 2050.",
        "authors_or_entities": ["MINAE", "Dirección Sectorial de Energía"],
        "key_claims": [
            "Meta de carbono neutralidad al 2050",
            "Exoneración fiscal para paneles solares"
        ],
        "methodology_or_approach": "Modelación prospectiva LEAP y consulta interinstitucional",
        "thematic_modules": [
            {
                "topic": "Transición Renovable & Matriz Eléctrica",
                "summary": "Reducción sustantiva de emisiones de gases de efecto invernadero.",
                "core_concepts": ["Generación distribuida", "Matriz 99% renovable"],
                "practical_applications": ["Modelos de sustitución de búnker y diésel"]
            },
            {
                "topic": "Electrificación del Transporte & Infraestructura",
                "summary": "Modernización de flotas vehiculares y tendido de recarga rápida.",
                "core_concepts": ["Electromovilidad", "Carga bidireccional V2G"],
                "practical_applications": ["Corredores viales interurbanos con cargadores rápidos"]
            }
        ],
        "study_guide": {
            "target_audience": "Ingenieros en energía, economistas y formuladores de políticas",
            "prerequisites": ["Sistemas eléctricos de potencia", "Economía ambiental"],
            "difficulty_level": "Intermedio",
            "key_takeaways": ["Diseño de hojas de ruta de descarbonización"],
            "recommended_reading_path": "Lectura secuencial: primero diagnóstico y luego matriz de metas"
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
    assert dossier.doc_type == DocumentTypeEnum.TECHNICAL_REPORT
    assert len(dossier.authors_or_entities) == 2
    assert len(dossier.thematic_modules) == 2
    assert dossier.thematic_modules[0].topic == "Transición Renovable & Matriz Eléctrica"
    assert dossier.thematic_modules[0].core_concepts == ["Generación distribuida", "Matriz 99% renovable"]
    assert dossier.study_guide.difficulty_level == "Intermedio"
    assert len(dossier.study_guide.key_takeaways) == 1
    assert dossier.confidence_score == 0.95


def test_structured_analyzer_markdown_wrapped_json():
    payload = {
        "title": "Quantum Error Correction in Neutral Atoms",
        "doc_type": "research_paper",
        "executive_summary": "Demonstration of topological surface codes in Rydberg arrays.",
        "authors_or_entities": ["Harvard", "MIT", "QuEra"],
        "key_claims": ["Break-even threshold achieved"],
        "methodology_or_approach": "Optical tweezers and laser cooling",
        "thematic_modules": [
            {
                "topic": "Topological Surface Codes",
                "summary": "Fidelidades de compuerta superiores al 99.5%.",
                "core_concepts": ["Toric code", "Syndrome measurement", "Rydberg blockade"],
                "practical_applications": ["Corrección activa de errores en arreglos 2D"]
            }
        ],
        "study_guide": {
            "target_audience": "Físicos cuánticos e ingenieros de computación cuántica",
            "prerequisites": ["Mecánica cuántica avanzada", "Teoría de la información cuántica"],
            "difficulty_level": "Avanzado",
            "key_takeaways": ["Implementación de puertas de entrelazamiento vía átomos de Rydberg"],
            "recommended_reading_path": "Revisar primero métodos experimentales y luego protocolos de decodificación"
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
    assert len(dossier.thematic_modules) == 1
    assert dossier.thematic_modules[0].core_concepts[0] == "Toric code"
    assert dossier.study_guide.difficulty_level == "Avanzado"


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
