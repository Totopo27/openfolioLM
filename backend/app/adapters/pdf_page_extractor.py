"""High-fidelity page-aware PDF extractor using pdfplumber with table and figure preservation."""

import io
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


def format_table_to_markdown(raw_table: list[list[Optional[str]]]) -> str:
    """Converts a 2D list of table cells into standard GitHub-Flavored Markdown."""
    if not raw_table:
        return ""

    cleaned_rows: list[list[str]] = []
    for row in raw_table:
        if not row:
            continue
        cleaned_cells = []
        has_content = False
        for cell in row:
            if cell is None:
                cleaned_cells.append("")
            else:
                cell_str = str(cell).replace("\r\n", " ").replace("\n", " ").replace("\r", " ").strip()
                cell_str = cell_str.replace("|", "\\|")
                if cell_str:
                    has_content = True
                cleaned_cells.append(cell_str)
        if has_content:
            cleaned_rows.append(cleaned_cells)

    if not cleaned_rows:
        return ""

    max_cols = max(len(r) for r in cleaned_rows)
    if max_cols == 0:
        return ""

    # Pad shorter rows to match max_cols
    normalized_rows: list[list[str]] = []
    for r in cleaned_rows:
        if len(r) < max_cols:
            r = r + [""] * (max_cols - len(r))
        normalized_rows.append(r)

    # Use row 0 as header, providing defaults for empty header cells
    header_row = normalized_rows[0]
    headers = [col if col else f"Columna {idx + 1}" for idx, col in enumerate(header_row)]
    separators = [":---"] * max_cols

    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(separators) + " |",
    ]

    for row in normalized_rows[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n" + "\n".join(lines) + "\n\n"


@dataclass
class PageExtractionResult:
    raw_markdown: str
    page_count: int
    page_offsets: list[dict[str, Any]] = field(default_factory=list)


class PageAwarePDFExtractor:
    """
    Extracts text page-by-page from PDFs, preserving physical and editorial (folio) page fidelity,
    tabular structures as GFM Markdown tables, and visual figures/diagrams as saved assets.
    """

    def __init__(
        self,
        extract_tables: bool = True,
        extract_figures: bool = False,
        assets_dir: Optional[str] = None,
        asset_url_prefix: str = "",
        vision_transcriber: Optional[Any] = None,
        max_pages: Optional[int] = None,
        min_figure_dimension: float = 60.0,
        min_vlm_dimension: float = 120.0,
        min_vlm_area: float = 15000.0,
        max_vlm_figures: int = 10,
        max_figures_per_page: int = 2,
    ):
        self.extract_tables = extract_tables
        self.extract_figures = extract_figures
        self.assets_dir = assets_dir
        self.asset_url_prefix = asset_url_prefix.rstrip("/")
        self.vision_transcriber = vision_transcriber
        self.max_pages = max_pages
        self.min_figure_dimension = min_figure_dimension
        self.min_vlm_dimension = min_vlm_dimension
        self.min_vlm_area = min_vlm_area
        self.max_vlm_figures = max_vlm_figures
        self.max_figures_per_page = max_figures_per_page

    def extract(self, file_path: str) -> PageExtractionResult:
        import pdfplumber

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found: {file_path}")

        page_records: list[dict[str, Any]] = []
        full_text_parts: list[str] = []
        current_offset = 0
        vlm_figures_processed = 0

        if self.extract_figures and self.assets_dir:
            os.makedirs(self.assets_dir, exist_ok=True)

        with pdfplumber.open(file_path) as pdf:
            detected_offsets: list[int] = []
            raw_pages: list[dict[str, Any]] = []

            pages_to_process = pdf.pages[:self.max_pages] if self.max_pages else pdf.pages

            # Pass 1: Extract page text, tables, figures, and detect folios
            for physical_num, page in enumerate(pages_to_process, start=1):
                page_im = None
                try:
                    txt = page.extract_text(layout=False) or ""
                except Exception as e:
                    logger.warning("Error extracting text on physical page %d: %s", physical_num, e)
                    txt = ""

                # Extract and format tables if enabled
                tables_md_parts: list[str] = []
                if self.extract_tables:
                    try:
                        extracted_tables = page.extract_tables()
                        for table_idx, tbl in enumerate(extracted_tables, start=1):
                            tbl_md = format_table_to_markdown(tbl)
                            if tbl_md:
                                tables_md_parts.append(
                                    f"### [Tabla {table_idx} - Pág. {physical_num}]\n{tbl_md}"
                                )
                    except Exception as e:
                        logger.warning("Error extracting tables on page %d: %s", physical_num, e)

                # Extract figures and diagrams if enabled
                figures_md_parts: list[str] = []
                if self.extract_figures and self.assets_dir and getattr(page, "images", None):
                    try:
                        # Filter candidate figures and prioritize larger ones (likely diagrams/charts)
                        candidates = []
                        for img_info in page.images:
                            w = float(img_info.get("width", 0))
                            h = float(img_info.get("height", 0))
                            if w >= self.min_figure_dimension and h >= self.min_figure_dimension:
                                candidates.append((w * h, img_info))

                        # Sort by area descending and respect per-page limit
                        candidates.sort(key=lambda x: x[0], reverse=True)
                        selected_candidates = [c[1] for c in candidates[:self.max_figures_per_page]]

                        if selected_candidates:
                            # Render high-res page image once to crop figures from
                            page_im = page.to_image(resolution=150)
                            orig_w, orig_h = page_im.original.size
                            scale_x = orig_w / float(page.width)
                            scale_y = orig_h / float(page.height)

                            fig_counter = 1
                            for img_info in selected_candidates:
                                w = float(img_info.get("width", 0))
                                h = float(img_info.get("height", 0))
                                x0 = float(img_info.get("x0", 0))
                                top = float(img_info.get("top", 0))
                                x1 = float(img_info.get("x1", x0 + w))
                                bottom = float(img_info.get("bottom", top + h))

                                px0 = max(0, int(x0 * scale_x))
                                ptop = max(0, int(top * scale_y))
                                px1 = min(orig_w, int(x1 * scale_x))
                                pbottom = min(orig_h, int(bottom * scale_y))

                                if px1 > px0 and pbottom > ptop:
                                    cropped = page_im.original.crop((px0, ptop, px1, pbottom))
                                    fig_filename = f"fig_p{physical_num}_{fig_counter}.png"
                                    fig_filepath = os.path.join(self.assets_dir, fig_filename)
                                    cropped.save(fig_filepath, format="PNG")

                                    img_url = f"{self.asset_url_prefix}/{fig_filename}" if self.asset_url_prefix else fig_filename
                                    fig_md = f"\n![Figura {fig_counter} (Pág. {physical_num})]({img_url})\n"

                                    # Multimodal Vision Transcription with quota and size gate
                                    should_transcribe = (
                                        self.vision_transcriber is not None
                                        and vlm_figures_processed < self.max_vlm_figures
                                        and w >= self.min_vlm_dimension
                                        and h >= self.min_vlm_dimension
                                        and (w * h) >= self.min_vlm_area
                                    )

                                    if should_transcribe:
                                        try:
                                            logger.info("Transcribiendo figura técnica %d de la página %d con VLM...", fig_counter, physical_num)
                                            img_bytes_io = io.BytesIO()
                                            cropped.save(img_bytes_io, format="PNG")
                                            transcription = self.vision_transcriber.transcribe(
                                                image_bytes=img_bytes_io.getvalue(),
                                                page_number=physical_num,
                                                figure_index=fig_counter
                                            )
                                            if transcription:
                                                logger.info("Figura técnica de pág. %d transcrita con éxito (%d caracteres)", physical_num, len(transcription))
                                                fig_md += f"\n> **[Análisis Visual de Figura - Pág. {physical_num}]**:\n> {transcription}\n"
                                            else:
                                                logger.warning("VLM no devolvió texto estructurado para la figura de pág. %d", physical_num)
                                            vlm_figures_processed += 1
                                        except Exception as vlm_err:
                                            logger.warning("VLM transcription error on page %d: %s", physical_num, vlm_err)

                                    figures_md_parts.append(fig_md)
                                    fig_counter += 1
                    except Exception as e:
                        logger.warning("Error extracting figures on page %d: %s", physical_num, e)
                    finally:
                        if page_im is not None:
                            try:
                                if hasattr(page_im, "close"):
                                    page_im.close()
                                elif hasattr(page_im, "original") and hasattr(page_im.original, "close"):
                                    page_im.original.close()
                            except Exception:
                                pass

                # Flush pdfplumber page cache to prevent memory accumulation in heavy books
                if hasattr(page, "flush_cache"):
                    try:
                        page.flush_cache()
                    except Exception:
                        pass

                lines = [line.strip() for line in txt.splitlines() if line.strip()]
                folio: Optional[int] = None

                if lines:
                    for candidate in reversed(lines[-2:]):
                        m = FOLIO_REGEX.match(candidate)
                        if m:
                            val = int(m.group(1))
                            if 1 <= val <= 3000:
                                folio = val
                                break

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
                    "tables_md": "\n\n".join(tables_md_parts),
                    "figures_md": "\n\n".join(figures_md_parts),
                    "folio": folio,
                })

            # Calculate dominant offset across document
            dominant_offset: Optional[int] = None
            if detected_offsets:
                counts = Counter(detected_offsets)
                dominant_offset = counts.most_common(1)[0][0]

            # Pass 2: Assemble Markdown with structured headers, tables, figures, and page delimiters
            for p in raw_pages:
                phys = p["physical_page"]
                folio = p["folio"]

                if folio is None and dominant_offset is not None and phys > dominant_offset:
                    inferred_folio = phys - dominant_offset
                else:
                    inferred_folio = folio

                effective_page = folio or inferred_folio or phys

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
                body_parts = []
                if p["text"].strip():
                    body_parts.append(p["text"].strip())
                if p["tables_md"]:
                    body_parts.append(p["tables_md"])
                if p["figures_md"]:
                    body_parts.append(p["figures_md"])

                body_text = "\n\n".join(body_parts)
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
