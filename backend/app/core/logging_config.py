import os
import logging
from logging.handlers import RotatingFileHandler
from app.core.config import settings

logger = logging.getLogger("openfolio")


def setup_logging() -> str:
    """Configures centralized root logging to file (data/openfolio.log) and console."""
    log_dir = settings.data_dir
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "openfolio.log")

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Check if a RotatingFileHandler is already registered
    has_file_handler = any(isinstance(h, RotatingFileHandler) for h in root_logger.handlers)
    if not has_file_handler:
        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=5 * 1024 * 1024,  # 5 MB
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setLevel(logging.INFO)
        file_formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] [%(name)s]: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)

    # Also attach file handler to uvicorn loggers so access and error logs appear in openfolio.log
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        u_log = logging.getLogger(uvicorn_logger_name)
        if not any(isinstance(h, RotatingFileHandler) for h in u_log.handlers):
            u_log.addHandler(file_handler)

    # Check if a StreamHandler is registered
    has_stream_handler = any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in root_logger.handlers
    )
    if not has_stream_handler:
        stream_handler = logging.StreamHandler()
        stream_handler.setLevel(logging.INFO)
        stream_formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] [%(name)s]: %(message)s",
            datefmt="%H:%M:%S"
        )
        stream_handler.setFormatter(stream_formatter)
        root_logger.addHandler(stream_handler)

    logger.info("Logging initialized. Target log file: %s", os.path.abspath(log_file))
    return log_file
