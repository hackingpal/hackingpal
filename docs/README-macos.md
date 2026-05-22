# MyHackingPal on macOS

This is the macOS-specific install + gotchas guide. For the tool catalogue,
configuration, safety model, and dev loop, see the [root README](../README.md).

> **Status:** shipping. Apple Silicon (`arm64`) only for now — Intel build
> not yet produced.

---

## Install

Download `MyHackingPal-mac-arm64.zip` from [Releases](https://github.com/myhackingpal/myhackingpal/releases),
unzip, and drag `MyHackingPal.app` to `/Applications` (or keep it on
`~/Desktop`).

```sh
# Or from source:
cd frontend
npm run dist:dir
cp -R dist-electron/mac-arm64/MyHackingPal.app /Applications/
```

---

## First launch (Gatekeeper)

The build is **not** code-signed or notarized. On first launch macOS will
refuse to open it. Either:

```sh
# Strip the quarantine attribute:
xattr -dr com.apple.quarantine /Applications/MyHackingPal.app
```

Or right-click → **Open** → confirm in the Gatekeeper dialog (one-time).

---

## Privileged tools (sudoers drop-ins)

`tcpdump` and `nmap` SYN/UDP/OS scans need root. The app installs one-shot
sudoers entries via an `osascript` admin prompt the first time you use each
tool. Files are written to `/etc/sudoers.d/network-tools-<tool>` owned by
`root:wheel`. Endpoints: `POST /tcpdump/install`, `POST /nmap/install`.

To revoke later:

```sh
sudo rm /etc/sudoers.d/network-tools-tcpdump /etc/sudoers.d/network-tools-nmap
```

---

## API key storage

Anthropic + paid-API keys live in the **macOS Keychain** under service
`MyHackingPal`. Nothing is written to disk.

```sh
security find-generic-password -s MyHackingPal -a anthropic_api_key
```

---

## Mac-only tools

These pages are available on macOS only and auto-hide on other platforms:

- **WiFi Integrity** — CoreWLAN
- **VPN Manager** — WireGuard via `wg-quick`
- **Brew** — Homebrew search/install
- **macOS Posture** — SIP / Gatekeeper / FileVault / XProtect
- **Persistence** — LaunchAgents / LaunchDaemons audit

---

## Known gotchas

- After upgrading the app, run `xattr -dr com.apple.quarantine …` again — the
  attribute reappears on every fresh download.
- The bundled sidecar is an `arm64` binary. On Intel Macs it will fail to
  spawn; use the Docker option from the root README until an Intel build is
  produced.
