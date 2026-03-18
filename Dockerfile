FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENABLE_SCHEDULER=false

WORKDIR /opt/render/project/src

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg ffmpeg build-essential \
        pkg-config libcairo2-dev \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY ui/package*.json ./ui/
COPY api/package*.json ./api/
RUN cd ui && npm ci
RUN cd api && npm ci --production

COPY . .
RUN cd ui && npm run build

CMD ["sh", "-c", "python main.py run --host 0.0.0.0 --port ${PORT:-8000}"]
