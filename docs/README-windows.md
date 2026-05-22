# MyHackingPal on Windows

This is the Windows-specific install + gotchas guide. For the tool catalogue,
configuration, safety model, and dev loop, see the [root README](../README.md).

> **Status:** in progress. CI matrix builds a sidecar `.exe`; electron-builder
> Windows config exists in `frontend/package.json`. Authenticode signing not
> yet set up, so first-launch SmartScreen warnings are expected.

---

## Install

*(Coming soon — once CI produces a signed `.exe` installer.)*

Planned download: `MyHackingPal-win-x64.exe` from [Releases](https://github.com/myhackingpal/myhackingpal/releases).

Until then, build from source — see the root README's
[Development](../README.md#development) section. PyInstaller can only build
for the OS it runs on, so the Windows sidecar must be built on Windows.

---

## First launch (SmartScreen)

Until the installer is Authenticode-signed, Windows Defender SmartScreen will
warn "Windows protected your PC". Click **More info** → **Run anyway**
(one-time).

---

## Privileged tools

Windows doesn't have `sudo` or sudoers — privileged scans rely on the OS
permission model instead.

| Tool        | Windows path                                                              |
| ----------- | ------------------------------------------------------------------------- |
| `nmap` SYN / UDP / OS | Requires [Npcap](https://npcap.com/) (install separately). Run the app **as Administrator** for raw-socket access. |
| `tcpdump`   | Mapped to `pktmon` (built-in, Windows 10 1809+) or Wireshark's `dumpcap`. |
| `wireguard` | Not applicable — the VPN Manager page is hidden on Windows.               |

---

## API key storage

Anthropic + paid-API keys live in **Windows Credential Manager** (accessed
via the Python `keyring` package, which uses the Win32 `vault` backend).

```powershell
# Inspect from PowerShell:
cmdkey /list:MyHackingPal
```

---

## Tools hidden on Windows

These macOS-only pages auto-hide via `GET /system/info`:

- WiFi Integrity, VPN Manager, Brew, macOS Posture, Persistence

A Windows-equivalent **Persistence Audit** (Run keys, Scheduled Tasks,
Services) is planned but not yet implemented.

---

## Known gotchas

- **Long paths** — Electron's app dir can exceed 260 chars when combined with
  the PyInstaller `_internal/` tree. Enable Win32 long paths if you see
  spawn errors: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.
- **Defender quarantine** — the unsigned sidecar `.exe` can be quarantined.
  Add the install directory to Defender's exclusions until the build is signed.
- **Npcap loopback** — `nmap` against `127.0.0.1` requires the "support
  loopback traffic" option during Npcap install.
