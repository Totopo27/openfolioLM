"""High-fidelity page-aware PDF extractor using pdfplumber."""

import logging
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

FOLIO_REGEX = re.compile(
    r"^(?:[\|\-—•\s]*)(?:p[áa]g\.?\s*)?(\d+)(?:[\|\-—•\s]*)$",
    re.IGNORECASE
)


@dataclass
class PageExtractionResult:
    raw_markdown: str
    page_count: int
    page_offsets: list[dict[str, Any]] = field(default_factory=list)


class PageAwarePDFExtractor:
    """
    Extracts text page-by-page from PDFs, preserving physical and editorial (folio) page fidelity.
    Generates structured Markdown with standardized page boundaries and character offset mappings.
    """

    def __init__(self):
        pass

    def extract(self, file_path: str) -> PageExtractionResult:
        import pdfplumber

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found: {file_path}")

        page_records: list[dict[str, Any]] = []
        full_text_parts: list[str] = []
        current_offset = 0

        with pdfplumber.open(file_path) as pdf:
            detected_offsets: list[int] = []
            raw_pages: list[dict[str, Any]] = []

            # Pass 1: Extract page text and detect folios
            for physical_num, page in enumerate(pdf.pages, start=1):
                try:
                    txt = page.extract_text(layout=False) or ""
                except Exception as e:
                    logger.warning("Error extracting text on physical page %d: %s", physical_num, e)
                    txt = ""

                lines = [line.strip() for line in txt.splitlines() if line.strip()]
                folio: Optional[int] = None

                if lines:
                    # Check bottom 2 lines for footer folio (most common in books)
                    for candidate in reversed(lines[-2:]):
                        m = FOLIO_REGEX.match(candidate)
                        if m:
                            val = int(m.group(1))
                            if 1 <= val <= 3000:
                                folio = val
                                break

                    # If not found in footer, check first line (header)
                    if folio is None:
                        m = FOLIO_REGEX.match(lines[0])
                        if m:
                            val = int(m.group(1))
                            if 1 <= val <= 3000:
                                folio = val

                if folio is not None:
                    detected_offsets.append(physical_num - folio)

                raw_pages.append({
                    "physical_page": physical_num,
                    "text": txt,
                    "folio": folio,
                })

            # Calculate dominant offset (physical_page - printed_folio) across the document
            dominant_offset: Optional[int] = None
            if detected_offsets:
                counts = Counter(detected_offsets)
                dominant_offset = counts.most_common(1)[0][0]

            # Pass 2: Assemble Markdown with structured page delimiters and clean boundaries
            for p in raw_pages:
                phys = p["physical_page"]
                folio = p["folio"]

                if folio is None and dominant_offset is not None and phys > dominant_offset:
                    inferred_folio = phys - dominant_offset
                else:
                    inferred_folio = folio

                effective_page = folio or inferred_folio or phys

                # Construct semantic page header
                if folio and folio != phys:
                    page_header = (
                        f"<!-- PAGE: {effective_page} PHYSICAL: {phys} -->\n\n"
                        f"--- [Pág. {effective_page}] ---\n\n"
                    )
                else:
                    page_header = (
                        f"<!-- PAGE: {effective_page} -->\n\n"
                        f"--- [Pág. {effective_page}] ---\n\n"
                    )

                start_char = current_offset
                body_text = p["text"].strip()
                page_block = page_header + body_text + "\n\n"

                end_char = start_char + len(page_block)
                current_offset = end_char

                full_text_parts.append(page_block)
                page_records.append({
                    "page": effective_page,
                    "physical_page": phys,
                    "folio": folio,
                    "start_char": start_char,
                    "end_char": end_char
                })

        full_markdown = "".join(full_text_parts).strip()

        return PageExtractionResult(
            raw_markdown=full_markdown,
            page_count=len(page_records),
            page_offsets=page_records
        )
