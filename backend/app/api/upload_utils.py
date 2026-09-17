import os

from fastapi import HTTPException, UploadFile

from app.core.config import settings


MAX_UPLOAD_BYTES = settings.max_upload_size_mb * 1024 * 1024
UPLOAD_READ_CHUNK_BYTES = 1024 * 1024


async def save_upload_with_limit(file: UploadFile, destination: str) -> None:
    """Stream an upload to disk while enforcing the configured finite limit."""
    total_bytes = 0
    try:
        with open(destination, "wb") as output:
            while chunk := await file.read(UPLOAD_READ_CHUNK_BYTES):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Upload exceeds the {settings.max_upload_size_mb} MB limit"
                        ),
                    )
                output.write(chunk)
    except Exception:
        if os.path.exists(destination):
            os.remove(destination)
        raise
