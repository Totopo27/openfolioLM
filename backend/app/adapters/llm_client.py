import base64
import time
import httpx
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Literal

ModelStatus = Literal["healthy", "high_demand", "offline", "unknown"]


@dataclass
class ModelHealthRecord:
    model: str
    provider: str = "gemini"
    status: ModelStatus = "unknown"
    latency_ms: Optional[int] = None
    last_error: Optional[str] = None
    last_checked: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    cooldown_until: float = 0.0

    def is_in_cooldown(self) -> bool:
        return time.time() < self.cooldown_until

    def to_dict(self) -> dict:
        current_status = "healthy" if (self.status == "high_demand" and not self.is_in_cooldown()) else self.status
        return {
            "model": self.model,
            "provider": self.provider,
            "status": current_status,
            "latency_ms": self.latency_ms,
            "last_error": self.last_error,
            "last_checked": self.last_checked.isoformat(),
            "in_cooldown": self.is_in_cooldown(),
        }


class ModelHealthRegistry:
    """In-memory singleton registry tracking real-time status, latency, and demand of AI models."""
    _instance: Optional["ModelHealthRegistry"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._records = {}
        return cls._instance

    def record_success(self, model: str, provider: str = "gemini", latency_ms: Optional[int] = None) -> None:
        rec = self._records.get(model)
        if not rec:
            rec = ModelHealthRecord(model=model, provider=provider)
            self._records[model] = rec
        rec.status = "healthy"
        rec.latency_ms = latency_ms
        rec.last_error = None
        rec.last_checked = datetime.now(timezone.utc)
        rec.cooldown_until = 0.0

    def record_high_demand(
        self,
        model: str,
        provider: str = "gemini",
        error_message: str = "",
        cooldown_seconds: float = 30.0
    ) -> None:
        rec = self._records.get(model)
        if not rec:
            rec = ModelHealthRecord(model=model, provider=provider)
            self._records[model] = rec
        rec.status = "high_demand"
        rec.last_error = error_message
        rec.last_checked = datetime.now(timezone.utc)
        rec.cooldown_until = time.time() + cooldown_seconds

    def record_offline(self, model: str, provider: str = "gemini", error_message: str = "") -> None:
        rec = self._records.get(model)
        if not rec:
            rec = ModelHealthRecord(model=model, provider=provider)
            self._records[model] = rec
        rec.status = "offline"
        rec.last_error = error_message
        rec.last_checked = datetime.now(timezone.utc)

    def get_status(self, model: str) -> ModelHealthRecord:
        rec = self._records.get(model)
        if not rec:
            return ModelHealthRecord(model=model, status="unknown")
        if rec.status == "high_demand" and not rec.is_in_cooldown():
            rec.status = "healthy"
        return rec

    def get_all(self) -> dict[str, ModelHealthRecord]:
        for rec in self._records.values():
            if rec.status == "high_demand" and not rec.is_in_cooldown():
                rec.status = "healthy"
        return dict(self._records)

    def clear(self) -> None:
        self._records.clear()


# Global health registry instance
health_registry = ModelHealthRegistry()


class OpenAICompatibleLLMClient:
    """Resilient client for OpenAI-compatible LLM endpoints with backoff retries and model fallbacks."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434/v1",
        api_key: str = "ollama",
        model: str = "gemini-2.5-flash",
        timeout: float = 60.0,
        fallback_models: Optional[list[str]] = None,
        provider_name: str = "gemini",
        max_retries: int = 2,
        retry_delay: float = 1.0,
    ):
        self.base_url = base_url.rstrip("/").replace("localhost", "127.0.0.1")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.fallback_models = fallback_models or []
        self.provider_name = provider_name
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.health_registry = health_registry

    def ping(self, model: Optional[str] = None) -> ModelHealthRecord:
        """Lightweight 1-token test to assess model latency and availability."""
        target_model = model or self.model
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": target_model,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "temperature": 0.0,
        }
        t0 = time.perf_counter()
        ping_timeout = 45.0 if self.provider_name == "ollama" else 8.0
        try:
            with httpx.Client(timeout=ping_timeout) as client:
                resp = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                latency_ms = int((time.perf_counter() - t0) * 1000)
                if resp.status_code == 200:
                    self.health_registry.record_success(target_model, self.provider_name, latency_ms)
                    return self.health_registry.get_status(target_model)
                if resp.status_code in (503, 429):
                    self.health_registry.record_high_demand(
                        target_model, self.provider_name, f"HTTP {resp.status_code}: {resp.text[:120]}"
                    )
                    return self.health_registry.get_status(target_model)
                self.health_registry.record_offline(
                    target_model, self.provider_name, f"HTTP {resp.status_code}: {resp.text[:120]}"
                )
                return self.health_registry.get_status(target_model)
        except httpx.TimeoutException:
            self.health_registry.record_offline(
                target_model, self.provider_name, f"Timeout: sin respuesta en {int(ping_timeout)}s"
            )
            return self.health_registry.get_status(target_model)
        except Exception as e:
            self.health_registry.record_offline(target_model, self.provider_name, str(e))
            return self.health_registry.get_status(target_model)

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model_override: Optional[str] = None
    ) -> str:
        active_model = model_override or self.model
        models_to_try = [active_model] + [m for m in self.fallback_models if m != active_model]
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        primary_error = ""
        fallbacks_attempted: list[tuple[str, str]] = []
        last_error = ""

        for idx, mod in enumerate(models_to_try):
            is_primary = (idx == 0)
            payload = {
                "model": mod,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.0,  # Zero temperature for deterministic grounding
            }

            mod_error = ""
            for attempt in range(self.max_retries + 1):
                t0 = time.perf_counter()
                try:
                    with httpx.Client(timeout=self.timeout) as client:
                        resp = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                        latency_ms = int((time.perf_counter() - t0) * 1000)

                        if resp.status_code == 200:
                            data = resp.json()
                            choices = data.get("choices") or []
                            if choices:
                                msg = choices[0].get("message") or {}
                                content = msg.get("content")
                                if content is not None:
                                    self.health_registry.record_success(mod, self.provider_name, latency_ms)
                                    return content
                            mod_error = f"Model {mod} returned empty choices or null content"
                            break

                        # Handle 503 (High Demand) and 429 (Rate Limit) with backoff retry
                        if resp.status_code in (503, 429):
                            mod_error = f"HTTP {resp.status_code} (Alta demanda / Cuota): {resp.text[:140]}"
                            self.health_registry.record_high_demand(mod, self.provider_name, mod_error)

                            if attempt < self.max_retries:
                                sleep_time = self.retry_delay * (2 ** attempt)
                                time.sleep(sleep_time)
                                continue
                            else:
                                # Retries on this model exhausted; break to fallback loop
                                break

                        # Handle 404 (Model not found/deprecated) or 401 (Auth error)
                        if resp.status_code in (404, 401):
                            mod_error = f"HTTP {resp.status_code}: {resp.text[:140]}"
                            self.health_registry.record_offline(mod, self.provider_name, mod_error)
                            break

                        resp.raise_for_status()

                except httpx.HTTPStatusError as e:
                    mod_error = f"HTTP {e.response.status_code}: {e.response.text[:140]}"
                    if e.response.status_code in (503, 429):
                        self.health_registry.record_high_demand(mod, self.provider_name, mod_error)
                        if attempt < self.max_retries:
                            time.sleep(self.retry_delay * (2 ** attempt))
                            continue
                    else:
                        self.health_registry.record_offline(mod, self.provider_name, mod_error)
                    break

                except httpx.TimeoutException:
                    mod_error = "Timeout: El servidor de IA no respondió a tiempo"
                    self.health_registry.record_offline(mod, self.provider_name, mod_error)
                    break

                except Exception as e:
                    mod_error = f"Connection error: {str(e)}"
                    self.health_registry.record_offline(mod, self.provider_name, mod_error)
                    break

            last_error = mod_error
            if is_primary:
                primary_error = mod_error
            else:
                fallbacks_attempted.append((mod, mod_error))

        # Build honest diagnostic report preserving the primary model failure
        if primary_error:
            if fallbacks_attempted:
                fb_details = "; ".join(f"{m} -> {err.splitlines()[0][:80]}" for m, err in fallbacks_attempted)
                return (
                    f"Error al consultar el proveedor de IA: El modelo seleccionado '{active_model}' falló: {primary_error}. "
                    f"Se intentaron los respaldos configurados pero también fallaron: [{fb_details}]"
                )
            return f"Error al consultar el proveedor de IA: El modelo seleccionado '{active_model}' falló: {primary_error}"

        return f"Error al consultar el proveedor de IA: {last_error}"

    def generate_with_image(
        self,
        system_prompt: str,
        user_prompt: str,
        image_bytes: bytes,
        mime_type: str = "image/png",
        model_override: Optional[str] = None
    ) -> str:
        b64_image = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{b64_image}"

        active_model = model_override or self.model
        models_to_try = [active_model] + [m for m in self.fallback_models if m != active_model]
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        last_error = ""

        for mod in models_to_try:
            payload = {
                "model": mod,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {"type": "image_url", "image_url": {"url": data_uri}},
                        ],
                    },
                ],
                "temperature": 0.0,
            }

            for attempt in range(self.max_retries + 1):
                t0 = time.perf_counter()
                try:
                    with httpx.Client(timeout=self.timeout) as client:
                        resp = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                        latency_ms = int((time.perf_counter() - t0) * 1000)

                        if resp.status_code == 200:
                            data = resp.json()
                            choices = data.get("choices") or []
                            if choices:
                                msg = choices[0].get("message") or {}
                                content = msg.get("content")
                                if content is not None:
                                    self.health_registry.record_success(mod, self.provider_name, latency_ms)
                                    return content
                            last_error = f"Model {mod} returned empty choices or null content"
                            break

                        if resp.status_code in (503, 429):
                            last_error = f"HTTP {resp.status_code} on model {mod}: {resp.text[:200]}"
                            self.health_registry.record_high_demand(mod, self.provider_name, last_error)
                            if attempt < self.max_retries:
                                sleep_time = self.retry_delay * (2 ** attempt)
                                time.sleep(sleep_time)
                                continue
                            break

                        if resp.status_code in (404, 401):
                            last_error = f"HTTP {resp.status_code} on model {mod}: {resp.text[:200]}"
                            self.health_registry.record_offline(mod, self.provider_name, last_error)
                            break

                        resp.raise_for_status()

                except httpx.HTTPStatusError as e:
                    last_error = f"HTTP error {e.response.status_code}: {e.response.text[:200]}"
                    if e.response.status_code in (503, 429):
                        self.health_registry.record_high_demand(mod, self.provider_name, last_error)
                        if attempt < self.max_retries:
                            time.sleep(self.retry_delay * (2 ** attempt))
                            continue
                    else:
                        self.health_registry.record_offline(mod, self.provider_name, last_error)
                    break

                except Exception as e:
                    last_error = f"Connection error: {str(e)}"
                    self.health_registry.record_offline(mod, self.provider_name, last_error)
                    break

        return f"Error al consultar modelo de visión: {last_error}"

