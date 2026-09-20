# The perception service, for a host that runs a long-lived process (Render, Fly, a laptop).
# Vercel can't serve it: /ws/frames is a persistent socket and the description worker outlives
# a request. Build from the repo root: docker build -f services/perception/Dockerfile .
FROM python:3.12-slim

# uv resolves from uv.lock, the same versions the tests run against.
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /usr/local/bin/uv

WORKDIR /srv

# Dependencies first, so a code change doesn't reinstall them.
COPY services/perception/pyproject.toml services/perception/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY services/perception/app ./app

ENV PATH="/srv/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# The host's port, and 0.0.0.0 so the container is reachable from outside it.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
