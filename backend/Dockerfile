FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl gpiod && rm -rf /var/lib/apt/lists/*

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .
RUN pip install --no-cache-dir \
    "alembic>=1.13.2" \
    "fastapi>=0.115.0" \
    "httpx>=0.27.0" \
    "psycopg[binary]>=3.2.1" \
    "pydantic>=2.8.2" \
    "pydantic-settings>=2.4.0" \
    "python-json-logger>=2.0.7" \
    "sqlalchemy>=2.0.32" \
    "uvicorn[standard]>=0.30.6"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
