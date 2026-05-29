FROM python:3.12-slim-bookworm

# ── System dependencies ────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # nmap
    nmap \
    # GUI stack
    python3-tk \
    tk \
    xvfb \
    x11vnc \
    # noVNC + websockify
    novnc \
    websockify \
    # Fonts (customtkinter needs these)
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ────────────────────────────────────────────────────────
RUN pip install --no-cache-dir customtkinter

# ── App ────────────────────────────────────────────────────────────────────────
WORKDIR /app
COPY nmap_gui.py .

# ── Entrypoint ─────────────────────────────────────────────────────────────────
COPY start.sh /start.sh
RUN chmod +x /start.sh

# VNC: 5900  |  noVNC web: 6080
EXPOSE 5900 6080

ENTRYPOINT ["/start.sh"]
