# Contributing to MyHackingPal

Thanks for your interest. This file collects the conventions, setup,
and per-area notes contributors need before submitting a PR.

Please also read [DISCLAIMER.md](DISCLAIMER.md) and [SECURITY.md](SECURITY.md)
before sending anything offensive-tooling related.

## Mobile (Flutter)

### Contributing to the Android app

The mobile app lives in `mobile/`. It's a Flutter project targeting
Android 7+ (minSdk 24).

Requirements:
- Flutter 3.x SDK
- Android Studio or VS Code with Flutter extension
- An Android device or emulator

Setup:

```sh
cd mobile
flutter pub get
flutter run
```

The app connects to the backend over Tailscale by default. Change the
base URL in Settings to point at your dev backend
(`http://<your-ip>:8765`).

To add a new tool to the mobile app:

1. Add a new screen in `mobile/lib/screens/`
2. Use the existing `ApiService` in `mobile/lib/services/api_service.dart`
   for HTTP calls
3. Add the route to `mobile/lib/main.dart`
4. Add an entry to the tools list in `mobile/lib/screens/home_screen.dart`
