import pytest
from app.core.models import DocumentChunk
from app.ports.fact_checker import FactCheckerPort, FactAuditResult
from app.adapters.nli_fact_checker import NLIFactChecker


def _make_chunk(content: str) -> DocumentChunk:
    return DocumentChunk(
        id="c1",
        source_id="doc1",
        heading_hierarchy=["# Presupuesto"],
        start_char=0,
        end_char=len(content),
        content=content,
        token_estimate=len(content) // 4
    )


class MockFactChecker(FactCheckerPort):
    """Deterministic mock fact checker for fast testing."""
    def audit(self, premise_chunks, hypothesis_text) -> FactAuditResult:
        if "falso" in hypothesis_text.lower() or "mentira" in hypothesis_text.lower():
            return FactAuditResult(
                factual_score=0.15,
                hallucination_risk="high",
                entailment_prob=0.05,
                contradiction_prob=0.85,
                neutral_prob=0.10,
                claims_audited=1
            )
        return FactAuditResult(
            factual_score=0.92,
            hallucination_risk="low",
            entailment_prob=0.88,
            contradiction_prob=0.02,
            neutral_prob=0.10,
            claims_audited=1
        )


def test_fact_checker_empty_inputs():
    checker = NLIFactChecker(lazy_load=True)
    res = checker.audit([], "Cualquier texto")
    assert res.factual_score == 1.0
    assert res.hallucination_risk == "low"
    assert res.claims_audited == 0

    chunk = _make_chunk("Texto base de prueba")
    res2 = checker.audit([chunk], "")
    assert res2.factual_score == 1.0
    assert res2.claims_audited == 0


def test_mock_fact_checker_conformance():
    checker = MockFactChecker()
    chunk = _make_chunk("Texto verificado")

    res_good = checker.audit([chunk], "Afirmacion verdadera")
    assert res_good.factual_score == 0.92
    assert res_good.hallucination_risk == "low"

    res_bad = checker.audit([chunk], "Esto es falso completamente")
    assert res_bad.factual_score == 0.15
    assert res_bad.hallucination_risk == "high"


def test_fact_checker_reports_unavailable_without_fabricated_score(monkeypatch):
    checker = NLIFactChecker()
    monkeypatch.setattr(checker, "_ensure_loaded", lambda: False)

    result = checker.audit(
        [_make_chunk("An unrelated premise used for the audit.")],
        "A sufficiently long unsupported factual assertion.",
    )

    assert result.audit_status == "unavailable"
    assert result.factual_score is None
    assert result.hallucination_risk is None
    assert result.claims_audited == 0


def test_real_nli_fact_checker_spanish():
    """Real ONNX multilingual NLI evaluation on Spanish premises and hypotheses."""
    checker = NLIFactChecker()
    premise = _make_chunk(
        "El presupuesto asignado para la construcción de la biblioteca pública "
        "fue de 15 millones de colones en el periodo fiscal 2024."
    )

    # True statement
    true_ans = "La biblioteca pública contó con un presupuesto de 15 millones de colones."
    res_true = checker.audit([premise], true_ans)
    assert res_true.claims_audited >= 1
    assert res_true.factual_score >= 0.65
    assert res_true.hallucination_risk == "low"
    assert res_true.entailment_prob > res_true.contradiction_prob

    # Contradictory statement
    false_ans = "El proyecto de la biblioteca fue completamente rechazado y no se otorgó ningún presupuesto."
    res_false = checker.audit([premise], false_ans)
    assert res_false.claims_audited >= 1
    assert res_false.contradiction_prob > 0.25
    assert res_false.hallucination_risk in ("high", "medium")
