import httpx
from typing import Optional


class OpenAICompatibleLLMClient:
    """Client for any OpenAI-compatible LLM endpoint (Ollama, DeepSeek, OpenAI, etc.)."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434/v1",
        api_key: str = "ollama",
        model: str = "gemini-3.5-flash",
        timeout: float = 60.0,
        fallback_models: Optional[list[str]] = None
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.fallback_models = fallback_models or []

    def generate(self, system_prompt: str, user_prompt: str, model_override: Optional[str] = None) -> str:
        active_model = model_override or self.model
        models_to_try = [active_model] + [m for m in self.fallback_models if m != active_model]
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        last_error = ""
        for mod in models_to_try:
            payload = {
                "model": mod,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.0  # Zero temperature for deterministic grounding
            }

            try:
                with httpx.Client(timeout=self.timeout) as client:
                    resp = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        return data["choices"][0]["message"]["content"]
                    
                    # If 429 or 404, capture error and try next model
                    last_error = f"HTTP {resp.status_code} on model {mod}: {resp.text[:200]}"
                    if resp.status_code in (429, 404):
                        continue
                    resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                last_error = f"HTTP error {e.response.status_code}: {e.response.text[:200]}"
                continue
            except Exception as e:
                last_error = f"Connection error: {str(e)}"
                continue

        # If all candidates exhausted, return clear diagnostic
        return f"Error al consultar el proveedor de IA: {last_error}"
