import pytest
from app.core.models import SourceDocument
from app.adapters.positional_chunker import PositionalChunker


def test_chunker_preserves_exact_character_offsets():
    markdown_sample = (
        "# Introduction\n\n"
        "OpenFolioLM is designed for grounded document analysis.\n"
        "It focuses on exact citations and zero hallucinations.\n\n"
        "## Architecture\n\n"
        "The architecture is hexagonal with ports and adapters.\n"
        "The ingestion layer utilizes Microsoft MarkItDown.\n\n"
        "### Ingestion Details\n\n"
        "MarkItDown extracts markdown preserving headings and tables.\n"
        "Then positional chunking takes over."
    )

    doc = SourceDocument(
        id="test_doc_1",
        filename="overview.md",
        raw_markdown=markdown_sample
    )

    chunker = PositionalChunker()
    chunks = chunker.chunk(doc, max_chunk_chars=300, min_chunk_chars=50)

    assert len(chunks) > 0

    # CRITICAL INVARIANT: Every single chunk's content MUST exactly match
    # the substring slice of raw_markdown at [start_char:end_char]
    for chunk in chunks:
        assert chunk.source_id == doc.id
        assert chunk.start_char >= 0
        assert chunk.end_char <= len(markdown_sample)
        assert chunk.start_char < chunk.end_char
        verbatim_slice = markdown_sample[chunk.start_char:chunk.end_char]
        assert chunk.content == verbatim_slice, (
            f"Chunk {chunk.id} content does not match slice:\n"
            f"Expected: {verbatim_slice!r}\nGot: {chunk.content!r}"
        )


def test_chunker_tracks_header_hierarchy():
    markdown_sample = (
        "# Book Title\n\n"
        "Prologue text.\n\n"
        "## Chapter 1: Foundations\n\n"
        "Foundational concepts are important.\n\n"
        "### Section 1.1: Core Patterns\n\n"
        "Clean architecture separates domain from frameworks."
    )

    doc = SourceDocument(
        id="book_doc",
        filename="book.md",
        raw_markdown=markdown_sample
    )

    chunker = PositionalChunker()
    chunks = chunker.chunk(doc, max_chunk_chars=200, min_chunk_chars=20)

    # Find chunk in section 1.1
    section_chunks = [c for c in chunks if "Clean architecture" in c.content]
    assert len(section_chunks) == 1
    target_chunk = section_chunks[0]

    assert "# Book Title" in target_chunk.heading_hierarchy
    assert "## Chapter 1: Foundations" in target_chunk.heading_hierarchy
    assert "### Section 1.1: Core Patterns" in target_chunk.heading_hierarchy


def test_chunker_handles_plain_text_without_headers():
    plain_text = (
        "Paragraph one is here and it has some content.\n\n"
        "Paragraph two is here and it has some other content.\n\n"
        "Paragraph three wraps up the document."
    )

    doc = SourceDocument(
        id="plain_doc",
        filename="notes.txt",
        raw_markdown=plain_text
    )

    chunker = PositionalChunker()
    chunks = chunker.chunk(doc, max_chunk_chars=100, min_chunk_chars=10)

    assert len(chunks) >= 1
    for chunk in chunks:
        assert plain_text[chunk.start_char:chunk.end_char] == chunk.content
        assert chunk.heading_hierarchy == []
