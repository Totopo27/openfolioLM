from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from app.main import create_app
from app.core.config import settings


def test_get_models_with_ollama_tags():
    app = create_app()
    client = TestClient(app)

    mock_ollama_response = MagicMock()
    mock_ollama_response.status_code = 200
    mock_ollama_response.json.return_value = {
        "models": [
            {
                "name": "qwen2.5:3b",
                "model": "qwen2.5:3b",
                "details": {"parameter_size": "3.1B"}
            },
            {
                "name": "llama3.2:latest",
                "model": "llama3.2:latest",
                "details": {"parameter_size": "3B"}
            }
        ]
    }
    mock_ollama_response.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_ollama_response):
        res = client.get("/api/models")
        assert res.status_code == 200
        data = res.json()
        assert "models" in data
        models = data["models"]
        
        # Check ollama models are listed
        ollama_ids = [m["id"] for m in models if m["provider"] == "ollama"]
        assert "ollama:qwen2.5:3b" in ollama_ids
        assert "ollama:llama3.2:latest" in ollama_ids

        # Check details
        qwen = next(m for m in models if m["id"] == "ollama:qwen2.5:3b")
        assert "3.1B" in qwen["name"]
        assert qwen["is_available"] is True


def test_get_models_ollama_offline():
    app = create_app()
    client = TestClient(app)

    # When Ollama endpoint times out or raises an exception
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=Exception("Connection refused")):
        res = client.get("/api/models")
        assert res.status_code == 200
        data = res.json()
        assert "models" in data
        # Check that fallback/default model is reported or graceful list
        models = data["models"]
        offline_ollama = [m for m in models if m["provider"] == "ollama"]
        assert len(offline_ollama) >= 1
        assert offline_ollama[0]["is_available"] is False
