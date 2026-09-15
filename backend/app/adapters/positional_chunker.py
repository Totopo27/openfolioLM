import re
from typing import Optional
from app.core.models import SourceDocument, DocumentChunk
from app.ports.chunker import ChunkerPort


class PositionalChunker(ChunkerPort):
    """Chunker that preserves exact character coordinates and heading hierarchies."""

    HEADING_REGEX = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
    PARAGRAPH_SPLIT_REGEX = re.compile(r"\n\s*\n")
    PAGE_COMMENT_REGEX = re.compile(r"<!--\s*PAGE:\s*(\d+)")

    def _resolve_page_number(
        self,
        char_offset: int,
        raw_markdown: str,
        page_offsets: Optional[list[dict]] = None
    ) -> Optional[int]:
        if page_offsets:
            for rec in page_offsets:
                if rec.get("start_char", 0) <= char_offset < rec.get("end_char", float("inf")):
                    return rec.get("page")

        prefix = raw_markdown[:char_offset + 50]
        matches = list(self.PAGE_COMMENT_REGEX.finditer(prefix))
        if matches:
            return int(matches[-1].group(1))

        return None

    def chunk(
        self,
        document: SourceDocument,
        max_chunk_chars: int = 1200,
        min_chunk_chars: int = 150
    ) -> list[DocumentChunk]:
        raw = document.raw_markdown
        if not raw or not raw.strip():
            return []

        page_offsets = document.metadata.get("page_offsets") if document.metadata else None

        # Find all headings with their exact start and end positions
        heading_matches = list(self.HEADING_REGEX.finditer(raw))

        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        # If no headings exist, chunk the entire text by paragraphs
        if not heading_matches:
            return self._chunk_slice(
                raw=raw,
                slice_start=0,
                slice_end=len(raw),
                source_id=document.id,
                heading_hierarchy=[],
                start_idx=chunk_idx,
                max_chars=max_chunk_chars,
                min_chars=min_chunk_chars,
                page_offsets=page_offsets
            )

        # Process text before first heading if any
        first_heading_start = heading_matches[0].start()
        if first_heading_start > 0:
            pre_chunks = self._chunk_slice(
                raw=raw,
                slice_start=0,
                slice_end=first_heading_start,
                source_id=document.id,
                heading_hierarchy=[],
                start_idx=chunk_idx,
                max_chars=max_chunk_chars,
                min_chars=min_chunk_chars,
                page_offsets=page_offsets
            )
            chunks.extend(pre_chunks)
            chunk_idx += len(pre_chunks)

        # Process each heading section
        heading_stack: list[tuple[int, str]] = []  # (level, header_text)

        for i, match in enumerate(heading_matches):
            hashes, title = match.group(1), match.group(2)
            level = len(hashes)
            full_header_line = match.group(0)

            # Update heading stack
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, full_header_line.strip()))

            current_hierarchy = [h[1] for h in heading_stack]

            # Section bounds: from start of this heading to start of next heading (or EOF)
            section_start = match.start()
            section_end = heading_matches[i + 1].start() if i + 1 < len(heading_matches) else len(raw)

            sec_chunks = self._chunk_slice(
                raw=raw,
                slice_start=section_start,
                slice_end=section_end,
                source_id=document.id,
                heading_hierarchy=current_hierarchy,
                start_idx=chunk_idx,
                max_chars=max_chunk_chars,
                min_chars=min_chunk_chars,
                page_offsets=page_offsets
            )
            chunks.extend(sec_chunks)
            chunk_idx += len(sec_chunks)

        return chunks

    def _chunk_slice(
        self,
        raw: str,
        slice_start: int,
        slice_end: int,
        source_id: str,
        heading_hierarchy: list[str],
        start_idx: int,
        max_chars: int,
        min_chars: int,
        page_offsets: Optional[list[dict]] = None
    ) -> list[DocumentChunk]:
        slice_text = raw[slice_start:slice_end]
        if not slice_text.strip():
            return []

        # If the slice is within max_chars, it's a single chunk
        if len(slice_text) <= max_chars:
            page_num = self._resolve_page_number(slice_start, raw, page_offsets)
            chunk = DocumentChunk(
                id=f"{source_id}#c{start_idx}",
                source_id=source_id,
                heading_hierarchy=heading_hierarchy,
                start_char=slice_start,
                end_char=slice_end,
                content=slice_text,
                page_number=page_num
            )
            return [chunk]

        # Otherwise, split by paragraph boundaries
        chunks: list[DocumentChunk] = []
        curr_idx = start_idx

        # Split on paragraph boundaries while preserving offsets
        # Use finditer on paragraph regex within slice
        para_splits = list(self.PARAGRAPH_SPLIT_REGEX.finditer(slice_text))
        boundaries = [0]
        for m in para_splits:
            boundaries.append(m.start())
            boundaries.append(m.end())
        boundaries.append(len(slice_text))

        # Build chunks by grouping paragraphs
        p_start = 0
        while p_start < len(slice_text):
            # Try to take up to max_chars
            target_end = min(p_start + max_chars, len(slice_text))

            # Look for a paragraph or sentence boundary near target_end
            if target_end < len(slice_text):
                # Search backwards for a double newline or newline
                split_point = slice_text.rfind("\n\n", p_start, target_end)
                if split_point != -1 and split_point > p_start:
                    actual_end = split_point + 2
                else:
                    # Look for sentence boundary
                    sentence_point = slice_text.rfind(". ", p_start, target_end)
                    if sentence_point != -1 and sentence_point > p_start:
                        actual_end = sentence_point + 2
                    else:
                        # Space boundary
                        space_point = slice_text.rfind(" ", p_start, target_end)
                        if space_point != -1 and space_point > p_start:
                            actual_end = space_point + 1
                        else:
                            actual_end = target_end
            else:
                actual_end = target_end

            chunk_content = slice_text[p_start:actual_end]
            if chunk_content.strip():
                global_start = slice_start + p_start
                global_end = slice_start + actual_end
                page_num = self._resolve_page_number(global_start, raw, page_offsets)

                chunk = DocumentChunk(
                    id=f"{source_id}#c{curr_idx}",
                    source_id=source_id,
                    heading_hierarchy=heading_hierarchy,
                    start_char=global_start,
                    end_char=global_end,
                    content=raw[global_start:global_end],
                    page_number=page_num
                )
                chunks.append(chunk)
                curr_idx += 1

            p_start = actual_end

        return chunks
