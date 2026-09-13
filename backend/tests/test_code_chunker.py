import pytest
from app.adapters.code_chunker import SemanticCodeChunker
from app.core.models import SourceDocument


def test_code_chunker_single_python_file():
    code_content = '''"""Auth module."""
import os

class AuthService:
    def __init__(self, secret: str):
        self.secret = secret

    def verify_token(self, token: str) -> bool:
        if not token:
            return False
        return token.startswith("Bearer ")

def helper_function(x: int) -> int:
    return x * 2
'''
    doc = SourceDocument(
        id="doc_py_1",
        filename="auth.py",
        mime_type="text/x-python",
        raw_markdown=code_content,
        char_count=len(code_content),
        metadata={"is_code": True, "language": "py"}
    )

    chunker = SemanticCodeChunker()
    chunks = chunker.chunk(doc)

    assert len(chunks) >= 2
    # Verify symbols in heading_path
    symbols = [c.heading_hierarchy[-1] for c in chunks]
    assert any("AuthService" in s for s in symbols)
    assert any("helper_function" in s for s in symbols)

    # Verify character offsets point to valid text
    for c in chunks:
        assert c.start_char >= 0
        assert c.end_char <= len(code_content)
        assert c.start_char < c.end_char
        slice_text = code_content[c.start_char:c.end_char]
        assert c.content in slice_text or slice_text.strip() == c.content


def test_code_chunker_single_typescript_file():
    ts_content = '''import { Request, Response } from 'express';

export interface UserPayload {
  id: string;
  email: string;
}

export class UserController {
  async getUser(req: Request, res: Response): Promise<void> {
    res.json({ id: req.params.id });
  }
}

export function formatUser(user: UserPayload): string {
  return `${user.email} (${user.id})`;
}
'''
    doc = SourceDocument(
        id="doc_ts_1",
        filename="user.ts",
        mime_type="text/typescript",
        raw_markdown=ts_content,
        char_count=len(ts_content),
        metadata={"is_code": True, "language": "ts"}
    )

    chunker = SemanticCodeChunker()
    chunks = chunker.chunk(doc)

    assert len(chunks) >= 2
    symbols = [c.heading_hierarchy[-1] for c in chunks]
    assert any("UserController" in s or "UserPayload" in s for s in symbols)
    assert any("formatUser" in s for s in symbols)


def test_code_chunker_repository_bundle():
    files = {
        "src/core/math.py": "def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n",
        "src/main.py": "from core.math import add\n\ndef main():\n    print(add(2, 3))\n"
    }

    doc = SourceDocument(
        id="doc_repo_99",
        filename="calculator.zip",
        mime_type="application/zip",
        raw_markdown="# Calculator Repo\n- src/core/math.py\n- src/main.py",
        char_count=sum(len(v) for v in files.values()),
        metadata={
            "is_repo": True,
            "is_code": True,
            "files": files,
            "tree": list(files.keys())
        }
    )

    chunker = SemanticCodeChunker()
    chunks = chunker.chunk(doc)

    # Chunk 0 is repository architecture overview
    assert chunks[0].id == "doc_repo_99_chunk_0"
    assert "calculator.zip" in chunks[0].heading_hierarchy[0]
    assert "src/core/math.py" in chunks[0].content

    # Following chunks represent files
    file_headers = [c.heading_hierarchy[0] for c in chunks[1:]]
    assert "src/core/math.py" in file_headers
    assert "src/main.py" in file_headers
