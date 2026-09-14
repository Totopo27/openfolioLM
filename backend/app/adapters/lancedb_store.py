from __future__ import annotations
import os
import json
from typing import Optional, Any
import lancedb
import pyarrow as pa
from app.core.models import DocumentChunk
from app.ports.vector_store import VectorStorePort


DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


class LanceDBVectorStore(VectorStorePort):
    """
    LanceDB-backed dense vector store for semantic nearest-neighbor search.
    Stores project vector tables in Lance format with ONNX multilingual embeddings.
    """

    def __init__(
        self,
        db_dir: str,
        embedding_model_name: str = DEFAULT_EMBEDDING_MODEL,
        embedding_model: Optional[Any] = None
    ):
        self.db_dir = os.path.abspath(db_dir)
        self.embedding_model_name = embedding_model_name
        self._embedding_model = embedding_model

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
            return list(db.table_names())

    def _get_schema(self, dim: int) -> pa.Schema:
        return pa.schema([
            pa.field("chunk_id", pa.string()),
            pa.field("source_id", pa.string()),
            pa.field("heading_hierarchy_json", pa.string()),
            pa.field("start_char", pa.int64()),
            pa.field("end_char", pa.int64()),
            pa.field("content", pa.string()),
            pa.field("token_estimate", pa.int64()),
            pa.field("vector", pa.list_(pa.float32(), dim)),
        ])

    def add_chunks(self, chunks: list[DocumentChunk]) -> None:
        if not chunks:
            return

        texts = [c.content for c in chunks]
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
            tbl.add(records)

    def delete_document_chunks(self, source_id: str) -> None:
        db = self._get_db()
        table_names = self._get_table_names(db)
        if "chunks" not in table_names:
            return

        tbl = db.open_table("chunks")
        safe_sid = source_id.replace("'", "''")
        try:
            tbl.delete(f"source_id = '{safe_sid}'")
        except Exception:
            pass

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

        model = self._get_embedding_model()
        query_embeddings = list(model.embed([query]))
        if not query_embeddings:
            return []

        q_vec = query_embeddings[0]
        q_vec_list = q_vec.tolist() if hasattr(q_vec, "tolist") else list(q_vec)

        safe_sids = [sid.replace("'", "''") for sid in active_source_ids]
        where_in = ", ".join(f"'{sid}'" for sid in safe_sids)
        where_clause = f"source_id IN ({where_in})"

        try:
            results = tbl.search(q_vec_list).where(where_clause).limit(top_k).to_list()
        except Exception:
            return []

        output: list[tuple[DocumentChunk, float]] = []
        for row in results:
            chunk = DocumentChunk(
                id=row["chunk_id"],
                source_id=row["source_id"],
                heading_hierarchy=json.loads(row.get("heading_hierarchy_json", "[]")),
                start_char=int(row["start_char"]),
                end_char=int(row["end_char"]),
                content=row["content"],
                token_estimate=int(row["token_estimate"])
            )
            distance = float(row.get("_distance", 0.0))
            output.append((chunk, distance))

        return output
