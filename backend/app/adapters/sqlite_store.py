import sqlite3
import json
from datetime import datetime, timezone
from typing import Optional
from app.core.models import SourceDocument, DocumentChunk
from app.ports.store import DocumentStorePort


class SQLiteDocumentStore(DocumentStorePort):
    """SQLite-backed persistent store for documents, chunks, and BM25 lexical search via FTS5."""

    def __init__(self, db_path: str = "openfolio.db"):
        self.db_path = db_path
        self._memory_conn: Optional[sqlite3.Connection] = None
        if db_path == ":memory:":
            self._memory_conn = sqlite3.connect(":memory:", check_same_thread=False)
            self._memory_conn.row_factory = sqlite3.Row
            self._memory_conn.execute("PRAGMA foreign_keys = ON")
        self._init_schema()

    def _get_connection(self) -> sqlite3.Connection:
        if self._memory_conn is not None:
            return self._memory_conn
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_schema(self) -> None:
        with self._get_connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    raw_markdown TEXT NOT NULL,
                    char_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    heading_hierarchy_json TEXT NOT NULL,
                    start_char INTEGER NOT NULL,
                    end_char INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    token_estimate INTEGER NOT NULL,
                    FOREIGN KEY (source_id) REFERENCES documents(id) ON DELETE CASCADE
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                    chunk_id UNINDEXED,
                    source_id UNINDEXED,
                    content,
                    tokenize = 'porter unicode61'
                );
            """)

    def add_document(self, document: SourceDocument, chunks: list[DocumentChunk]) -> None:
        with self._get_connection() as conn:
            # Upsert document
            conn.execute(
                """
                INSERT OR REPLACE INTO documents (id, filename, mime_type, raw_markdown, char_count, created_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document.id,
                    document.filename,
                    document.mime_type,
                    document.raw_markdown,
                    document.char_count,
                    document.created_at.isoformat(),
                    json.dumps(document.metadata)
                )
            )

            # Clear any old chunks for this document
            conn.execute("DELETE FROM chunks WHERE source_id = ?", (document.id,))
            conn.execute("DELETE FROM chunks_fts WHERE source_id = ?", (document.id,))

            # Insert chunks and FTS entries
            chunk_records = [
                (
                    c.id,
                    c.source_id,
                    json.dumps(c.heading_hierarchy),
                    c.start_char,
                    c.end_char,
                    c.content,
                    c.token_estimate
                )
                for c in chunks
            ]
            conn.executemany(
                """
                INSERT INTO chunks (id, source_id, heading_hierarchy_json, start_char, end_char, content, token_estimate)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                chunk_records
            )

            fts_records = [(c.id, c.source_id, c.content) for c in chunks]
            conn.executemany(
                "INSERT INTO chunks_fts (chunk_id, source_id, content) VALUES (?, ?, ?)",
                fts_records
            )

    def get_document(self, source_id: str) -> Optional[SourceDocument]:
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT * FROM documents WHERE id = ?", (source_id,))
            row = cursor.fetchone()
            if not row:
                return None

            return SourceDocument(
                id=row["id"],
                filename=row["filename"],
                mime_type=row["mime_type"],
                raw_markdown=row["raw_markdown"],
                char_count=row["char_count"],
                created_at=datetime.fromisoformat(row["created_at"]),
                metadata=json.loads(row["metadata_json"])
            )

    def list_documents(self) -> list[SourceDocument]:
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT * FROM documents ORDER BY created_at DESC")
            docs = []
            for row in cursor.fetchall():
                docs.append(
                    SourceDocument(
                        id=row["id"],
                        filename=row["filename"],
                        mime_type=row["mime_type"],
                        raw_markdown=row["raw_markdown"],
                        char_count=row["char_count"],
                        created_at=datetime.fromisoformat(row["created_at"]),
                        metadata=json.loads(row["metadata_json"])
                    )
                )
            return docs

    def delete_document(self, source_id: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.execute("DELETE FROM documents WHERE id = ?", (source_id,))
            conn.execute("DELETE FROM chunks WHERE source_id = ?", (source_id,))
            conn.execute("DELETE FROM chunks_fts WHERE source_id = ?", (source_id,))
            return cursor.rowcount > 0

    def search_chunks(
        self,
        query: str,
        active_source_ids: list[str],
        top_k: int = 5
    ) -> list[DocumentChunk]:
        if not active_source_ids or not query.strip():
            return []

        # Sanitize query for FTS5: extract alphanumeric tokens
        tokens = [t for t in query.replace('"', " ").replace("'", " ").split() if t.isalnum()]
        if not tokens:
            return []

        fts_query = " OR ".join(f'"{t}"*' for t in tokens)
        placeholders = ",".join("?" for _ in active_source_ids)

        sql = f"""
            SELECT c.*
            FROM chunks_fts fts
            JOIN chunks c ON fts.chunk_id = c.id
            WHERE fts.chunks_fts MATCH ?
              AND c.source_id IN ({placeholders})
            ORDER BY bm25(chunks_fts) ASC
            LIMIT ?
        """

        with self._get_connection() as conn:
            params = [fts_query] + list(active_source_ids) + [top_k]
            cursor = conn.execute(sql, params)
            results = []
            for row in cursor.fetchall():
                results.append(
                    DocumentChunk(
                        id=row["id"],
                        source_id=row["source_id"],
                        heading_hierarchy=json.loads(row["heading_hierarchy_json"]),
                        start_char=row["start_char"],
                        end_char=row["end_char"],
                        content=row["content"],
                        token_estimate=row["token_estimate"]
                    )
                )
            return results
