"""Settings, read from the environment or from services/perception/.env."""

from __future__ import annotations

import os
import socket

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def default_worker_id() -> str:
    # Unique per process, so two workers on one host never share a job lease.
    return f"{socket.gethostname()}-{os.getpid()}"[:100]


class TokenSettings(BaseSettings):
    """The part minting a local token needs, without a database."""

    # An empty line in .env, like WORKER_ID=, means "use the default", not "use an empty string".
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    device_token_secret: str = Field(min_length=32, repr=False)


class Settings(TokenSettings):
    # Carries credentials on Atlas, so it stays out of reprs and logs.
    mongodb_uri: str = Field(repr=False)
    mongodb_db: str = "memory_glasses"
    # For the description worker. Unused until M1.
    openai_api_key: str | None = Field(default=None, repr=False)
    # The lease owner written on claimed description jobs. The schema caps it at 100 characters.
    worker_id: str = Field(default_factory=default_worker_id, min_length=1, max_length=100)
