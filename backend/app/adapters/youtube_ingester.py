"""Adapter for ingesting YouTube videos, talks, and lectures via transcripts and oEmbed metadata."""

import logging
import re
import uuid
from typing import Optional, Any
import httpx

from app.core.models import SourceDocument
from app.ports.audio_transcriber import AudioTranscriberPort

logger = logging.getLogger(__name__)

YOUTUBE_URL_PATTERN = re.compile(
    r"^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})",
    re.IGNORECASE
)


class YouTubeIngester:
    """Ingests YouTube videos using public oEmbed metadata and timestamped transcripts."""

    def __init__(
        self,
        http_timeout: float = 15.0,
        audio_transcriber: Optional[AudioTranscriberPort] = None,
    ):
        self.http_timeout = http_timeout
        self.audio_transcriber = audio_transcriber

    def is_youtube_url(self, url: str) -> bool:
        """Determines if a given URL or string matches a supported YouTube video pattern."""
        if not url:
            return False
        return bool(YOUTUBE_URL_PATTERN.search(url.strip()))

    def extract_video_id(self, url: str) -> Optional[str]:
        """Extracts the canonical 11-character video ID from any YouTube URL format."""
        if not url:
            return None
        match = YOUTUBE_URL_PATTERN.search(url.strip())
        return match.group(1) if match else None

    def _format_timestamp(self, seconds: float) -> str:
        """Formats seconds into MM:SS or HH:MM:SS."""
        total_secs = max(0, int(seconds))
        hours = total_secs // 3600
        mins = (total_secs % 3600) // 60
        secs = total_secs % 60
        if hours > 0:
            return f"{hours:02d}:{mins:02d}:{secs:02d}"
        return f"{mins:02d}:{secs:02d}"

    def fetch_metadata(self, video_id: str) -> dict[str, Any]:
        """
        Retrieves video metadata (title, author, thumbnail) using the official public oEmbed API.
        No Google API key required.
        """
        target_url = f"https://www.youtube.com/watch?v={video_id}"
        oembed_url = f"https://www.youtube.com/oembed?url={target_url}&format=json"

        try:
            with httpx.Client(timeout=self.http_timeout, follow_redirects=True) as client:
                resp = client.get(oembed_url)
                if resp.status_code == 200:
                    data = resp.json()
                    return {
                        "title": data.get("title") or f"YouTube Video ({video_id})",
                        "author_name": data.get("author_name") or "YouTube Channel",
                        "author_url": data.get("author_url") or "",
                        "thumbnail_url": data.get("thumbnail_url") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                        "video_id": video_id,
                        "video_url": target_url,
                    }
        except Exception as e:
            logger.warning(f"Could not fetch oEmbed metadata for YouTube video {video_id}: {e}")

        # Fallback metadata if oEmbed is unavailable
        return {
            "title": f"YouTube Video ({video_id})",
            "author_name": "YouTube",
            "author_url": "",
            "thumbnail_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "video_id": video_id,
            "video_url": target_url,
        }

    def fetch_transcript(
        self,
        video_id: str,
        preferred_languages: Optional[list[str]] = None
    ) -> tuple[list[dict], str, bool]:
        """
        Fetches timestamped transcript snippets via youtube-transcript-api.
        Returns (snippets, language_code, is_generated).
        """
        from youtube_transcript_api import YouTubeTranscriptApi
        import youtube_transcript_api._errors as yt_errors

        langs = preferred_languages or ["es", "es-419", "en"]

        try:
            api = YouTubeTranscriptApi()
            transcript_list = api.list(video_id)

            chosen_transcript = None
            # 1. Try manually created transcript in preferred languages
            try:
                chosen_transcript = transcript_list.find_manually_created_transcript(langs)
            except Exception:
                pass

            # 2. Try auto-generated transcript in preferred languages
            if not chosen_transcript:
                try:
                    chosen_transcript = transcript_list.find_generated_transcript(langs)
                except Exception:
                    pass

            # 3. Try any available transcript in preferred languages
            if not chosen_transcript:
                try:
                    chosen_transcript = transcript_list.find_transcript(langs)
                except Exception:
                    pass

            # 4. Fallback to the very first available transcript
            if not chosen_transcript:
                for t in transcript_list:
                    chosen_transcript = t
                    break

            if not chosen_transcript:
                raise ValueError(f"No transcript found for video {video_id}")

            fetched = chosen_transcript.fetch()
            if hasattr(fetched, "to_raw_data"):
                raw_entries = fetched.to_raw_data()
            elif isinstance(fetched, list):
                raw_entries = fetched
            else:
                raw_entries = list(fetched)

            lang = getattr(chosen_transcript, "language_code", "unknown")
            is_gen = getattr(chosen_transcript, "is_generated", False)

            return raw_entries, lang, is_gen

        except (yt_errors.TranscriptsDisabled, yt_errors.NoTranscriptFound) as e:
            logger.warning(f"Transcripts disabled or missing for YouTube video {video_id}: {e}")
            raise ValueError(
                f"El video de YouTube ({video_id}) no tiene subtítulos ni transcripciones públicas habilitadas."
            ) from e
        except Exception as e:
            logger.error(f"Error retrieving transcripts for {video_id}: {e}")
            raise ValueError(
                f"No se pudo obtener la transcripción del video ({video_id}): {str(e)}"
            ) from e

    def format_transcript_to_markdown(
        self,
        metadata: dict[str, Any],
        transcript_entries: list[dict],
        language: str = "es",
        is_generated: bool = False,
    ) -> str:
        """
        Groups granular transcript snippets into cohesive chronological paragraphs
        with timestamp anchors and periodic section headings for optimal chunking.
        """
        title = metadata.get("title", "Video de YouTube")
        channel = metadata.get("author_name", "Desconocido")
        channel_url = metadata.get("author_url", "")
        video_url = metadata.get("video_url", "")
        thumbnail_url = metadata.get("thumbnail_url", "")

        # Compute total duration from entries
        total_duration_secs = 0.0
        if transcript_entries:
            last = transcript_entries[-1]
            total_duration_secs = float(last.get("start", 0)) + float(last.get("duration", 0))

        duration_label = self._format_timestamp(total_duration_secs)
        gen_label = "(Generados automáticamente)" if is_generated else "(Subtítulos verificados)"

        lines = [
            f"# {title}",
            "",
            f"- **Canal / Expositor**: [{channel}]({channel_url})" if channel_url else f"- **Canal / Expositor**: {channel}",
            f"- **Video Original**: [{video_url}]({video_url})",
            f"- **Idioma**: `{language}` {gen_label}",
            f"- **Duración**: `{duration_label}`",
            "",
            f"![Miniatura de Video]({thumbnail_url})" if thumbnail_url else "",
            "",
            "---",
            "",
            "## Transcripción Estructurada",
            ""
        ]

        if not transcript_entries:
            lines.append("*(No se encontraron fragmentos de texto en la transcripción)*")
            return "\n".join(lines)

        current_paragraph_texts = []
        current_paragraph_start = float(transcript_entries[0].get("start", 0.0))
        last_heading_time = -300.0  # Force heading on first block

        for entry in transcript_entries:
            start = float(entry.get("start", 0.0))
            text = (entry.get("text") or "").strip()
            if not text:
                continue

            # Heading break every 5 minutes (300 seconds)
            if start - last_heading_time >= 300.0:
                # Flush existing paragraph first
                if current_paragraph_texts:
                    ts_str = self._format_timestamp(current_paragraph_start)
                    p_body = " ".join(current_paragraph_texts)
                    lines.append(f"**[{ts_str}]** {p_body}\n")
                    current_paragraph_texts = []

                header_ts = self._format_timestamp(start)
                lines.append(f"\n### [{header_ts}] Minuto {header_ts}\n")
                last_heading_time = start
                current_paragraph_start = start

            # Accumulate into paragraph
            current_paragraph_texts.append(text)
            accumulated_len = sum(len(t) for t in current_paragraph_texts)

            # Flush paragraph when ~30-45 seconds elapsed or ~300 characters reached
            if (start - current_paragraph_start >= 35.0) or (accumulated_len >= 350):
                ts_str = self._format_timestamp(current_paragraph_start)
                p_body = " ".join(current_paragraph_texts)
                lines.append(f"**[{ts_str}]** {p_body}\n")
                current_paragraph_texts = []
                current_paragraph_start = start + float(entry.get("duration", 0.0))

        # Flush final trailing paragraph
        if current_paragraph_texts:
            ts_str = self._format_timestamp(current_paragraph_start)
            p_body = " ".join(current_paragraph_texts)
            lines.append(f"**[{ts_str}]** {p_body}\n")

        return "\n".join(lines)

    def _download_audio_stream(self, video_id: str) -> bytes:
        """
        Downloads the lightweight audio-only stream of a YouTube video using yt-dlp.
        Returns the raw audio bytes without requiring ffmpeg.exe installed.
        """
        import os
        import tempfile
        import yt_dlp

        temp_dir = tempfile.mkdtemp(prefix="yt_audio_")
        target_template = os.path.join(temp_dir, f"{video_id}.%(ext)s")
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": target_template,
            "quiet": True,
            "no_warnings": True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
                downloaded_file = ydl.prepare_filename(info)
                with open(downloaded_file, "rb") as f_in:
                    return f_in.read()
        finally:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)

    def ingest(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None
    ) -> SourceDocument:
        """
        Full ingestion pipeline: extracts video ID, oEmbed metadata, transcripts,
        formats markdown and packages as a SourceDocument.
        Falls back to yt-dlp + ASR if subtitles are unavailable.
        """
        video_id = self.extract_video_id(url)
        if not video_id:
            raise ValueError(f"No se pudo identificar un ID de video de YouTube válido en '{url}'.")

        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
        metadata = self.fetch_metadata(video_id)

        transcript_entries = None
        language = "es"
        is_generated = False
        is_asr_fallback = False

        try:
            transcript_entries, language, is_generated = self.fetch_transcript(video_id)
        except ValueError as original_err:
            if not self.audio_transcriber:
                raise original_err

            logger.info("Subtítulos no disponibles para YouTube %s. Iniciando fallback con sherpa-onnx...", video_id)
            is_asr_fallback = True
            audio_bytes = self._download_audio_stream(video_id)
            asr_res = self.audio_transcriber.transcribe(audio_bytes)

            transcript_entries = [
                {
                    "start": seg.start_seconds,
                    "duration": max(0.1, seg.end_seconds - seg.start_seconds),
                    "text": seg.text,
                }
                for seg in asr_res.segments
            ]
            language = asr_res.language
            is_generated = True

        raw_markdown = self.format_transcript_to_markdown(
            metadata=metadata,
            transcript_entries=transcript_entries,
            language=language,
            is_generated=is_generated
        )

        final_title = title_override or metadata.get("title") or f"YouTube {video_id}"

        # Calculate duration
        total_duration = 0
        if transcript_entries:
            last = transcript_entries[-1]
            total_duration = int(float(last.get("start", 0)) + float(last.get("duration", 0)))

        return SourceDocument(
            id=doc_id,
            filename=final_title,
            mime_type="text/markdown",
            raw_markdown=raw_markdown,
            char_count=len(raw_markdown),
            metadata={
                "is_youtube": True,
                "video_id": video_id,
                "video_url": f"https://www.youtube.com/watch?v={video_id}",
                "channel": metadata.get("author_name"),
                "author": metadata.get("author_name"),
                "channel_url": metadata.get("author_url"),
                "thumbnail_url": metadata.get("thumbnail_url"),
                "language": language,
                "is_generated_transcript": is_generated,
                "duration_seconds": total_duration,
                "source_url": f"https://www.youtube.com/watch?v={video_id}",
                "transcription_engine": "sherpa-onnx" if is_asr_fallback else "youtube-captions",
            }
        )
