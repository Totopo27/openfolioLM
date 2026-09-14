"""Port definition for factual consistency checking and hallucination detection."""

from dataclasses import dataclass
from typing import Protocol, Sequence
from app.core.models import DocumentChunk


@dataclass
class FactAuditResult:
    factual_score: float  # 0.0 to 1.0
    hallucination_risk: str  # "low" | "medium" | "high"
    entailment_prob: float
    contradiction_prob: float
    neutral_prob: float
    claims_audited: int


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
