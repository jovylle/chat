# Android release (AAB for Google Play)

Put your signed AAB (or APK) here so it lives in this repo.

## Current releases (Capacitor shell — **not TWA**)

Releases in this folder from the **`capacitor-shell`** branch are **Capacitor WebView** builds, **not** TWA (Trusted Web Activity). They are built with `./gradlew bundleRelease` (or `assembleRelease`) in `android/`, then aligned and signed. Name bundles e.g. `chat-assistant-box-1.4.aab` and note the version in the main README.

- **v1.4** (Capacitor, non-TWA) — *add `chat-assistant-box-1.4.aab` after building and signing*

## TWA / PWA Builder options (alternative store packages)

**Option A – PWA Builder (easiest)**  
1. Open [pwabuilder.com](https://www.pwabuilder.com/) → enter `https://chat.uft1.com`.  
2. **Package for stores** → **Android** → complete the flow.  
3. Download the zip. Inside you’ll find something like `app-release-bundle.aab` (or in a subfolder).  
4. Copy that `.aab` file into this folder: `releases/`. Name it so it’s clear it’s a TWA build (e.g. `chat-assistant-box-1.4-twa.aab`).

**Option B – Bubblewrap (local TWA build)**  
1. `npm i -g @bubblewrap/cli` then `bubblewrap init` (manifest URL: `https://chat.uft1.com/manifest.webmanifest`).  
2. Run `bubblewrap build` in the generated project.  
3. The AAB is in that project’s output (e.g. `app-release-bundle.aab`). Copy it into this folder: `releases/`.

Then upload the AAB from here (or from wherever you saved it) in [Play Console](https://play.google.com/console) → your app → Production → Create new release.
