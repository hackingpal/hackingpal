#!/bin/bash
set -e

DISPLAY_NUM=":99"
VNC_PORT=5900
NOVNC_PORT=6080
RESOLUTION="${RESOLUTION:-1280x800}"

echo "[nmap-gui] Starting virtual display ${RESOLUTION}..."
Xvfb "$DISPLAY_NUM" -screen 0 "${RESOLUTION}x24" -nolisten tcp &
XVFB_PID=$!
export DISPLAY="$DISPLAY_NUM"

# Wait for Xvfb to be ready
for i in $(seq 1 20); do
    xdpyinfo -display "$DISPLAY_NUM" >/dev/null 2>&1 && break
    sleep 0.2
done

echo "[nmap-gui] Starting VNC server on :${VNC_PORT}..."
x11vnc \
    -display "$DISPLAY_NUM" \
    -nopw \
    -listen 0.0.0.0 \
    -port "$VNC_PORT" \
    -xkb \
    -forever \
    -shared \
    -bg \
    -quiet

echo "[nmap-gui] Starting noVNC on :${NOVNC_PORT}..."
websockify \
    --web=/usr/share/novnc \
    --wrap-mode=ignore \
    "$NOVNC_PORT" \
    "localhost:${VNC_PORT}" &

echo ""
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │  Nmap Scanner GUI                                    │"
echo "  │  Open in browser:  http://<proxmox-ip>:${NOVNC_PORT}/vnc.html  │"
echo "  │  VNC direct:       <proxmox-ip>:${VNC_PORT}                 │"
echo "  └─────────────────────────────────────────────────────┘"
echo ""

# Launch GUI — container exits when the window is closed
exec python3 /app/nmap_gui.py
