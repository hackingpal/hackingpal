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
RUN pip install -r /tmp/requirements-bundle.txt \
    && pip install \
        anthropic>=0.92 \
        boto3>=1.34 \
        azure-identity>=1.15 \
        azure-mgmt-resource>=23 \
        azure-mgmt-storage>=21 \
        azure-mgmt-compute>=30 \
        azure-mgmt-network>=25 \
        azure-mgmt-keyvault>=10 \
        google-cloud-resource-manager>=1.12 \
        google-cloud-storage>=2.14 \
        google-cloud-compute>=1.16 \
        ldap3>=2.9 \
        impacket>=0.12 \
        bloodhound>=1.7

COPY . /app

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8765/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", "--port", "8765", \
     "--log-level", "warning", \
     "--loop", "asyncio", "--http", "h11", "--ws", "wsproto"]
