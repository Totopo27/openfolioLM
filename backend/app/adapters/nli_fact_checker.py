"""Neural NLI Fact Checker adapter using ONNX multilingual mDeBERTa-v3."""

import re
import logging
from typing import Optional, Sequence, Any
import numpy as np
from app.core.models import DocumentChunk
from app.ports.fact_checker import FactCheckerPort, FactAuditResult

logger = logging.getLogger(__name__)

DEFAULT_NLI_MODEL = "Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"


class NLIFactChecker(FactCheckerPort):
    """
    Evaluates factual entailment and detects hallucinations in LLM-generated answers
    against retrieved document chunks using a multilingual NLI Cross-Encoder model.
    """

    def __init__(
        self,
        model_name: str = DEFAULT_NLI_MODEL,
        onnx_session: Optional[Any] = None,
        tokenizer: Optional[Any] = None,
        lazy_load: bool = True
    ):
        self.model_name = model_name
        self._session = onnx_session
        self._tokenizer = tokenizer
        if not lazy_load:
            self._ensure_loaded()

    def _ensure_loaded(self) -> bool:
        if self._session is not None and self._tokenizer is not None:
            return True

        try:
            from tokenizers import Tokenizer
            from huggingface_hub import hf_hub_download
            import onnxruntime as ort

            logger.info("Loading NLI Fact-Checking model: %s", self.model_name)
            self._tokenizer = Tokenizer.from_pretrained(self.model_name)
            self._tokenizer.enable_truncation(max_length=512)
            self._tokenizer.enable_padding(length=512)

            onnx_path = hf_hub_download(
                repo_id=self.model_name,
                filename="onnx/model_quantized.onnx"
            )
            # Use CPU execution provider for deterministic, lightweight inference
            self._session = ort.InferenceSession(
                onnx_path,
                providers=["CPUExecutionProvider"]
            )
            return True
        except Exception as e:
            logger.warning("Failed to initialize NLI Fact-Checker '%s': %s", self.model_name, e)
            return False

    def _split_into_claims(self, text: str) -> list[str]:
        """Splits answer text into individual sentences and cleans citation markers."""
        # Strip code blocks or tabular lines if any
        clean_text = re.sub(r"```[\s\S]*?```", "", text)
        clean_text = re.sub(r"\[\^\d+\]", "", clean_text).strip()

        # Split on sentence boundaries
        raw_sentences = re.split(r"(?<=[.!?])\s+", clean_text)
        claims = []
        for s in raw_sentences:
            s_clean = s.strip()
            # Retain meaningful sentences (> 15 chars)
            if len(s_clean) >= 15 and not s_clean.startswith("#"):
                claims.append(s_clean)
        return claims

    def audit(
        self,
        premise_chunks: Sequence[DocumentChunk],
        hypothesis_text: str
    ) -> FactAuditResult:
        """
        Evaluates the factual consistency of the hypothesis against premise chunks.
        """
        if not premise_chunks or not hypothesis_text or not hypothesis_text.strip():
            return FactAuditResult(
                factual_score=1.0,
                hallucination_risk="low",
                entailment_prob=1.0,
                contradiction_prob=0.0,
                neutral_prob=0.0,
                claims_audited=0,
                audit_status="not_applicable",
            )

        claims = self._split_into_claims(hypothesis_text)
        if not claims:
            return FactAuditResult(
                factual_score=1.0,
                hallucination_risk="low",
                entailment_prob=1.0,
                contradiction_prob=0.0,
                neutral_prob=0.0,
                claims_audited=0,
                audit_status="not_applicable",
            )

        if not self._ensure_loaded():
            # Do not present an unavailable safety model as a successful audit.
            return FactAuditResult(
                factual_score=None,
                hallucination_risk=None,
                entailment_prob=None,
                contradiction_prob=None,
                neutral_prob=None,
                claims_audited=0,
                audit_status="unavailable",
            )

        # Build per-chunk premise texts (trim each to a budget that fits
        # the 512-token window alongside the claim).
        MAX_PREMISE_CHARS = 1200
        premise_texts = []
        for chunk in premise_chunks:
            text = chunk.content.strip()
            if text:
                premise_texts.append(text[:MAX_PREMISE_CHARS])

        entailment_probs = []
        contradiction_probs = []
        neutral_probs = []

        # Evaluate claims (limit to a representative sample to balance speed)
        audited_claims = claims[:12]
        failed_claims = 0

        for claim in audited_claims:
            try:
                # For each claim, find the best entailment across all chunks
                best_entailment = 0.0
                best_neutral = 1.0
                worst_contradiction = 0.0

                for premise_text in premise_texts:
                    encoded = self._tokenizer.encode(premise_text, claim)
                    input_ids = np.array([encoded.ids], dtype=np.int64)
                    attention_mask = np.array([encoded.attention_mask], dtype=np.int64)

                    inputs = {
                        "input_ids": input_ids,
                        "attention_mask": attention_mask
                    }
                    outputs = self._session.run(None, inputs)
                    logits = outputs[0][0]

                    # Softmax normalization
                    exp = np.exp(logits - np.max(logits))
                    probs = exp / np.sum(exp)

                    # mDeBERTa-v3 xnli: 0: entailment, 1: neutral, 2: contradiction
                    if probs[0] > best_entailment:
                        best_entailment = float(probs[0])
                        best_neutral = float(probs[1])
                    if probs[2] > worst_contradiction:
                        worst_contradiction = float(probs[2])

                entailment_probs.append(best_entailment)
                neutral_probs.append(best_neutral)
                contradiction_probs.append(worst_contradiction)
            except Exception as e:
                logger.warning("Error evaluating claim in NLI fact-checker: %s", e)
                # Skip this claim rather than fabricating scores
                failed_claims += 1

        if not entailment_probs:
            # All claims failed inference -- report degraded, not fabricated
            return FactAuditResult(
                factual_score=None,
                hallucination_risk=None,
                entailment_prob=None,
                contradiction_prob=None,
                neutral_prob=None,
                claims_audited=0,
                audit_status="inference_failed",
            )

        avg_entailment = float(np.mean(entailment_probs))
        avg_neutral = float(np.mean(neutral_probs))
        avg_contradiction = float(np.mean(contradiction_probs))
        max_contradiction = float(np.max(contradiction_probs))

        # Composite factual consistency score
        # Strong entailment boosts score, neutral is partially accepted, contradiction heavily penalized
        raw_score = avg_entailment + (0.35 * avg_neutral) - (1.2 * max_contradiction)
        factual_score = round(float(max(0.05, min(0.99, raw_score))), 2)

        # Risk level determination
        if max_contradiction >= 0.35 or factual_score < 0.50:
            hallucination_risk = "high"
        elif factual_score < 0.75 or max_contradiction >= 0.20:
            hallucination_risk = "medium"
        else:
            hallucination_risk = "low"

        successfully_audited = len(audited_claims) - failed_claims
        status = "partial" if failed_claims > 0 else "completed"

        return FactAuditResult(
            factual_score=factual_score,
            hallucination_risk=hallucination_risk,
            entailment_prob=round(avg_entailment, 3),
            contradiction_prob=round(avg_contradiction, 3),
            neutral_prob=round(avg_neutral, 3),
            claims_audited=successfully_audited,
            audit_status=status,
        )
