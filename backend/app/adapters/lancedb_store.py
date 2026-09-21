from __future__ import annotations
import os
import json
import logging
from typing import Optional, Any
import lancedb
import pyarrow as pa
from app.core.config import settings
from app.core.models import DocumentChunk
from app.ports.vector_store import VectorStorePort

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODEL = settings.embedding_model


class LanceDBVectorStore(VectorStorePort):
    """
    LanceDB-backed dense vector store for semantic nearest-neighbor search.
    Stores project vector tables in Lance format with ONNX multilingual embeddings.
    """

    def __init__(
        self,
        db_dir: str,
        embedding_model_name: Optional[str] = None,
        embedding_model: Optional[Any] = None
    ):
        self.db_dir = os.path.abspath(db_dir)
        self.embedding_model_name = embedding_model_name or settings.embedding_model
        self._embedding_model = embedding_model

    def _format_text(self, text: str, is_query: bool = False) -> str:
        """Applies model-specific formatting or prefixes (e.g. e5 models)."""
        if "e5" in self.embedding_model_name.lower():
            prefix = "query: " if is_query else "passage: "
            if not text.startswith(prefix):
                return prefix + text
        return text

    def _get_embedding_model(self) -> Any:
        if self._embedding_model is None:
            from fastembed import TextEmbedding
            self._embedding_model = TextEmbedding(model_name=self.embedding_model_name)
        return self._embedding_model

    def _get_db(self):
        os.makedirs(self.db_dir, exist_ok=True)
        return lancedb.connect(self.db_dir)

    def _get_table_names(self, db) -> list[str]:
        try:
            res = db.list_tables()
            if hasattr(res, "tables"):
                return list(res.tables)
            return list(res)
        except Exception:
            try:
                return list(db.table_names())
            except Exception as e:
                logger.warning("Failed to list LanceDB tables: %s", e)
                return []

    def _get_schema(self, dim: int) -> pa.Schema:
        return pa.schema([
            pa.field("chunk_id", pa.string()),
            pa.field("source_id", pa.string()),
            pa.field("heading_hierarchy_json", pa.string()),
            pa.field("start_char", pa.int64()),
            pa.field("end_char", pa.int64()),
            pa.field("content", pa.string()),
            pa.field("token_estimate", pa.int64()),
            pa.field("page_number", pa.int64(), nullable=True),
            pa.field("vector", pa.list_(pa.float32(), dim)),
        ])

    def add_chunks(self, chunks: list[DocumentChunk]) -> None:
        if not chunks:
            return

        texts = [self._format_text(c.content, is_query=False) for c in chunks]
        model = self._get_embedding_model()
        embeddings = list(model.embed(texts))
        if not embeddings:
            return

        vectors_list = [
            v.tolist() if hasattr(v, "tolist") else list(v)
            for v in embeddings
        ]
        dim = len(vectors_list[0])

        records = [
            {
                "chunk_id": c.id,
                "source_id": c.source_id,
                "heading_hierarchy_json": json.dumps(c.heading_hierarchy),
                "start_char": c.start_char,
                "end_char": c.end_char,
                "content": c.content,
                "token_estimate": c.token_estimate,
                "page_number": c.page_number,
                "vector": v
            }
            for c, v in zip(chunks, vectors_list)
        ]

        db = self._get_db()
        table_names = self._get_table_names(db)
        if "chunks" not in table_names:
            schema = self._get_schema(dim)
            db.create_table("chunks", schema=schema, data=records)
        else:
            tbl = db.open_table("chunks")
            existing_dim = None
            try:
                existing_dim = getattr(tbl.schema.field("vector").type, "list_size", None)
            except Exception:
                pass

            if existing_dim is not None and existing_dim != dim:
                raise ValueError(
                    f"Embedding dimension mismatch: existing index has dim={existing_dim} "
                    f"but the active model '{self.embedding_model_name}' produces dim={dim}. "
                    f"Reindex the project to rebuild the vector store with the new model."
                )
            else:
                existing_fields = set(tbl.schema.names)
                if "page_number" not in existing_fields:
                    try:
                        logger.info("Migrating LanceDB table 'chunks': adding missing column 'page_number'")
                        tbl.add_columns({"page_number": "cast(null as bigint)"})
                        existing_fields = set(tbl.schema.names)
                    except Exception as col_err:
                        logger.warning("Could not add 'page_number' column to 'chunks': %s", col_err)

                safe_records = [
                    {k: v for k, v in r.items() if k in existing_fields}
                    for r in records
                ]
                tbl.add(safe_records)

    def delete_document_chunks(self, source_id: str) -> None:
        db = self._get_db()
        table_names = self._get_table_names(db)
        if "chunks" not in table_names:
            return

        tbl = db.open_table("chunks")
        safe_sid = source_id.replace("'", "''")
        try:
            tbl.delete(f"source_id = '{safe_sid}'")
        except Exception as e:
            logger.warning("Failed to delete LanceDB chunks for source '%s': %s", source_id, e)

    def search_vectors(
        self,
        query: str,
        active_source_ids: list[str],
        top_k: int = 15
    ) -> list[tuple[DocumentChunk, float]]:
        if not active_source_ids or not query.strip():
            return []

        db = self._get_db()
        table_names = self._get_table_names(db)
        if "chunks" not in table_names:
            return []

        tbl = db.open_table("chunks")
        if len(tbl) == 0:
            return []

        formatted_query = self._format_text(query, is_query=True)
        model = self._get_embedding_model()
        query_embeddings = list(model.embed([formatted_query]))
        if not query_embeddings:
            return []

        q_vec = query_embeddings[0]
        q_vec_list = q_vec.tolist() if hasattr(q_vec, "tolist") else list(q_vec)

        # Dimension safety guard
        try:
            existing_dim = getattr(tbl.schema.field("vector").type, "list_size", None)
            if existing_dim is not None and len(q_vec_list) != existing_dim:
                logger.warning(
                    "Query vector dimension (%d) does not match LanceDB table dimension (%d). Skipping vector search.",
                    len(q_vec_list),
                    existing_dim
                )
                return []
        except Exception as e:
            logger.debug("Could not check LanceDB vector dimension: %s", e)

        safe_sids = [sid.replace("'", "''") for sid in active_source_ids]
        where_in = ", ".join(f"'{sid}'" for sid in safe_sids)
        where_clause = f"source_id IN ({where_in})"

        try:
            results = tbl.search(q_vec_list).where(where_clause).limit(top_k).to_list()
        except Exception as e:
            logger.warning("LanceDB vector search failed: %s", e)
            return []

        output: list[tuple[DocumentChunk, float]] = []
        for row in results:
            p_num = row.get("page_number")
            chunk = DocumentChunk(
                id=row["chunk_id"],
                source_id=row["source_id"],
                heading_hierarchy=json.loads(row.get("heading_hierarchy_json", "[]")),
                start_char=int(row["start_char"]),
                end_char=int(row["end_char"]),
                content=row["content"],
                token_estimate=int(row["token_estimate"]),
                page_number=int(p_num) if p_num is not None else None
            )
            distance = float(row.get("_distance", 0.0))
            output.append((chunk, distance))

        return output

    def rebuild_table_with_chunks(self, chunks: list[DocumentChunk]) -> None:
        """Drops the chunks table if it exists and rebuilds it with all provided chunks."""
        db = self._get_db()
        table_names = self._get_table_names(db)
        if "chunks" in table_names:
            try:
                db.drop_table("chunks")
            except Exception as e:
                logger.warning("Error dropping table 'chunks' during rebuild: %s", e)
        if chunks:
            self.add_chunks(chunks)

    def get_dimension(self) -> int:
        """Returns the embedding dimension of the active model."""
        model = self._get_embedding_model()
        vec = next(model.embed(["_dim_check_"]))
        return len(vec)

    def check_dimension_match(self) -> bool:
        """Checks if the existing chunks table matches the active model dimension."""
        db = self._get_db()
        t_names = self._get_table_names(db)
        if "chunks" not in t_names:
            return True
        tbl = db.open_table("chunks")
        try:
            existing_dim = getattr(tbl.schema.field("vector").type, "list_size", None)
            if existing_dim is not None:
                return existing_dim == self.get_dimension()
        except Exception as e:
            logger.debug("Could not check LanceDB dimension match: %s", e)
        return True

