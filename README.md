# Reelfile

[Open the downloader](https://verdant-delta-4cyx.here.now/). Paste a single public media link, choose video, audio, or transcript, and save the finished files. **Try a sample** loads a Blender trailer for media or a captioned Wikimedia Commons video for subtitles.

The interface runs on here.now. Its proxy authenticates requests to the [Render Free service](https://dashboard.render.com/web/srv-dc25cm6k1f9s738gmdp0), where yt-dlp and FFmpeg prepare each download. YouTube can refuse requests from the hosted server. Downloads use the temporary disk space and outbound bandwidth available to the service. One conversion runs at a time. Download links expire after 10 minutes and on service restarts.

## Download options

- Video exports support MP4, MKV, and WebM. Choose the resolution and frame-rate ceiling, video codec, audio codec, preferred audio language, or mute. The exporter copies compatible streams when possible and uses FFmpeg for requested conversions. A quality ceiling preserves smaller source dimensions.
- Audio exports support MP3, M4A, Opus, WAV, and FLAC, with bitrate selection for lossy formats.
- Captions can be embedded in video, saved as a sidecar, or downloaded on their own as SRT, WebVTT, or plain text. Choose English or Romanian. **Prefer creator captions** tries a creator track first, then a matching automatic track offered by the source. If neither is available, media downloads continue without captions and transcript-only requests report the missing track. Media downloads also continue when the source rate-limits the caption request (HTTP 429). Reelfile selects one matching track. A caption HTTP 429 triggers up to three retries with 30-, 60-, and 120-second backoff and up to 10% jitter. A longer Retry-After takes precedence. If the requested wait exceeds the remaining ten-minute backoff budget, Reelfile reports the cooldown. The web page and local finisher show retry progress. Media-level verification challenges and permission errors are handled separately. Transcripts use existing captions. Wikimedia Commons timed text is available for files with published tracks.
- Clip either media or captions by start and end time. The app requests sections from YouTube and Vimeo. Direct media files are cut after download. Clip subtitles and chapters use the exported timeline.
- Metadata, chapters in supported containers, and a separate cover image are optional. The results show which requested extras were available.

## Copy a terminal command

Configure the download, choose **macOS / Linux** or **Windows Command Prompt (CMD)**, then click **Copy terminal command**. Paste the command directly into the selected terminal in the directory where you want the files. It creates a fresh Reelfile folder for each run.

Command generation happens in the browser and works while the Render service is unavailable. Install yt-dlp, FFmpeg and ffprobe, and Node.js 22 or later with npm on the computer running the command. The block runs yt-dlp locally and uses npm to retrieve a dependency-free finishing tool pinned to a commit in this public repository. That tool uses the same export code as the server for codec conversion, clip timing, chapters, metadata, and captions. Commons transcript-only jobs fetch the site's caption track directly. Source availability and installed encoder versions can affect the results.

When updating the export pipeline, pin the command generator to the matching public helper revision and run the terminal-command tests.

## Local development

Install Node.js 22 or newer, yt-dlp with its default dependencies, and FFmpeg (including ffprobe). Run `node server.mjs` and open [the local interface](http://127.0.0.1:3781). Local mode binds to loopback.

## Deployment

Render builds the Dockerfile from the repository’s main branch and checks `/health`. Push backend changes to main. Publish the contents of `web/` to update the existing here.now site with slug `verdant-delta-4cyx`.

The here.now account variable referenced in `web/.herenow/proxy.json` is restricted to `reelfile.onrender.com`. Render checks its SHA-256 digest against `proxy-key.sha256`. To rotate the credential, generate a new high-entropy token, deploy its hash, then update the scoped here.now variable. Keep the token out of Git.
