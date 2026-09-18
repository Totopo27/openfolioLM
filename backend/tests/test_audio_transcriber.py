"""Tests for audio decoding, transcription formatting, and YouTube ASR fallback."""

import io
import math
import struct
import wave
import pytest
import numpy as np
from unittest.mock import MagicMock, patch

from app.core.models import SourceDocument
from app.ports.audio_transcriber import AudioSegment, AudioTranscriptResult, AudioTranscriberPort


def _create_synthetic_wav_bytes(duration_sec: float = 1.0, sample_rate: int = 44100) -> bytes:
    """Generates a synthetic 440Hz sine wave WAV file in bytes."""
    buf = io.BytesIO()
    num_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        data = bytearray()
        for i in range(num_samples):
            val = int(32767.0 * 0.5 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
            data.extend(struct.pack("<h", val))
        wf.writeframes(data)
    return buf.getvalue()


class DummyTranscriber(AudioTranscriberPort):
    """Dummy transcriber for testing without downloading full ONNX models."""

    def __init__(self, segments: list[AudioSegment] | None = None):
        self.segments = segments or [
            AudioSegment(start_seconds=5.0, end_seconds=12.0, text="Introducción a la arquitectura de software."),
            AudioSegment(start_seconds=15.0, end_seconds=25.0, text="Los puertos y adaptadores garantizan bajo acoplamiento."),
            AudioSegment(start_seconds=310.0, end_seconds=325.0, text="Avanzamos al siguiente módulo del curso."),
        ]

    def transcribe(
        self,
        audio_input,
        progress_callback=None,
        language=None,
    ) -> AudioTranscriptResult:
        if progress_callback:
            progress_callback(50.0, "Transcribiendo audio de prueba...")
            progress_callback(100.0, "Completado")
        full_text = " ".join(s.text for s in self.segments)
        return AudioTranscriptResult(
            segments=self.segments,
            language=language or "es",
            duration_seconds=325.0,
            full_text=full_text,
        )


def test_audio_decoder_synthetic_wav(tmp_path):
    """Verifies that PyAV correctly decodes and resamples audio to 16kHz mono float32."""
    from app.adapters.audio_decoder import decode_audio_to_pcm

    wav_bytes = _create_synthetic_wav_bytes(duration_sec=1.5, sample_rate=44100)
    test_file = tmp_path / "test_synth.wav"
    test_file.write_bytes(wav_bytes)

    samples, duration = decode_audio_to_pcm(str(test_file), target_sr=16000)

    assert isinstance(samples, np.ndarray)
    assert samples.dtype == np.float32
    assert samples.ndim == 1
    # 1.5 seconds at 16kHz is ~24000 samples
    assert abs(len(samples) - 24000) < 500
    assert abs(duration - 1.5) < 0.1


def test_audio_ingester_format_markdown():
    """Verifies that AudioIngester formats segments into structured Markdown with timestamp anchors."""
    from app.adapters.audio_ingester import AudioIngester

    transcriber = DummyTranscriber()
    ingester = AudioIngester(transcriber=transcriber)

    metadata = {
        "filename": "clase_arquitectura.mp3",
        "duration_seconds": 325.0,
        "language": "es",
    }
    markdown = ingester.format_transcript_to_markdown(metadata, transcriber.segments)

    assert "# clase_arquitectura.mp3" in markdown
    assert "**[00:05]**" in markdown
    assert "Introducción a la arquitectura de software." in markdown
    assert "### [05:10] Minuto 05:10" in markdown
    assert "Avanzamos al siguiente módulo del curso." in markdown


def test_audio_ingester_convert(tmp_path):
    """Verifies AudioIngester converts an audio file into a SourceDocument with RAG metadata."""
    from app.adapters.audio_ingester import AudioIngester

    wav_bytes = _create_synthetic_wav_bytes(duration_sec=1.0)
    audio_file = tmp_path / "conferencia.mp3"
    audio_file.write_bytes(wav_bytes)

    transcriber = DummyTranscriber()
    ingester = AudioIngester(transcriber=transcriber)

    doc = ingester.convert(str(audio_file), filename="conferencia.mp3")

    assert isinstance(doc, SourceDocument)
    assert doc.mime_type == "audio/mpeg"
    assert doc.metadata.get("is_audio") is True
    assert doc.metadata.get("duration_seconds") == 325.0
    assert "Introducción a la arquitectura" in doc.raw_markdown


def test_youtube_ingester_fallback_with_asr():
    """Verifies YouTubeIngester falls back to yt-dlp + ASR when subtitles are disabled or missing."""
    from app.adapters.youtube_ingester import YouTubeIngester

    transcriber = DummyTranscriber()
    yt_ingester = YouTubeIngester(audio_transcriber=transcriber)

    # Mock fetch_metadata
    yt_ingester.fetch_metadata = MagicMock(return_value={
        "title": "Conferencia Magistral 2026",
        "author_name": "Dr. Smith",
        "author_url": "https://youtube.com/@drsmith",
        "thumbnail_url": "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg",
        "video_id": "abc12345678",
        "video_url": "https://www.youtube.com/watch?v=abc12345678",
    })

    # Mock fetch_transcript to raise ValueError (no subtitles)
    yt_ingester.fetch_transcript = MagicMock(side_effect=ValueError("No subtitles found"))

    # Mock _download_audio_stream to return synthetic WAV bytes
    fake_wav_bytes = _create_synthetic_wav_bytes(0.5)
    with patch.object(yt_ingester, "_download_audio_stream", return_value=fake_wav_bytes):
        doc = yt_ingester.ingest("https://www.youtube.com/watch?v=abc12345678")

    assert doc.metadata.get("is_youtube") is True
    assert doc.metadata.get("transcription_engine") == "sherpa-onnx"
    assert "Conferencia Magistral 2026" in doc.raw_markdown
    assert "Introducción a la arquitectura de software." in doc.raw_markdown
