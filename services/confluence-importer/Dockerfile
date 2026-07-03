# Multi-stage build for the confluence-importer Python service.
# Build context MUST be the repo root (see docker-compose.yml).

# Stage 1: resolve and install dependencies with uv
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

COPY services/confluence-importer/pyproject.toml services/confluence-importer/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY services/confluence-importer/src ./src
COPY services/confluence-importer/README.md ./
# --no-editable: the runtime stage copies only /app/.venv, so the project must
# be installed into site-packages instead of a .pth pointing at /app/src.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# Pre-download the tiktoken encoding so the runtime works without egress to OpenAI CDN.
ENV TIKTOKEN_CACHE_DIR=/app/.tiktoken_cache
RUN /app/.venv/bin/python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"

# Stage 2: minimal runtime image, non-root
FROM python:3.13-slim-bookworm AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --no-create-home app

COPY --from=build --chown=app:app /app/.venv /app/.venv
COPY --from=build --chown=app:app /app/.tiktoken_cache /app/.tiktoken_cache

ENV PATH="/app/.venv/bin:$PATH" \
    TIKTOKEN_CACHE_DIR=/app/.tiktoken_cache \
    PYTHONUNBUFFERED=1

USER app
ENTRYPOINT ["confluence-importer"]
CMD ["run"]
