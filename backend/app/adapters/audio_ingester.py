"""Adapter for ingesting heterogeneous audio and video recordings into structured Markdown."""

import logging
import mimetypes
import os
import uuid
from typing import Any, Callable, Optional

from app.core.models import SourceDocument
from app.ports.audio_transcriber import AudioSegment, AudioTranscriptResult, AudioTranscriberPort
from app.ports.ingester import IngestionPort

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".opus",
    ".mp4", ".webm", ".mkv", ".mov"
}


class AudioIngester(IngestionPort):
    """
    Ingests local audio and video files (lectures, voice notes, interviews),
    transcribes them using an AudioTranscriberPort (e.g. sherpa-onnx), and formats
    the output into chronologically structured Markdown with timestamp anchors.
    """

    def __init__(self, transcriber: Optional[AudioTranscriberPort] = None):
        self.transcriber = transcriber

    def is_audio_file(self, filename: str) -> bool:
        """Returns True if the filename has an audio or video extension."""
        if not filename:
            return False
        ext = os.path.splitext(filename)[1].lower()
        return ext in AUDIO_EXTENSIONS

    def _format_timestamp(self, seconds: float) -> str:
        """Formats seconds into MM:SS or HH:MM:SS."""
        total_secs = max(0, int(seconds))
        hours = total_secs // 3600
        mins = (total_secs % 3600) // 60
        secs = total_secs % 60
        if hours > 0:
            return f"{hours:02d}:{mins:02d}:{secs:02d}"
        return f"{mins:02d}:{secs:02d}"

    def format_transcript_to_markdown(
        self,
        metadata: dict[str, Any],
        segments: list[AudioSegment],
    ) -> str:
        """
        Groups granular audio segments into cohesive chronological paragraphs
        with timestamp anchors and periodic section headings for optimal RAG chunking.
        """
        title = metadata.get("title") or metadata.get("filename") or "Grabación de Audio"
        duration_sec = float(metadata.get("duration_seconds", 0.0))
        duration_label = self._format_timestamp(duration_sec)
        lang = metadata.get("language", "es")

        lines = [
            f"# {title}",
            "",
            "- **Tipo**: Grabación de Audio / Multimedia",
            f"- **Duración**: `{duration_label}`",
            f"- **Idioma detectado**: `{lang}`",
            "",
            "---",
            "",
            "## Transcripción Estructurada",
            "",
        ]

        if not segments:
            lines.append("*(No se detectaron fragmentos de voz comprensibles en el audio)*")
            return "\n".join(lines)

        current_paragraph_texts: list[str] = []
        current_paragraph_start = float(segments[0].start_seconds)
        last_heading_time = -300.0  # Force heading on first block

        for seg in segments:
            start = float(seg.start_seconds)
            text = (seg.text or "").strip()
            if not text:
                continue

            # Heading break every 5 minutes (300 seconds)
            if start - last_heading_time >= 300.0:
                if current_paragraph_texts:
                    ts_str = self._format_timestamp(current_paragraph_start)
                    p_body = " ".join(current_paragraph_texts)
                    lines.append(f"**[{ts_str}]** {p_body}\n")
                    current_paragraph_texts = []

                header_ts = self._format_timestamp(start)
                lines.append(f"\n### [{header_ts}] Minuto {header_ts}\n")
                last_heading_time = start
                current_paragraph_start = start

            current_paragraph_texts.append(text)
            accumulated_len = sum(len(t) for t in current_paragraph_texts)

            # Flush paragraph when ~35 seconds elapsed or ~350 characters reached
            if (start - current_paragraph_start >= 35.0) or (accumulated_len >= 350):
                ts_str = self._format_timestamp(current_paragraph_start)
                p_body = " ".join(current_paragraph_texts)
                lines.append(f"**[{ts_str}]** {p_body}\n")
                current_paragraph_texts = []
                current_paragraph_start = float(seg.end_seconds)

        if current_paragraph_texts:
            ts_str = self._format_timestamp(current_paragraph_start)
            p_body = " ".join(current_paragraph_texts)
            lines.append(f"**[{ts_str}]** {p_body}\n")

        return "\n".join(lines)

    def convert(
        self,
        file_path: str,
        filename: str,
        source_id: Optional[str] = None,
        vision_transcriber: Optional[Any] = None,
        progress_callback: Optional[Callable[[float, str], None]] = None,
    ) -> SourceDocument:
        """
        Converts an audio or video file to a SourceDocument using the active transcriber.
        """
        if not self.transcriber:
            raise RuntimeError("AudioIngester requiere un AudioTranscriberPort configurado.")

        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
        logger.info("Transcribiendo archivo de audio '%s' (id=%s)...", filename, doc_id)

        result: AudioTranscriptResult = self.transcriber.transcribe(
            file_path,
            progress_callback=progress_callback,
        )

        metadata = {
            "filename": filename,
            "duration_seconds": result.duration_seconds,
            "language": result.language,
        }

        raw_markdown = self.format_transcript_to_markdown(metadata, result.segments)
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type or not (mime_type.startswith("audio/") or mime_type.startswith("video/")):
            mime_type = "audio/mpeg"

        return SourceDocument(
            id=doc_id,
            filename=filename,
            mime_type=mime_type,
            raw_markdown=raw_markdown,
            char_count=len(raw_markdown),
            metadata={
                "is_audio": True,
                "duration_seconds": result.duration_seconds,
                "language": result.language,
                "segments_count": len(result.segments),
                "transcription_engine": "sherpa-onnx",
            },
        )

    def ingest_url(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None,
    ) -> SourceDocument:
        raise NotImplementedError("AudioIngester procesa archivos locales. Para URLs de YouTube use YouTubeIngester.")
