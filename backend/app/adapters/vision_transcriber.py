"""Multimodal Vision Transcriber converting technical diagrams, charts, and figures to Markdown and Mermaid.js."""

import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

VISION_SYSTEM_PROMPT = (
    "Eres un asistente experto en análisis visual de documentos técnicos, científicos y de ingeniería. "
    "Tu tarea es transmutar esquemas, diagramas, gráficos de datos y capturas en representaciones textuales "
    "altamente estructuradas (código Mermaid.js, tablas Markdown o descripciones técnicas densas) "
    "para que puedan ser indexadas y citadas fielmente en un sistema RAG sin perder información."
)

VISION_USER_PROMPT = (
    "Analiza la siguiente figura o diagrama extraído del documento:\n\n"
    "1. Si es un DIAGRAMA DE FLUJO, ARQUITECTURA O SECUENCIA: genera el código exacto en Mermaid.js "
    "(fenced con ```mermaid ... ```) representando los nodos, componentes y relaciones. Luego explica brevemente el flujo.\n"
    "2. Si es un GRÁFICO DE DATOS (barras, curvas, dispersión, torta): extrae los ejes, variables y valores numéricos "
    "aproximados en una tabla Markdown (| Variable | Valor |).\n"
    "3. Si es un ESQUEMA TÉCNICO, CIRCUITO O PATCH: detalla cada etiqueta, conexión, parámetro y bloque funcional.\n\n"
    "Sé conciso, técnico y estrictamente fiel a lo que se ve en la imagen."
)


class VisionTranscriber:
    """Transcribes visual diagrams and figures into structured Markdown/Mermaid using a Vision-Language Model."""

    def __init__(self, llm_client: Optional[Any] = None, enabled: bool = True):
        self.llm_client = llm_client
        self.enabled = enabled

    def transcribe(
        self,
        image_bytes: bytes,
        page_number: int,
        figure_index: int,
        mime_type: str = "image/png"
    ) -> Optional[str]:
        """Transcribes image bytes into structured text with Mermaid diagrams or data tables."""
        if not self.enabled or not self.llm_client:
            return None

        try:
            raw_result = self.llm_client.generate_with_image(
                system_prompt=VISION_SYSTEM_PROMPT,
                user_prompt=VISION_USER_PROMPT,
                image_bytes=image_bytes,
                mime_type=mime_type,
            )
            if raw_result and not raw_result.startswith("Error al consultar"):
                return raw_result.strip()
            logger.warning("Vision transcription failed or returned error: %s", raw_result)
        except Exception as e:
            logger.warning("Failed to transcribe figure on page %d: %s", page_number, e)

        return None
