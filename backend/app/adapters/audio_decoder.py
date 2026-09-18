"""Universal audio decoder using PyAV to convert audio/video to 16kHz mono PCM float32."""

import io
import logging
from typing import Union
import av
import numpy as np

logger = logging.getLogger(__name__)


def decode_audio_to_pcm(
    audio_source: Union[str, bytes],
    target_sr: int = 16000,
) -> tuple[np.ndarray, float]:
    """
    Decodes any audio or video container (.mp3, .wav, .m4a, .ogg, .flac, .mp4, .webm, etc.)
    and resamples it into a 1D float32 NumPy array at `target_sr` Hz mono.

    Returns:
        tuple (pcm_samples, duration_seconds)
    """
    if isinstance(audio_source, bytes):
        input_container = io.BytesIO(audio_source)
    else:
        input_container = audio_source

    container = av.open(input_container)
    audio_stream = next((s for s in container.streams if s.type == "audio"), None)

    if not audio_stream:
        raise ValueError("No se encontró ninguna pista de audio válida en el archivo.")

    resampler = av.AudioResampler(
        format="flt",  # float32 (-1.0 to 1.0)
        layout="mono",
        rate=target_sr,
    )

    chunks: list[np.ndarray] = []
    total_samples = 0

    for frame in container.decode(audio_stream):
        for resampled_frame in resampler.resample(frame):
            # to_ndarray returns shape (channels, samples) -> (1, N)
            arr = resampled_frame.to_ndarray()[0]
            chunks.append(arr)
            total_samples += len(arr)

    # Flush resampler buffer if any
    for resampled_frame in resampler.resample(None):
        arr = resampled_frame.to_ndarray()[0]
        chunks.append(arr)
        total_samples += len(arr)

    container.close()

    if not chunks:
        return np.array([], dtype=np.float32), 0.0

    pcm_samples = np.concatenate(chunks).astype(np.float32)
    duration_seconds = float(len(pcm_samples)) / float(target_sr)

    return pcm_samples, duration_seconds
