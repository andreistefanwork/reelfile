import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { download } from './download.mjs';
import { settings, mime } from './media-options.mjs';
import { canonicalSource } from './sources.mjs';

const host = process.env.HOST || '127.0.0.1';
const local = host === '127.0.0.1';
const keyHash = local ? null : Buffer.from(readFileSync(new URL('./proxy-key.sha256', import.meta.url), 'utf8').trim(), 'hex');
if (!local && keyHash.length !== 32) throw new Error('Missing proxy key hash');
const retainMs = 10 * 60_000;
const jobs = new Map();
const starts = [];

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

async function convert(job, source) {
  try {
    await download(job, source);
    job.status = 'ready';
    job.message = 'Your download is ready.';
  } catch (error) {
    job.status = 'error';
    job.message = /^(This |The |No |FFmpeg )/.test(error.message) ? error.message : 'The conversion failed. Try another source or different settings.';
    rmSync(job.dir, { recursive: true, force: true });
    job.files = {};
  } finally { job.ends = Date.now() + retainMs; }
}

const assets = new Map([['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']]]);
for (const file of ['app.js','catalog.mjs','local-command.mjs','source-url.mjs','media-options.mjs','extraction.mjs']) {
  assets.set('/' + file,[file,'text/javascript']);
}
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
      if (!source) return json(res, 400, { error: 'Use a supported public media link.' });
      let options;
      try { options = settings(payload); } catch (err) { return json(res, 400, {error: err.message}); }
      expiredJobs();
      while (starts.length && starts[0] < Date.now() - 3600000) starts.shift();
      if (starts.length >= 25 || jobs.size >= 15 || [...jobs.values()].some(j => j.status === 'working'))
        return json(res, 429, { error: 'The downloader is busy. Please try again later.' });
      const id = randomBytes(24).toString('hex');
      const dir = mkdtempSync(join(tmpdir(), 'reelfile-'));
      const job = { dir, options, files: {}, notes: [], status: 'working', message: 'Reading the source…' };
      jobs.set(id, job);
      starts.push(Date.now());
      void convert(job, source);
      return json(res, 202, { id });
    }
    const match = /^\/api\/jobs\/([a-f0-9]{48})(?:\/(file|captions|thumbnail))?$/.exec(path);
    const job = match && jobs.get(match[1]);
    if (req.method !== 'GET' || !job || (job.ends && job.ends <= Date.now())) return json(res, 404, { error: 'This download has expired or the server restarted. Please start again.' });
    const files = Object.fromEntries(Object.entries(job.files).map(([key, f]) => [key,{format:f.format,size:f.size}]));
    if (!match[2]) return json(res, 200, { status: job.status, message: job.message, title: job.title,
      format: job.options.format, size: files.file?.size, files, notes: job.notes });
    if (job.status !== 'ready') return json(res, 409, { error: 'The file is not ready.' });
    const output = job.files[match[2]];
    if (!output) return json(res,404,{error:'This download has no such file.'});
    const filename = String(job.title || 'download').slice(0, 100).replace(/[^a-z0-9 _.-]/gi, '_').trim() || 'download';
    const stream = createReadStream(output.file);
    stream.once('error', () => res.destroy());
    res.writeHead(200, { 'Content-Type': mime[output.format],
      'Content-Length': output.size, 'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="' + filename + '.' + output.format + '"' });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch {
    if (res.headersSent) return res.destroy();
    json(res, 500, { error: 'The server could not complete this request.' });
  }
});
setInterval(expiredJobs, 30_000).unref();
server.listen(Number(process.env.PORT || 3781), host, () => console.log('Reelfile listening on ' + host + ':' + server.address().port));
