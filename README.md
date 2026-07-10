# Intro Skipper (Chrome Extension)

A Chrome extension that automatically skips the intro of YouTube videos, but **only for the channels you configure**. For example, start playback at second 14 automatically, only for the channels you've added.

## File Structure

- `manifest.json` — extension configuration (Manifest V3)
- `content.js` — content script that runs on youtube.com pages, detects the channel name and seeks the video
- `popup.html` / `popup.css` / `popup.js` — the settings popup (click the extension icon to open)
- `scripts/package.sh` — packages the required files into a `.zip` for uploading to the Chrome Web Store
- `docs/` — a small landing page for the project (e.g. for GitHub Pages), not part of the extension itself

## Packaging a .zip for the Chrome Web Store

```sh
./scripts/package.sh
```

This produces `dist/intro-skipper-v<version>.zip` (the version is read from `manifest.json`). The zip only contains the files the extension actually needs at runtime (it excludes `docs/`, `README.md`, `.git`, etc.). Upload that file directly to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Installation (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `/Users/team/project/teampat/intro-skipper`
5. "Intro Skipper" will appear in the list and be enabled automatically
6. Pin the icon to the toolbar (click the puzzle-piece icon → pin) for easy access to settings

## Configuration

1. Click the extension icon to open the popup
2. Turn on the toggle in the top right to **enable** the extension
3. Set **"Skip to second (default)"**, e.g. `14` — this value applies to every configured channel
4. Add the channels whose intro you want to skip:
   - Type the channel name in the "Channel name" field, matching the name shown under the video (case-insensitive)
   - Or open a video from that channel on YouTube and click **"Use Current Channel"** to grab the name automatically
   - Click **"Add"**
5. Added channels appear in the list below. You can toggle them on/off or click ✕ to remove them instantly (auto-saved)
6. Open a video from a configured channel — playback will jump to the configured second automatically

## How It Works

- `content.js` is injected into every `youtube.com` page.
- It listens for the video's native `play` event (autoplay or the user pressing play), plus a fallback check on YouTube's SPA navigation (`yt-navigate-finish`) and a periodic interval, since YouTube doesn't do full page reloads between videos.
- For each video, it tries to detect the channel name from the page (with several selector fallbacks for YouTube's different layouts) and compares it against your configured list (case-insensitive).
- **Non-configured channels are left completely untouched** — the extension never pauses or interferes with their playback.
- Once a configured channel is confirmed, it pauses the video (if it's playing), seeks to the configured second, and resumes playback automatically — so you don't have to manually skip anything.
- All settings are stored with `chrome.storage.sync`, so they sync across machines signed into the same Chrome account.

## Notes

- The channel name must match exactly what's shown on the YouTube page (using the "Use Current Channel" button is the most reliable way).
- If the configured skip time is longer than the video's duration, the extension won't seek (to avoid jumping straight to the end).
- After changing the code, go back to `chrome://extensions` and click **Reload (⟳)** on this extension's card.

