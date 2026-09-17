# OpenFolioLM

> **An open-source, local-first alternative to Google NotebookLM focused on high-precision RAG, zero-hallucination grounding, and synchronized document exploration.**

---

## 🎯 Vision & Purpose

Google NotebookLM redefined how we interact with complex documents by introducing **source-gated context, strict factual grounding, and interactive citations linked directly to a side-by-side document viewer**.

However, relying on proprietary cloud services exposes sensitive documents and limits customization. **OpenFolioLM** brings this exact core experience to your local machine:

1. **Strict Grounding & Zero Hallucination**: The LLM answers strictly within the boundary of active documents (`Closed-Domain Synthesis`). Missing information triggers explicit missing evidence reporting rather than plausible confabulation.
2. **Positional Chunking & Verifiable Citations**: Every extracted chunk preserves exact character offsets (`start_char`, `end_char`) and Markdown heading hierarchies. When the model outputs `[^1]`, the UI highlights the verbatim passage in the original document.
3. **Source-Gated Context**: Checkbox-level control over which uploaded documents participate in any given query.
4. **Interactive Split-Screen Viewer**: Read documents on the left while conversing on the right. Clicking any citation smoothly auto-scrolls the viewer and highlights the source evidence.

---

## 🏗️ Architecture: Hexagonal (Ports & Adapters)

OpenFolioLM separates business domain logic from infrastructure details:

```
                          ┌───────────────────────────────┐
                          │          CORE DOMAIN          │
                          │  SourceDocument, Chunk,       │
                          │  Citation, GroundedResponse   │
                          └───────────────┬───────────────┘
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
    [Port: Ingestion]            [Port: Retrieval]             [Port: Synthesizer]
            │                             │                             │
            ▼                             ▼                             ▼
   (Adapter: MarkItDown         (Adapter: Hybrid BM25         (Adapter: Closed-Domain
    In-Process Converter)        + Vector + FlashRank)         Citation Generator)
```

### Components

* **Ingestion (`app/adapters/markitdown_adapter.py`)**: Uses Microsoft MarkItDown to convert PDF, DOCX, PPTX, XLSX, images, and text into clean, structured Markdown.
* **Positional Chunker (`app/adapters/positional_chunker.py`)**: Segments Markdown on heading hierarchies (`#`, `##`, `###`) and paragraphs while calculating precise character offsets for UI grounding.
* **Storage & Hybrid Search (`app/adapters/sqlite_store.py`)**: SQLite-backed metadata storage with FTS5 lexical matching (BM25) and dense embeddings.
* **Re-Ranking (`app/adapters/reranker.py`)**: Ultra-lightweight local FlashRank (ONNX) running on CPU to prune retrieval noise before prompt synthesis.
* **API Layer (`app/api/`)**: FastAPI endpoints with SSE (Server-Sent Events) streaming.
* **Frontend (`frontend/`)**: Vite + React + Tailwind CSS dual-pane interface.

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+

### 1. Backend Setup
```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Unix/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

---

## 🧪 Testing (Strict TDD)

Run the backend test suite:
```bash
pytest backend/tests -v
```

---

## 📄 License

MIT
