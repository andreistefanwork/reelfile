# Reelfile

[Open the downloader](https://verdant-delta-4cyx.here.now/). Paste a single public media link, choose MP4 or MP3, and save the finished file. **Try a sample** loads the [Blender Foundation’s Big Buck Bunny trailer](https://peach.blender.org/2008/03/trailer/).

The interface runs on here.now. Its proxy authenticates requests to the [Render Free service](https://dashboard.render.com/web/srv-dc25cm6k1f9s738gmdp0), where yt-dlp and FFmpeg prepare each download. YouTube can refuse requests from the hosted server. Files can be up to 50 MB and 10 minutes long. One conversion runs at a time. Download links expire after 10 minutes and on service restarts.

## Local development

Install Node.js 22 or newer, yt-dlp with its default dependencies, and FFmpeg (including ffprobe). Run `node server.mjs` and open [the local interface](http://127.0.0.1:3781). Local mode binds to loopback.

## Deployment

Render builds the Dockerfile from the private repo’s main branch and checks `/health`. Push backend changes to main. Publish the contents of `web/` to update the existing here.now site with slug `verdant-delta-4cyx`.

The here.now account variable referenced in `web/.herenow/proxy.json` is restricted to `reelfile.onrender.com`. Render checks its SHA-256 digest against `proxy-key.sha256`. To rotate the credential, generate a new high-entropy token, deploy its hash, then update the scoped here.now variable. Keep the token out of Git.
