# HackingPal on Linux

This is the Linux-specific install + gotchas guide. For the tool catalogue,
configuration, safety model, and dev loop, see the [root README](../README.md).

> **Status:** in progress. CI matrix builds a sidecar binary; electron-builder
> Linux config exists in `frontend/package.json`. AppImage / `.deb` artefacts
> not yet uploaded to Releases. **Docker is the recommended option in the
> meantime** — see the root README.

---

## Install

*(Coming soon — once CI publishes an AppImage / `.deb`.)*

Planned downloads from [Releases](https://github.com/hackingpal/hackingpal/releases):

- `HackingPal-linux-x86_64.AppImage` — portable, no install
- `HackingPal-linux-amd64.deb` — Debian / Ubuntu

```sh
# AppImage:
chmod +x HackingPal-linux-x86_64.AppImage
./HackingPal-linux-x86_64.AppImage

# .deb:
sudo dpkg -i HackingPal-linux-amd64.deb
```

Until then, use [Docker](../README.md#option-2--docker) or build from source
— see the root README's [Development](../README.md#development) section.

---

## Privileged tools

Linux uses capabilities (preferred) or `sudo`, not sudoers drop-ins.

| Tool        | Linux path                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `tcpdump`   | `sudo setcap cap_net_raw,cap_net_admin=eip /usr/bin/tcpdump` (one-time). |
| `nmap` SYN / UDP / OS | `sudo setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip /usr/bin/nmap` |
| `wireguard` | `sudo apt install wireguard-tools` — VPN Manager uses `wg-quick @ wg0`.   |

The Docker image already grants `NET_RAW` + `NET_ADMIN` via `cap_add` in
`docker-compose.yml`, so no host-side `setcap` is needed there.

---

## API key storage

Anthropic + paid-API keys live in the **Secret Service** (GNOME Keyring /
KWallet) via the Python `keyring` package and `libsecret`.

```sh
# Inspect via secret-tool:
secret-tool search service HackingPal
```

If you're running headless (no D-Bus session), `keyring` falls back to an
encrypted file under `~/.local/share/python_keyring/`. To force the file
backend explicitly:

```sh
export PYTHON_KEYRING_BACKEND=keyrings.alt.file.PlaintextKeyring
```

---

## Tools hidden on Linux

These macOS-only pages auto-hide via `GET /system/info`:

- WiFi Integrity, Brew, macOS Posture, Persistence

A Linux-equivalent **Persistence Audit** (systemd units, cron, autostart
`.desktop` files) is planned but not yet implemented.

**VPN Manager** works on Linux as long as `wireguard-tools` is installed.

---

## Known gotchas

- **AppImage + FUSE** — Ubuntu 22.04+ ships without `libfuse2` by default.
  `sudo apt install libfuse2` if the AppImage refuses to mount.
- **Wayland** — Electron's default `--ozone-platform-hint=auto` works on
  most setups; if the window is blank, try `--ozone-platform=x11`.
- **`tcpdump` from inside the AppImage** — the bundled sidecar shells out to
  the system's `tcpdump`, which must have `cap_net_raw` set (see table above).
