import os
import re
import logging
from datetime import datetime, timezone
from typing import Optional, Any
from collections import defaultdict, Counter
import numpy as np

from app.core.models import SourceDocument
from app.adapters.project_manager import ProjectManager
from app.ports.network_builder import (
    NetworkBuilderPort,
    NetworkGraph,
    GraphNode,
    GraphEdge,
    GraphMetrics,
)

logger = logging.getLogger(__name__)


def _normalize_tokens(text: str) -> set[str]:
    cleaned = re.sub(r"[^\w\s]", " ", text.lower())
    return {w for w in cleaned.split() if len(w) > 2}


class CitationNetworkBuilder(NetworkBuilderPort):
    """
    Constructs an interactive Knowledge and Citation Graph for a project.
    Leverages SQLite source documents, LanceDB dense embeddings, and pure-Python
    scientometric algorithms (PageRank, Betweenness, Label Propagation).
    """

    def __init__(self, project_manager: ProjectManager):
        self.project_manager = project_manager

    def build_project_network(self, project_id: str, min_similarity: float = 0.65) -> NetworkGraph:
        store = self.project_manager.get_store(project_id)
        docs = store.list_documents()

        if not docs:
            return NetworkGraph()

        # 1. Build initial node map
        current_year = datetime.now(timezone.utc).year
        nodes_dict: dict[str, GraphNode] = {}
        doc_map: dict[str, SourceDocument] = {}

        for doc in docs:
            doc_map[doc.id] = doc
            meta = doc.metadata or {}
            title = meta.get("title") or doc.filename
            short_label = title[:28] + "..." if len(title) > 30 else title
            authors = meta.get("authors")
            if isinstance(authors, str):
                authors = [authors]
            elif not isinstance(authors, list):
                authors = []

            year_raw = meta.get("publication_year") or meta.get("year") or meta.get("year_or_era")
            year = None
            if year_raw is not None:
                try:
                    year = int(str(year_raw).strip())
                except ValueError:
                    m_year = re.search(r"\b(19\d{2}|20\d{2})\b", str(year_raw))
                    if m_year:
                        year = int(m_year.group(1))
            citations_count = meta.get("citations_count") or meta.get("cited_by_count") or 0
            doc_type = meta.get("doc_type") or "research_paper" if (meta.get("doi") or authors) else "general"

            nodes_dict[doc.id] = GraphNode(
                id=doc.id,
                title=title,
                label=short_label,
                authors=authors,
                year=year,
                citations_count=citations_count,
                role="corpus",
                doc_type=doc_type,
                in_corpus=True,
                cluster_id=0,
                centrality=0.0,
            )

        # 2. Extract Edges: Citations, Co-authorship & Dense Semantic Similarity
        edges: list[GraphEdge] = []
        edge_keys: set[tuple[str, str, str]] = set()

        # A. Citations & DOI Cross-References
        for doc_a in docs:
            raw_a = (doc_a.raw_markdown or "").lower()
            for doc_b in docs:
                if doc_a.id == doc_b.id:
                    continue
                meta_b = doc_b.metadata or {}
                doi_b = (meta_b.get("doi") or "").lower()
                title_b = (meta_b.get("title") or doc_b.filename).lower()

                # Check if document A cites document B
                is_cited = False
                if doi_b and len(doi_b) > 4 and doi_b in raw_a:
                    is_cited = True
                elif len(title_b) > 12 and title_b in raw_a:
                    is_cited = True

                if is_cited:
                    pair_key = (doc_a.id, doc_b.id, "citation")
                    if pair_key not in edge_keys:
                        edge_keys.add(pair_key)
                        edges.append(
                            GraphEdge(
                                source=doc_a.id,
                                target=doc_b.id,
                                type="citation",
                                weight=1.0,
                                label="Cita bibliográfica"
                            )
                        )

        # B. Co-authorship Edges
        doc_ids = list(docs)
        for i in range(len(doc_ids)):
            for j in range(i + 1, len(doc_ids)):
                doc_a = doc_ids[i]
                doc_b = doc_ids[j]
                authors_a = set(nodes_dict[doc_a.id].authors)
                authors_b = set(nodes_dict[doc_b.id].authors)
                shared_authors = authors_a.intersection(authors_b)

                if shared_authors:
                    u, v = sorted([doc_a.id, doc_b.id])
                    pair_key = (u, v, "co_authorship")
                    if pair_key not in edge_keys:
                        edge_keys.add(pair_key)
                        edges.append(
                            GraphEdge(
                                source=doc_a.id,
                                target=doc_b.id,
                                type="co_authorship",
                                weight=0.8,
                                label=f"Co-autoría ({', '.join(list(shared_authors)[:2])})"
                            )
                        )

        # C. Dense Semantic Cosine Similarity (from LanceDB embeddings)
        if len(docs) >= 2:
            doc_vectors: dict[str, np.ndarray] = {}
            try:
                vector_store = self.project_manager.get_vector_store(project_id)
                db = vector_store._get_db()
                table_names = vector_store._get_table_names(db)
                if "chunks" in table_names:
                    tbl = db.open_table("chunks")
                    df = tbl.to_pandas()
                    if not df.empty and "source_id" in df.columns and "vector" in df.columns:
                        grouped = df.groupby("source_id")
                        for sid, group in grouped:
                            vecs = np.array(group["vector"].tolist())
                            mean_vec = np.mean(vecs, axis=0)
                            norm = np.linalg.norm(mean_vec)
                            if norm > 0:
                                doc_vectors[sid] = mean_vec / norm
            except Exception as e:
                logger.debug(f"Could not load vector embeddings for graph: {e}")

            # Compute pairwise cosine similarity
            for i in range(len(doc_ids)):
                for j in range(i + 1, len(doc_ids)):
                    doc_a = doc_ids[i]
                    doc_b = doc_ids[j]
                    u, v = sorted([doc_a.id, doc_b.id])
                    pair_key = (u, v, "semantic_similarity")

                    sim = 0.0
                    if doc_a.id in doc_vectors and doc_b.id in doc_vectors:
                        sim = float(np.dot(doc_vectors[doc_a.id], doc_vectors[doc_b.id]))
                    else:
                        # Fallback to Jaccard similarity on tokens
                        tokens_a = _normalize_tokens(doc_a.filename + " " + (doc_a.raw_markdown[:1500]))
                        tokens_b = _normalize_tokens(doc_b.filename + " " + (doc_b.raw_markdown[:1500]))
                        inter = len(tokens_a & tokens_b)
                        union = len(tokens_a | tokens_b)
                        sim = inter / union if union > 0 else 0.0

                    if sim >= min_similarity:
                        if pair_key not in edge_keys:
                            edge_keys.add(pair_key)
                            edges.append(
                                GraphEdge(
                                    source=doc_a.id,
                                    target=doc_b.id,
                                    type="semantic_similarity",
                                    weight=round(sim, 3),
                                    label=f"{int(sim * 100)}% similitud"
                                )
                            )

        # 3. Graph Topological Algorithms (Pure Python)
        node_ids = list(nodes_dict.keys())
        undirected_adj: dict[str, set[str]] = {nid: set() for nid in node_ids}
        directed_adj: dict[str, list[str]] = {nid: [] for nid in node_ids}

        for edge in edges:
            undirected_adj[edge.source].add(edge.target)
            undirected_adj[edge.target].add(edge.source)
            if edge.type == "citation":
                directed_adj[edge.source].append(edge.target)
            else:
                directed_adj[edge.source].append(edge.target)
                directed_adj[edge.target].append(edge.source)

        # A. PageRank
        pagerank = self._compute_pagerank(node_ids, directed_adj)

        # B. Betweenness Centrality
        betweenness = self._compute_betweenness(node_ids, undirected_adj)

        # C. Community Detection (Label Propagation)
        clusters = self._compute_clusters(node_ids, undirected_adj)

        # 4. Scientometric Roles
        foundational_ids: list[str] = []
        frontier_ids: list[str] = []
        bridge_ids: list[str] = []

        # Calculate thresholds
        mean_pr = float(np.mean(list(pagerank.values()))) if pagerank else 0.0
        max_pr = max(pagerank.values()) if pagerank else 0.0
        sorted_bw = sorted([b for b in betweenness.values() if b > 0], reverse=True)
        high_bw_thresh = sorted_bw[0] if sorted_bw else 0.0

        citation_in_degrees = Counter([e.target for e in edges if e.type == "citation"])

        for nid in node_ids:
            node = nodes_dict[nid]
            node.centrality = round(pagerank.get(nid, 0.0), 4)
            node.cluster_id = clusters.get(nid, 0)
            in_citations = citation_in_degrees.get(nid, 0)
            pr = pagerank.get(nid, 0.0)
            bw = betweenness.get(nid, 0.0)
            is_recent = bool(node.year and node.year >= (current_year - 2))

            # 1. Foundation: High global citations or top landmark that receives citations
            if node.citations_count >= 50 or (in_citations > 0 and pr >= max_pr and not is_recent):
                node.role = "foundation"
                foundational_ids.append(node.title)
            # 2. Frontier: Recent publications in active domain
            elif is_recent:
                node.role = "frontier"
                frontier_ids.append(node.title)
            # 3. Bridge: Betweenness connecting multiple documents
            elif bw > 0 and bw >= high_bw_thresh and len(undirected_adj[nid]) >= 2:
                node.role = "bridge"
                bridge_ids.append(node.title)
            else:
                node.role = "corpus"

        # Calculate density
        n = len(node_ids)
        max_edges = (n * (n - 1)) / 2 if n > 1 else 1
        density = round(len(edges) / max_edges, 3) if max_edges > 0 else 0.0

        metrics = GraphMetrics(
            node_count=len(nodes_dict),
            edge_count=len(edges),
            foundational_papers=foundational_ids[:5],
            frontier_papers=frontier_ids[:5],
            bridge_papers=bridge_ids[:5],
            density=density,
        )

        return NetworkGraph(
            nodes=list(nodes_dict.values()),
            edges=edges,
            metrics=metrics,
        )

    def _compute_pagerank(
        self,
        nodes: list[str],
        adj: dict[str, list[str]],
        alpha: float = 0.85,
        max_iter: int = 60,
        tol: float = 1e-5
    ) -> dict[str, float]:
        n = len(nodes)
        if n == 0:
            return {}
        p = {u: 1.0 / n for u in nodes}

        for _ in range(max_iter):
            p_new = {u: (1.0 - alpha) / n for u in nodes}
            dangling_sum = sum(p[u] for u in nodes if not adj[u])
            dangling_contrib = (alpha * dangling_sum) / n
            for u in nodes:
                p_new[u] += dangling_contrib

            for u in nodes:
                nbrs = adj[u]
                if nbrs:
                    share = (alpha * p[u]) / len(nbrs)
                    for v in nbrs:
                        p_new[v] += share

            diff = sum(abs(p_new[u] - p[u]) for u in nodes)
            p = p_new
            if diff < tol:
                break
        return p

    def _compute_betweenness(self, nodes: list[str], adj: dict[str, set[str]]) -> dict[str, float]:
        """Brandes algorithm for betweenness centrality on undirected graphs."""
        cb = {u: 0.0 for u in nodes}
        for s in nodes:
            stack = []
            pred = {w: [] for w in nodes}
            sigma = {w: 0 for w in nodes}
            sigma[s] = 1
            d = {w: -1 for w in nodes}
            d[s] = 0
            queue = [s]

            while queue:
                v = queue.pop(0)
                stack.append(v)
                for w in adj[v]:
                    if d[w] < 0:
                        queue.append(w)
                        d[w] = d[v] + 1
                    if d[w] == d[v] + 1:
                        sigma[w] += sigma[v]
                        pred[w].append(v)

            delta = {w: 0.0 for w in nodes}
            while stack:
                w = stack.pop()
                for v in pred[w]:
                    if sigma[w] > 0:
                        delta[v] += (sigma[v] / sigma[w]) * (1.0 + delta[w])
                if w != s:
                    cb[w] += delta[w]

        # Normalize betweenness
        n = len(nodes)
        scale = 1.0 / ((n - 1) * (n - 2)) if n > 2 else 1.0
        return {u: round(val * scale * 0.5, 4) for u, val in cb.items()}

    def _compute_clusters(self, nodes: list[str], adj: dict[str, set[str]], max_iter: int = 15) -> dict[str, int]:
        """Label Propagation community detection in pure Python."""
        labels = {u: i for i, u in enumerate(nodes)}

        for _ in range(max_iter):
            changed = False
            for u in nodes:
                nbrs = adj[u]
                if not nbrs:
                    continue
                neighbor_labels = [labels[v] for v in nbrs]
                counts = Counter(neighbor_labels)
                most_common_label = counts.most_common(1)[0][0]
                if labels[u] != most_common_label:
                    labels[u] = most_common_label
                    changed = True
            if not changed:
                break

        # Re-index clusters to clean 0, 1, 2...
        unique_labels = sorted(list(set(labels.values())))
        label_map = {old: new for new, old in enumerate(unique_labels)}
        return {u: label_map[labels[u]] for u in nodes}
