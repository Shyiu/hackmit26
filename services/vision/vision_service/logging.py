from __future__ import annotations

import json
import logging
import logging.config
from datetime import datetime, timezone

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "vision_service.logging.JsonFormatter",
        },
    },
    "handlers": {
        "json": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "stream": "ext://sys.stdout",
        },
    },
    "root": {
        "handlers": ["json"],
        "level": "INFO",
    },
    "loggers": {
        "uvicorn": {
            "handlers": [],
            "level": "INFO",
            "propagate": True,
        },
        "uvicorn.error": {
            "handlers": [],
            "level": "INFO",
            "propagate": True,
        },
        "uvicorn.access": {
            "handlers": [],
            "level": "INFO",
            "propagate": True,
        },
    },
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in logging.LogRecord(None, 0, "", 0, "", (), None).__dict__:
                try:
                    json.dumps(value)
                    data[key] = value
                except (TypeError, ValueError):
                    data[key] = str(value)
        return json.dumps(data, separators=(",", ":"))


def configure(level: str = "INFO") -> None:
    config = {
        **LOGGING_CONFIG,
        "root": {**LOGGING_CONFIG["root"], "level": level.upper()},
        "loggers": {
            name: {**logger_config, "level": level.upper()}
            for name, logger_config in LOGGING_CONFIG["loggers"].items()
        },
    }
    logging.config.dictConfig(config)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
