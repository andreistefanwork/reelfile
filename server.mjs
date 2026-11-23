import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { canonicalSource } from './sources.mjs';

const host = process.env.HOST || '127.0.0.1';
const local = host === '127.0.0.1';
const keyHash = local ? null : Buffer.from(readFileSync(new URL('./proxy-key.sha256', import.meta.url), 'utf8').trim(), 'hex');
if (!local && keyHash.length !== 32) throw new Error('Missing proxy key hash');
const limit = 50_000_000;
const retainMs = 10 * 60_000;
const jobs = new Map();
const starts = [];
const run = promisify(execFile);

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function input(req) {
  let body = '';
  for await (const bytes of req) {
    body += bytes.toString();
    if (Buffer.byteLength(body) > 4096) throw Error('Request is too large.');
  }
  return JSON.parse(body);
}

function expiredJobs() {
  for (const [id, job] of jobs) {
    if (job.ends && job.ends <= Date.now()) {
      rmSync(job.dir, { recursive: true, force: true });
      jobs.delete(id);
    }
  }
}

function sourceError(output) {
  if (/confirm you.?re not a bot|bot detection|blocked.*IP|HTTP Error 429|sign in to confirm/i.test(output))
    return 'The video site blocked this server. Try a different source or try again later.';
  if (/private video|unavailable|not available|not found|HTTP Error 404|password|log in|login required/i.test(output))
    return 'This video is unavailable to the server. Try a public video link.';
  if (/HTTP Error 403/i.test(output)) return 'The source refused this download. Try another video.';
  if (/format is not available|no video formats|no audio/i.test(output)) return 'The source has no downloadable track for that format.';
  return 'The source could not be downloaded. Try a different public video.';
}

async function convert(job, source) {
  const options = ['--ignore-config', '--no-cache-dir', '--no-playlist', '--no-colors', '--newline',
    '--js-runtimes', 'node', '--socket-timeout', '18', '--retries', '1', '--fragment-retries', '1',
    '--max-filesize', String(limit), '--match-filters', '!is_live & duration<=?600',
    '--progress', '--progress-delta', '1', '--progress-template', 'download:PROGRESS:%(progress._percent_str)s',
    '--print', 'before_dl:TITLE:%(title)j', '--no-simulate', '-o', 'media.%(ext)s'];
  if (job.format === 'mp3') {
    options.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '160K');
  } else {
    options.push('-f', 'bv[height<=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=?720]',
      '--merge-output-format', 'mp4', '--recode-video', 'mp4');
  }
  const child = spawn('yt-dlp', [...options, '--', source], { cwd: job.dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  let stopped = '';
  const started = Date.now();
  function stop(reason) {
    stopped = reason;
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const watch = setInterval(() => {
    if (Date.now() - started > 360_000) return stop('This download timed out. Try a shorter video.');
    const bytes = readdirSync(job.dir).reduce((sum, name) => sum + (statSync(join(job.dir, name), { throwIfNoEntry: false })?.size || 0), 0);
    if (bytes > limit * 3) stop('The source is too large for this service.');
  }, 1000);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (line.startsWith('TITLE:')) {
      try { job.title = JSON.parse(line.slice(6)); } catch { /* Missing optional title. */ }
    } else if (line.startsWith('PROGRESS:')) {
      const percent = parseFloat(line.slice(9));
      job.message = Number.isFinite(percent) && percent < 100 ? 'Downloading a media track · ' + Math.round(percent) + '%' : 'Preparing your file…';
    } else diagnostic = (diagnostic + '\n' + line).slice(-5000);
  });
  child.stderr.setEncoding('utf8').on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-5000); });
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (stopped) throw Error(stopped);
    if (code !== 0) throw Error(sourceError(diagnostic));
    const stat = statSync(job.file, { throwIfNoEntry: false });
    if (!stat || stat.size === 0 || stat.size > limit) throw Error('The file exceeds the limits, is live, or has no matching track. Try a shorter clip.');
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', job.file], { timeout: 10000 });
    const probe = JSON.parse(stdout);
    const duration = Number(probe.format.duration);
    if (!(duration > 0 && duration <= 600)) throw Error('Choose a clip up to 10 minutes long.');
    if (!probe.streams.some(stream => stream.codec_type === (job.format === 'mp3' ? 'audio' : 'video'))) throw Error('This source has no track for that format.');
    job.size = stat.size;
    job.status = 'ready';
    job.message = 'Your file is ready.';
  } catch (error) {
    job.status = 'error';
    job.message = /^(This |The |Choose )/.test(error.message) ? error.message : 'The conversion failed. Try another clip.';
    rmSync(job.dir, { recursive: true, force: true });
  } finally {
    clearInterval(watch);
    lines.close();
    job.ends = Date.now() + retainMs;
  }
}

const assets = new Map([['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']]]);
const server = http.createServer(async (req, res) => {
  try {
    const path = (req.url || '').split('?')[0];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && path === '/health') return json(res, 200, { status: 'ok' });
    if (local && req.method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return res.end(readFileSync(new URL('./web/' + file, import.meta.url)));
    }
    if (!local && !timingSafeEqual(createHash('sha256').update(String(req.headers['x-reelfile-key'] || '')).digest(), keyHash))
      return json(res, 403, { error: 'Open the app to start a download.' });
    if (req.method === 'POST' && path === '/api/jobs') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, {error: 'Send JSON.'});
      let payload;
      try { payload = await input(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
      const source = canonicalSource(payload?.url);
      if (!source || !['mp4', 'mp3'].includes(payload?.format)) return json(res, 400, { error: 'Enter a YouTube, Vimeo, or Wikimedia Commons media link and choose MP4 or MP3.' });
      expiredJobs();
      while (starts.length && starts[0] < Date.now() - 3600000) starts.shift();
      if (starts.length >= 25 || jobs.size >= 15 || [...jobs.values()].some(j => j.status === 'working'))
        return json(res, 429, { error: 'The downloader is busy. Please try again later.' });
      const id = randomBytes(24).toString('hex');
      const dir = mkdtempSync(join(tmpdir(), 'reelfile-'));
      const job = { dir, file: join(dir, 'media.' + payload.format), format: payload.format, status: 'working', message: 'Reading the source…' };
      jobs.set(id, job);
      starts.push(Date.now());
      void convert(job, source);
      return json(res, 202, { id });
    }
    const match = /^\/api\/jobs\/([a-f0-9]{48})(\/file)?$/.exec(path);
    const job = match && jobs.get(match[1]);
    if (req.method !== 'GET' || !job || (job.ends && job.ends <= Date.now())) return json(res, 404, { error: 'This download has expired or the server restarted. Please start again.' });
    if (!match[2]) return json(res, 200, { status: job.status, message: job.message, title: job.title, format: job.format, size: job.size });
    if (job.status !== 'ready') return json(res, 409, { error: 'The file is not ready.' });
    const filename = String(job.title || 'download').slice(0, 100).replace(/[^a-z0-9 _.-]/gi, '_').trim() || 'download';
    const stream = createReadStream(job.file);
    stream.once('error', () => res.destroy());
    res.writeHead(200, { 'Content-Type': job.format === 'mp4' ? 'video/mp4' : 'audio/mpeg',
      'Content-Length': job.size, 'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="' + filename + '.' + job.format + '"' });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch {
    if (res.headersSent) return res.destroy();
    json(res, 500, { error: 'The server could not complete this request.' });
  }
});
setInterval(expiredJobs, 30_000).unref();
server.listen(Number(process.env.PORT || 3781), host, () => console.log('Reelfile listening on ' + host + ':' + server.address().port));
