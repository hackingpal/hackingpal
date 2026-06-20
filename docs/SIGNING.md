# Code signing — current state + what would change it

HackingPal currently ships **unsigned** binaries on macOS and Windows.
This file is the honest accounting of what that means, why the project
isn't signed, and what would have to happen to fix it.

> tl;dr: signing isn't free. Apple wants $99/year + a real device for
> notarization; Windows code-signing certs from OV CAs run $200-400/year
> and EV certs (which skip SmartScreen reputation entirely) are more.
> Until someone wants to foot that bill, downloads will keep tripping
> Gatekeeper and SmartScreen warnings. The Linux AppImage and `.deb`
> aren't affected — Linux distros don't gate on publisher signatures.

---

## What "unsigned" means in practice

### macOS

- First-launch shows "HackingPal cannot be opened because the developer
  cannot be verified" or "HackingPal is damaged and can't be opened".
- Workaround for the user: right-click the `.app` → **Open** → confirm
  the Gatekeeper dialog (once). Or strip the quarantine attribute:
  `xattr -dr com.apple.quarantine /Applications/HackingPal.app`.
- electron-updater **detects** new releases but **cannot apply them** —
  macOS refuses to replace an unsigned app via the standard updater
  flow. Users have to re-download the DMG.

### Windows

- NSIS installer triggers SmartScreen ("Windows protected your PC —
  Microsoft Defender SmartScreen prevented an unrecognized app from
  starting"). User has to click **More info** → **Run anyway**.
- Reputation accumulates over time; once enough machines have run the
  installer without it being flagged as malicious, SmartScreen quiets
  down. An **EV** code-signing certificate (not OV) skips this entirely
  by inheriting trust from the CA.
- electron-updater works fine on Windows even unsigned (NSIS just
  replaces the install on next launch).

### Linux

- AppImage / `.deb` / `.rpm` don't require a publisher signature to run.
  Some distros' "Software" GUIs may warn about unsigned `.deb` but it
  installs fine via `apt install ./HackingPal-*.deb`.

---

## What signing would actually take

### macOS (signed + notarized)

1. Apple Developer Program membership: **$99/year**.
2. Generate a "Developer ID Application" certificate in Xcode or the
   Apple Developer portal; export as a `.p12`.
3. Add three GitHub Actions secrets:
   - `MAC_CSC_LINK`: base64-encoded `.p12`
   - `MAC_CSC_KEY_PASSWORD`: the `.p12` export password
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for
     notarization (Apple-issued app-specific password from your Apple
     ID account).
4. Update `package.json` `build.mac`:
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Name (TEAMID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist",
     "notarize": { "teamId": "TEAMID" }
   }
   ```
5. Update CI to remove `CSC_IDENTITY_AUTO_DISCOVERY=false` and pass the
   secrets through to electron-builder.

After all of that, the DMG installs cleanly, Gatekeeper shuts up, and
electron-updater can actually replace the running app.

### Windows (signed NSIS)

1. Buy a code-signing certificate. OV is the cheap path
   (~$200-400/year from Sectigo, DigiCert, SSL.com, etc.) and still
   triggers SmartScreen until reputation builds. **EV** is the only
   way to skip SmartScreen — it requires a hardware token shipped to
   you, and runs $400-600+/year.
2. Add GitHub Actions secrets:
   - `WIN_CSC_LINK`: base64-encoded `.pfx`
   - `WIN_CSC_KEY_PASSWORD`: the `.pfx` export password
3. electron-builder picks these up automatically from `CSC_LINK` /
   `CSC_KEY_PASSWORD` env vars — no `package.json` changes needed.
4. EV signing in CI is harder because of the hardware-token requirement;
   you'd typically sign locally on a machine with the token plugged in
   and upload the signed installer manually, or use a remote signing
   service (Azure Key Vault, etc.).

### Linux

Nothing to do; signatures aren't part of the user-trust model for app
downloads on Linux. The `.deb` could be GPG-signed for repo
distribution (apt's `Release.gpg`) but that's only relevant if hosting
an apt repo, not for direct downloads.

---

## What's wired up regardless

These are already in place and work for unsigned builds too:

- **electron-updater** against GitHub Releases — installed apps check
  for new releases every 6 hours (and 10s after launch). On Win/Linux
  it auto-downloads + installs on next quit. On Mac it logs that an
  update is available; the user has to re-download manually.
- **`latest.yml` / `latest-mac.yml` / `latest-linux.yml`** are produced
  by electron-builder and attached to every tagged release by CI —
  electron-updater reads these to know what version is current.
- **DMG for Mac** in addition to the zipped `.app` folder — most users
  want the DMG; the zip stays for tooling that can't mount.
- **`.deb` for x64 + arm64** in the build config (CI currently only
  builds arm64 AppImage; enabling arm64 `.deb` needs a CI matrix tweak
  + verification that fpm-on-arm64-runner works).
