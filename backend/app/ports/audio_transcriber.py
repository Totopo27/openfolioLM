"""Port definition for audio transcription and speech recognition engines."""

from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol, Union
import numpy as np


@dataclass
class AudioSegment:
    """A segment of transcribed speech with timestamp boundaries."""
    start_seconds: float
    end_seconds: float
    text: str
    speaker: Optional[str] = None


@dataclass
class AudioTranscriptResult:
    """Full transcription result with timestamps and metadata."""
    segments: list[AudioSegment] = field(default_factory=list)
    language: str = "es"
    duration_seconds: float = 0.0
    full_text: str = ""


class AudioTranscriberPort(Protocol):
    """Protocol for offline or online Speech-To-Text transcribers."""

    def transcribe(
        self,
        audio_input: Union[str, np.ndarray],
        progress_callback: Optional[Callable[[float, str], None]] = None,
        language: Optional[str] = None,
    ) -> AudioTranscriptResult:
        """
        Transcribe an audio file or raw 16kHz mono float32 PCM numpy array.
        Calls progress_callback(percentage_float, status_message) if provided.
        """
        ...
