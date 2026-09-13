import os
import re
from typing import Optional
from app.core.models import SourceDocument, DocumentChunk
from app.ports.chunker import ChunkerPort


class SemanticCodeChunker(ChunkerPort):
    """
    Semantic chunker for code files and repositories.
    Preserves exact character offsets and structures chunks around
    functions, classes, interfaces, and logical code blocks.
    """

    # Multi-language definitions regex (Python, JS/TS, Go, Rust, Java, C/C++)
    FUNCTION_CLASS_REGEX = re.compile(
        r"^(?:"
        # Python: class Foo / def bar / async def baz
        r"(?:class\s+([A-Za-z0-9_]+))|"
        r"(?:(?:async\s+)?def\s+([A-Za-z0-9_]+))|"
        # JS/TS: function foo / async function foo / class Foo / export ...
        r"(?:(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_]+))|"
        r"(?:(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+))|"
        r"(?:(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>)|"
        r"(?:interface\s+([A-Za-z0-9_]+))|"
        r"(?:type\s+([A-Za-z0-9_]+)\s*=)|"
        # Go: func (r *Receiver) Method / func Function
        r"(?:func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+))|"
        r"(?:type\s+([A-Za-z0-9_]+)\s+(?:struct|interface))|"
        # Rust: fn foo / pub fn bar / struct Foo / impl Foo
        r"(?:(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+))|"
        r"(?:(?:pub\s+)?struct\s+([A-Za-z0-9_]+))|"
        r"(?:(?:pub\s+)?enum\s+([A-Za-z0-9_]+))|"
        r"(?:impl(?:\s+[A-Za-z0-9_]+)?\s+for\s+([A-Za-z0-9_]+)|impl\s+([A-Za-z0-9_]+))"
        r")",
        re.MULTILINE
    )

    def chunk(
        self,
        document: SourceDocument,
        max_chunk_chars: int = 1200,
        min_chunk_chars: int = 120
    ) -> list[DocumentChunk]:
        is_repo = document.metadata.get("is_repo", False)
        files_map: dict[str, str] = document.metadata.get("files", {})

        chunks: list[DocumentChunk] = []

        if is_repo and files_map:
            # 1. Chunk 0: Repository Map / Directory Architecture Overview
            tree_summary = self._build_repo_overview(document)
            chunks.append(
                DocumentChunk(
                    id=f"{document.id}_chunk_0",
                    source_id=document.id,
                    content=tree_summary,
                    heading_hierarchy=[document.filename, "Estructura y Arquitectura del Repositorio"],
                    start_char=0,
                    end_char=len(tree_summary),
                    token_estimate=max(1, len(tree_summary) // 4)
                )
            )

            # 2. Chunk each individual source file in the repository
            chunk_global_idx = 1
            for rel_path, file_content in files_map.items():
                file_chunks = self._chunk_single_code(
                    content=file_content,
                    file_path=rel_path,
                    source_id=document.id,
                    start_index=chunk_global_idx,
                    max_chars=max_chunk_chars,
                    min_chars=min_chunk_chars
                )
                chunks.extend(file_chunks)
                chunk_global_idx += len(file_chunks)

            return chunks

        # Single code file
        return self._chunk_single_code(
            content=document.raw_markdown,
            file_path=document.filename,
            source_id=document.id,
            start_index=0,
            max_chars=max_chunk_chars,
            min_chars=min_chunk_chars
        )

    def _chunk_single_code(
        self,
        content: str,
        file_path: str,
        source_id: str,
        start_index: int,
        max_chars: int,
        min_chars: int
    ) -> list[DocumentChunk]:
        if not content or not content.strip():
            return []

        chunks: list[DocumentChunk] = []
        matches = list(self.FUNCTION_CLASS_REGEX.finditer(content))

        # Small file with no or single symbol: single chunk
        if len(matches) <= 1 and len(content) <= max_chars:
            first_non_empty = [line.strip() for line in content.splitlines() if line.strip()]
            header_desc = first_non_empty[0][:50] if first_non_empty else file_path
            return [
                DocumentChunk(
                    id=f"{source_id}_chunk_{start_index}",
                    source_id=source_id,
                    content=content,
                    heading_hierarchy=[file_path, header_desc],
                    start_char=0,
                    end_char=len(content),
                    token_estimate=max(1, len(content) // 4)
                )
            ]

        curr_idx = start_index

        # File header / imports (before first function/class)
        first_match_start = matches[0].start() if matches else 0
        if first_match_start >= 20:
            header_content = content[:first_match_start].strip()
            if header_content:
                chunks.append(
                    DocumentChunk(
                        id=f"{source_id}_chunk_{curr_idx}",
                        source_id=source_id,
                        content=header_content,
                        heading_hierarchy=[file_path, "Cabecera e Importaciones"],
                        start_char=0,
                        end_char=first_match_start,
                        token_estimate=max(1, len(header_content) // 4)
                    )
                )
                curr_idx += 1

        # Process each semantic symbol
        for i, match in enumerate(matches):
            symbol_name = next(g for g in match.groups() if g is not None)
            block_start = match.start()
            block_end = matches[i + 1].start() if (i + 1) < len(matches) else len(content)

            symbol_raw = content[block_start:block_end]

            # If symbol block is within limit
            if len(symbol_raw) <= max_chars:
                chunks.append(
                    DocumentChunk(
                        id=f"{source_id}_chunk_{curr_idx}",
                        source_id=source_id,
                        content=symbol_raw.strip(),
                        heading_hierarchy=[file_path, symbol_name],
                        start_char=block_start,
                        end_char=block_end,
                        token_estimate=max(1, len(symbol_raw) // 4)
                    )
                )
                curr_idx += 1
            else:
                # Sub-chunk long functions by lines
                sub_chunks = self._subchunk_long_block(
                    block_content=symbol_raw,
                    base_offset=block_start,
                    file_path=file_path,
                    symbol_name=symbol_name,
                    source_id=source_id,
                    start_idx=curr_idx,
                    max_chars=max_chars
                )
                chunks.extend(sub_chunks)
                curr_idx += len(sub_chunks)

        return chunks

    def _subchunk_long_block(
        self,
        block_content: str,
        base_offset: int,
        file_path: str,
        symbol_name: str,
        source_id: str,
        start_idx: int,
        max_chars: int
    ) -> list[DocumentChunk]:
        lines = block_content.splitlines(keepends=True)
        sub_chunks: list[DocumentChunk] = []
        curr_lines: list[str] = []
        curr_len = 0
        part_offset = 0
        part_num = 1
        idx = start_idx

        for line in lines:
            if curr_len + len(line) > max_chars and curr_lines:
                chunk_str = "".join(curr_lines)
                start_c = base_offset + part_offset
                end_c = start_c + len(chunk_str)
                sub_chunks.append(
                    DocumentChunk(
                        id=f"{source_id}_chunk_{idx}",
                        source_id=source_id,
                        content=chunk_str.strip(),
                        heading_hierarchy=[file_path, f"{symbol_name} (parte {part_num})"],
                        start_char=start_c,
                        end_char=end_c,
                        token_estimate=max(1, len(chunk_str) // 4)
                    )
                )
                idx += 1
                part_num += 1
                part_offset += len(chunk_str)
                curr_lines = []
                curr_len = 0

            curr_lines.append(line)
            curr_len += len(line)

        if curr_lines:
            chunk_str = "".join(curr_lines)
            start_c = base_offset + part_offset
            end_c = start_c + len(chunk_str)
            sub_chunks.append(
                DocumentChunk(
                    id=f"{source_id}_chunk_{idx}",
                    source_id=source_id,
                    content=chunk_str.strip(),
                    heading_hierarchy=[file_path, f"{symbol_name} (parte {part_num})"],
                    start_char=start_c,
                    end_char=end_c,
                    token_estimate=max(1, len(chunk_str) // 4)
                )
            )

        return sub_chunks

    def _build_repo_overview(self, document: SourceDocument) -> str:
        files: dict[str, str] = document.metadata.get("files", {})
        file_tree = sorted(files.keys())
        total_files = len(file_tree)
        languages = sorted(set(
            os.path.splitext(f)[1].lstrip(".").lower() for f in file_tree if os.path.splitext(f)[1]
        ))

        overview = [
            f"# Repositorio: {document.filename}",
            f"**Total de archivos de código fuente**: {total_files}",
            f"**Lenguajes detectados**: {', '.join(languages) if languages else 'código/texto'}",
            "",
            "## Árbol de Archivos del Proyecto:",
            "```",
        ]
        for f in file_tree[:100]:
            overview.append(f)
        if len(file_tree) > 100:
            overview.append(f"... y {len(file_tree) - 100} archivos más.")
        overview.append("```")

        return "\n".join(overview)
