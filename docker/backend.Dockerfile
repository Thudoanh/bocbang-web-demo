FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# FFmpeg includes ffprobe. DejaVu supplies the Unicode font used by PDF exports.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /data/media \
    && chown app:app /data/media

WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY alembic ./alembic
RUN python -m pip install .

USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
