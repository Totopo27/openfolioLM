from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient
from app.adapters.llm_client import (
    LLMProviderError,
    ModelHealthRegistry,
    ModelHealthRecord,
    OpenAICompatibleLLMClient,
    health_registry,
)
from app.main import create_app


def test_model_health_registry_lifecycle():
    registry = ModelHealthRegistry()
    registry.clear()

    # Initial unknown status
    status = registry.get_status("test-model")
    assert status.status == "unknown"

    # Record success
    registry.record_success("test-model", provider="gemini", latency_ms=145)
    status = registry.get_status("test-model")
    assert status.status == "healthy"
    assert status.latency_ms == 145

    # Record high demand with cooldown
    registry.record_high_demand("test-model", provider="gemini", error_message="HTTP 503 High Demand", cooldown_seconds=10.0)
    status = registry.get_status("test-model")
    assert status.status == "high_demand"
    assert status.is_in_cooldown() is True

    # Record offline
    registry.record_offline("test-model-2", provider="ollama", error_message="Endpoint down")
    status_2 = registry.get_status("test-model-2")
    assert status_2.status == "offline"


def test_llm_client_retries_on_503_and_recovers():
    registry = ModelHealthRegistry()
    registry.clear()

    client = OpenAICompatibleLLMClient(
        base_url="https://api.example.com/v1",
        api_key="test-key",
        model="gemini-2.5-flash",
        max_retries=2,
        retry_delay=0.01,  # fast test
    )

    # First attempt: 503 High Demand, Second attempt: 200 OK
    mock_resp_503 = MagicMock()
    mock_resp_503.status_code = 503
    mock_resp_503.text = '{"error": {"code": 503, "message": "High Demand"}}'

    mock_resp_200 = MagicMock()
    mock_resp_200.status_code = 200
    mock_resp_200.json.return_value = {
        "choices": [{"message": {"content": "Respuesta recuperada con éxito"}}]
    }

    with patch("httpx.Client.post", side_effect=[mock_resp_503, mock_resp_200]):
        answer = client.generate("system", "user")
        assert answer == "Respuesta recuperada con éxito"

        # Check registry shows healthy after recovery
        status = registry.get_status("gemini-2.5-flash")
        assert status.status == "healthy"


def test_llm_client_falls_back_on_persistent_503():
    registry = ModelHealthRegistry()
    registry.clear()

    client = OpenAICompatibleLLMClient(
        base_url="https://api.example.com/v1",
        api_key="test-key",
        model="gemini-2.5-flash",
        fallback_models=["gemini-2.0-flash"],
        max_retries=1,
        retry_delay=0.01,
    )

    # Primary model (gemini-2.5-flash): two 503s (initial + 1 retry)
    mock_resp_503 = MagicMock()
    mock_resp_503.status_code = 503
    mock_resp_503.text = '{"error": {"code": 503, "message": "High Demand"}}'

    # Fallback model (gemini-2.0-flash): 200 OK
    mock_resp_200 = MagicMock()
    mock_resp_200.status_code = 200
    mock_resp_200.json.return_value = {
        "choices": [{"message": {"content": "Respuesta desde modelo de fallback"}}]
    }

    with patch("httpx.Client.post", side_effect=[mock_resp_503, mock_resp_503, mock_resp_200]):
        answer = client.generate("system", "user")
        assert answer == "Respuesta desde modelo de fallback"

        # Primary model is marked high_demand
        primary_status = registry.get_status("gemini-2.5-flash")
        assert primary_status.status == "high_demand"

        # Fallback model is marked healthy
        fallback_status = registry.get_status("gemini-2.0-flash")
        assert fallback_status.status == "healthy"


def test_llm_client_raises_typed_error_when_all_models_fail():
    client = OpenAICompatibleLLMClient(
        base_url="https://api.example.com/v1",
        api_key="test-key",
        model="unavailable-model",
        max_retries=0,
    )
    response = MagicMock(status_code=401, text="unauthorized")

    with patch("httpx.Client.post", return_value=response):
        with pytest.raises(LLMProviderError) as exc_info:
            client.generate("system", "user")

    assert exc_info.value.provider == "gemini"
    assert exc_info.value.model == "unavailable-model"


def test_api_models_health_and_ping():
    app = create_app()
    client = TestClient(app)

    # Seed health registry
    health_registry.record_success("gemini-2.5-flash", "gemini", latency_ms=310)

    # 1. Check /api/models/health endpoint
    res = client.get("/api/models/health")
    assert res.status_code == 200
    data = res.json()
    assert "statuses" in data
    assert "gemini-2.5-flash" in data["statuses"]
    assert data["statuses"]["gemini-2.5-flash"]["status"] == "healthy"
    assert data["statuses"]["gemini-2.5-flash"]["latency_ms"] == 310

    # 2. Check /api/models includes status & latency
    res_models = client.get("/api/models")
    assert res_models.status_code == 200
    models = res_models.json()["models"]
    flash = next((m for m in models if m["model"] == "gemini-2.5-flash"), None)
    if flash:
        assert flash["status"] == "healthy"
        assert flash["latency_ms"] == 310
