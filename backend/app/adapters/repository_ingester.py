import io
import os
import re
import uuid
import zipfile
from typing import Optional, Any
from app.core.models import SourceDocument


class RepositoryIngester:
    """
    Ingester for code repositories (ZIP archives) and standalone code files.
    Applies strict .gitignore-style exclusion filters to remove dependencies,
    build artifacts, and binary assets.
    """

    EXCLUDED_DIRS = {
        ".git", "node_modules", "dist", "build", "target", "__pycache__",
        ".venv", "venv", ".idea", ".vscode", "vendor", ".next", ".nuxt",
        ".turbo", "coverage", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        "bin", "obj", ".gradle"
    }

    EXCLUDED_EXTENSIONS = {
        ".lock", ".exe", ".dll", ".so", ".dylib", ".png", ".jpg", ".jpeg",
        ".gif", ".ico", ".svg", ".pdf", ".zip", ".tar", ".gz", ".pyc",
        ".wasm", ".min.js", ".min.css", ".map", ".bin", ".woff", ".woff2",
        ".ttf", ".eot", ".mp3", ".mp4", ".mov", ".db", ".sqlite", ".sqlite3"
    }

    EXCLUDED_FILENAMES = {
        "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock",
        "poetry.lock", "gemfile.lock", "composer.lock", ".ds_store", "thumbs.db"
    }

    CODE_EXTENSIONS = {
        ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java",
        ".cpp", ".c", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
        ".kt", ".scala", ".sql", ".html", ".css", ".scss", ".json",
        ".yaml", ".yml", ".toml", ".sh", ".bash", ".zsh", ".md", ".txt"
    }

    MAX_FILES = 150
    MAX_FILE_SIZE_BYTES = 500 * 1024  # 500 KB per file
    MAX_REPO_TOTAL_BYTES = 6 * 1024 * 1024  # 6 MB total uncompressed text

    @classmethod
    def is_code_or_repo(cls, filename: str) -> bool:
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".zip":
            return True
        if ext in cls.CODE_EXTENSIONS:
            return True
        base = os.path.basename(filename).lower()
        if base in {"dockerfile", "makefile", "cargo.toml", "package.json", "gemfile"}:
            return True
        return False

    def ingest_zip(
        self,
        zip_bytes: bytes,
        filename: str,
        source_id: Optional[str] = None
    ) -> SourceDocument:
        doc_id = source_id or f"doc_repo_{uuid.uuid4().hex[:12]}"

        files_map: dict[str, str] = {}
        total_chars = 0

        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                raw_entries = sorted(zf.namelist())
                path_map = self._compute_relative_path_map(raw_entries)

                for entry in raw_entries:
                    # Ignore directories
                    if entry.endswith("/"):
                        continue

                    clean_rel_path = path_map.get(entry, entry)

                    # Check excluded directories in path
                    parts = [p.lower() for p in clean_rel_path.split("/")]
                    if any(p in self.EXCLUDED_DIRS for p in parts[:-1]):
                        continue

                    file_name = parts[-1]
                    if file_name.lower() in self.EXCLUDED_FILENAMES:
                        continue

                    ext = os.path.splitext(file_name)[1].lower()

                    if ext in self.EXCLUDED_EXTENSIONS:
                        continue

                    # Allow recognized code/config extensions or typical text files
                    if ext not in self.CODE_EXTENSIONS and file_name not in {"dockerfile", "makefile"}:
                        continue

                    info = zf.getinfo(entry)
                    if info.file_size > self.MAX_FILE_SIZE_BYTES:
                        continue

                    if len(files_map) >= self.MAX_FILES:
                        break

                    if total_chars + info.file_size > self.MAX_REPO_TOTAL_BYTES:
                        break

                    try:
                        raw_data = zf.read(entry)
                        # Detect text / decode UTF-8
                        text = raw_data.decode("utf-8", errors="replace")
                        files_map[clean_rel_path] = text
                        total_chars += len(text)
                    except Exception:
                        continue
        except Exception as e:
            raise RuntimeError(f"Error procesando archivo ZIP del repositorio: {str(e)}")

        if not files_map:
            raise ValueError("El archivo ZIP no contiene archivos de código fuente legibles o válidos.")

        # Build repository overview markdown
        tree_list = sorted(files_map.keys())
        summary_lines = [
            f"# Repositorio de Código: {filename}",
            f"**Total de archivos indexados**: {len(files_map)}",
            "",
            "## Archivos Incluidos:",
        ]
        for f in tree_list:
            summary_lines.append(f"- `{f}` ({len(files_map[f])} chars)")

        raw_md = "\n".join(summary_lines)

        return SourceDocument(
            id=doc_id,
            filename=filename,
            mime_type="application/zip",
            raw_markdown=raw_md,
            char_count=total_chars,
            metadata={
                "is_repo": True,
                "is_code": True,
                "file_count": len(files_map),
                "tree": tree_list,
                "files": files_map
            }
        )

    def ingest_code_file(
        self,
        content_bytes: bytes,
        filename: str,
        source_id: Optional[str] = None
    ) -> SourceDocument:
        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
        text = content_bytes.decode("utf-8", errors="replace")
        ext = os.path.splitext(filename)[1].lstrip(".").lower() or "txt"

        mime_mapping = {
            "py": "text/x-python",
            "ts": "text/typescript",
            "tsx": "text/typescript",
            "js": "text/javascript",
            "jsx": "text/javascript",
            "go": "text/x-go",
            "rs": "text/rust",
            "java": "text/x-java-source",
            "cpp": "text/x-c++src",
            "c": "text/x-csrc",
            "sql": "application/sql",
            "html": "text/html",
            "css": "text/css",
            "json": "application/json",
            "yaml": "text/yaml",
            "yml": "text/yaml",
            "sh": "application/x-sh"
        }

        mime_type = mime_mapping.get(ext, f"text/x-{ext}")

        return SourceDocument(
            id=doc_id,
            filename=filename,
            mime_type=mime_type,
            raw_markdown=text,
            char_count=len(text),
            metadata={
                "is_repo": False,
                "is_code": True,
                "language": ext
            }
        )

    def _compute_relative_path_map(self, entries: list[str]) -> dict[str, str]:
        valid_files = [e for e in entries if not e.endswith("/")]
        if not valid_files:
            return {e: e for e in entries}

        # Check if every single valid file starts with the same top-level directory
        first_segments = []
        for e in valid_files:
            parts = e.split("/")
            if len(parts) > 1 and parts[0]:
                first_segments.append(parts[0])
            else:
                first_segments.append("")

        if len(first_segments) == len(valid_files) and len(set(first_segments)) == 1 and first_segments[0] != "":
            common_root = first_segments[0] + "/"
            prefix_len = len(common_root)
            return {e: e[prefix_len:] if e.startswith(common_root) else e for e in entries}

        return {e: e for e in entries}
