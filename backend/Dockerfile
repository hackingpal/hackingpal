FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NT_BACKEND_HOST=0.0.0.0 \
    NT_BACKEND_PORT=8765

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dnsutils \
        iproute2 \
        iputils-ping \
        lsof \
        net-tools \
        nmap \
        openssl \
        tcpdump \
        traceroute \
        whois \
        wireguard-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-bundle.txt /tmp/requirements-bundle.txt
RUN pip install -r /tmp/requirements-bundle.txt

COPY . /app

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8765/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", "--port", "8765", \
     "--log-level", "warning", \
     "--loop", "asyncio", "--http", "h11", "--ws", "wsproto"]
