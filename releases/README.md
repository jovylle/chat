# Android release (AAB for Google Play)

One-time build for the Play Store. Put your signed AAB here so it lives in this repo.

## Where to get the AAB

**Option A – PWA Builder (easiest)**  
1. Open [pwabuilder.com](https://www.pwabuilder.com/) → enter `https://chat.uft1.com`.  
2. **Package for stores** → **Android** → complete the flow.  
3. Download the zip. Inside you’ll find something like `app-release-bundle.aab` (or in a subfolder).  
4. Copy that `.aab` file into this folder: `releases/`.

**Option B – Bubblewrap (local build)**  
1. `npm i -g @bubblewrap/cli` then `bubblewrap init` (manifest URL: `https://chat.uft1.com/manifest.webmanifest`).  
2. Run `bubblewrap build` in the generated project.  
3. The AAB is in that project’s output (e.g. `app-release-bundle.aab`). Copy it into this folder: `releases/`.

Then upload the AAB from here (or from wherever you saved it) in [Play Console](https://play.google.com/console) → your app → Production → Create new release.
