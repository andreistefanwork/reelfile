# Reelfile

[Open the downloader](https://verdant-delta-4cyx.here.now/). Paste a single public media link, choose video, audio, or transcript, and save the finished files. **Try a sample** loads a Blender trailer for media or a captioned Wikimedia Commons video for subtitles.

The interface runs on here.now. Its proxy authenticates requests to the [Render Free service](https://dashboard.render.com/web/srv-dc25cm6k1f9s738gmdp0), where yt-dlp and FFmpeg prepare each download. YouTube can refuse requests from the hosted server. Downloads use the temporary disk space and outbound bandwidth available to the service. One conversion runs at a time. Download links expire after 10 minutes and on service restarts.

## Download options

- Video exports support MP4, MKV, and WebM. Choose the resolution and frame-rate ceiling, video codec, audio codec, preferred audio language, or mute. The exporter copies compatible streams when possible and uses FFmpeg for requested conversions. A quality ceiling preserves smaller source dimensions.
- Audio exports support MP3, M4A, Opus, WAV, and FLAC, with bitrate selection for lossy formats.
- Captions can be embedded in video, saved as a sidecar, or downloaded on their own as SRT, WebVTT, or plain text. Choose a language and creator or automatic tracks. Transcripts use existing captions. Wikimedia Commons timed text is available for files with published tracks.
- Clip either media or captions by start and end time. The app requests sections from YouTube and Vimeo. Direct media files are cut after download. Clip subtitles and chapters use the exported timeline.
- Metadata, chapters in supported containers, and a separate cover image are optional. The results show which requested extras were available.

## Local development

Install Node.js 22 or newer, yt-dlp with its default dependencies, and FFmpeg (including ffprobe). Run `node server.mjs` and open [the local interface](http://127.0.0.1:3781). Local mode binds to loopback.

## Deployment

Render builds the Dockerfile from the repository’s main branch and checks `/health`. Push backend changes to main. Publish the contents of `web/` to update the existing here.now site with slug `verdant-delta-4cyx`.

The here.now account variable referenced in `web/.herenow/proxy.json` is restricted to `reelfile.onrender.com`. Render checks its SHA-256 digest against `proxy-key.sha256`. To rotate the credential, generate a new high-entropy token, deploy its hash, then update the scoped here.now variable. Keep the token out of Git.
