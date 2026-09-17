"""Port definition for factual consistency checking and hallucination detection."""

from dataclasses import dataclass
from typing import Literal, Optional, Protocol, Sequence
from app.core.models import DocumentChunk


@dataclass
class FactAuditResult:
    factual_score: Optional[float]  # 0.0 to 1.0 when an audit ran
    hallucination_risk: Optional[str]  # "low" | "medium" | "high"
    entailment_prob: Optional[float]
    contradiction_prob: Optional[float]
    neutral_prob: Optional[float]
    claims_audited: int
    audit_status: Literal["verified", "not_applicable", "unavailable"] = "verified"


class FactCheckerPort(Protocol):
    """Evaluates whether generated text is entailed by or contradicts grounding evidence chunks."""

    def audit(
        self,
        premise_chunks: Sequence[DocumentChunk],
        hypothesis_text: str
    ) -> FactAuditResult:
        """
        Audits the factual consistency of hypothesis_text against the premise chunks.
        Returns a FactAuditResult containing the consistency score and risk classification.
        """
        ...
