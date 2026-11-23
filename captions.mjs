import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CaptionRequestError, withCaptionBackoff } from './caption-backoff.mjs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { captionLanguages } from './web/catalog.mjs';
import { commonsAgent } from './web/extraction.mjs';
import { join, resolve } from 'node:path';

const timing = /(\d{1,}):(\d{2}):(\d{2})[,.](\d{3})/g;
function milliseconds(match) {
  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}
function clock(ms, vtt) {
  const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0');
  return pad(ms / 3600000) + ':' + pad(ms / 60000 % 60) + ':' + pad(ms / 1000 % 60) + (vtt ? '.' : ',') + pad(ms % 1000, 3);
}

export function clippedCues(srt, start, end) {
  const from = Math.round(start * 1000);
  const until = end === null ? Infinity : Math.round(end * 1000);
  return srt.replace(/^\uFEFF/, '').replace(/\r/g,'').trim().split(/\n\s*\n/).flatMap(block => {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes(' --> '));
    if (index < 0) return [];
    const times = [...lines[index].matchAll(timing)];
    if (times.length !== 2) return [];
    const a = Math.max(from, milliseconds(times[0])) - from;
    const b = Math.min(until, milliseconds(times[1])) - from;
    const text = lines.slice(index + 1).join('\n').trim();
    return b > a && text ? [{ a, b, text }] : [];
  });
}

function plain(line) {
  return line.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g,
    (_, entity) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'"}[entity])).trim();
}

export function renderCues(cues, format) {
  if (format === 'txt') {
    const out = [];
    let previous = [];
    for (const cue of cues) {
      const lines = cue.text.split('\n').map(plain).filter(Boolean);
      let overlap = Math.min(previous.length, lines.length);
      while (overlap > 0 && previous.slice(-overlap).join('\n') !== lines.slice(0, overlap).join('\n')) overlap--;
      out.push(...lines.slice(overlap));
      previous = lines;
    }
    return out.join('\n') + '\n';
  }
  const vtt = format === 'vtt';
  const blocks = cues.map(({a,b,text}, i) => (vtt ? '' : (i + 1) + '\n') + clock(a, vtt) + ' --> ' + clock(b, vtt) + '\n' + text);
  return (vtt ? 'WEBVTT\n\n' : '') + blocks.join('\n\n') + '\n';
}

function captionLanguage(tags, o, creatorTracks) {
  const pattern = new RegExp('^' + o.subLang + '(?:-[A-Za-z]{2}|-[0-9]{3})?(?:-orig)?$');
  function rank(lang) {
    const automatic = o.subSource === 'prefer' && !Object.hasOwn(creatorTracks,lang);
    const variant = lang === o.subLang ? 0 : lang === o.subLang + '-orig' ? 1 : 2;
    return Number(automatic) * 3 + variant;
  }
  return tags.filter(tag => pattern.test(tag)).sort((a,b) => rank(a)-rank(b) || a.localeCompare(b))[0];
}

export function captionFile(files, o, creatorTracks = {}) {
  const tags = files.filter(f => f.startsWith('source.') && f.endsWith('.srt')).map(f => f.slice(7,-4));
  const lang = captionLanguage(tags,o,creatorTracks);
  return lang ? 'source.' + lang + '.srt' : undefined;
}

function captionError(o, limited, header) {
  return new CaptionRequestError(captionLanguages[o.subLang], o.type === 'text', limited, header);
}

// --print-traffic exposes the HTTP response headers, which yt-dlp omits from its
// normal warning. Retain only status/rate-limit data; never print or save the trace.
async function fetchWithYtDlp(args, cwd, o) {
  const child = spawn('yt-dlp', ['--print-traffic', ...args], {cwd, windowsHide:true, stdio:['ignore','pipe','pipe']});
  let limited = false;
  let failed = false;
  let retryAfter;
  const readers = [child.stdout,child.stderr].map(stream => {
    const reader = createInterface({input:stream});
    let status;
    reader.on('line', line => {
      const response = /^(?:reply:\s*['"]|(?:\[debug\]\s*)?<\s*)?HTTP\/[\d.]+\s+(\d{3})/i.exec(line);
      if (response) {
        status = Number(response[1]);
        if (status === 429) limited = true;
      } else if (status === 429) {
        const header = /^(?:header:\s*|(?:\[debug\]\s*)?<\s*)?retry-after:\s*(.+)$/i.exec(line);
        if (header) retryAfter = header[1];
      }
      if (/^(?:ERROR|WARNING):/i.test(line)) {
        if (/HTTP (?:Error )?429\b/i.test(line)) limited = true;
        if (/^ERROR:|Unable to download video subtitles/i.test(line)) failed = true;
      }
    });
    return reader;
  });
  try {
    const code = await new Promise((ok, fail) => {child.once('error',fail); child.once('close',ok);});
    if (code !== 0 || failed) throw captionError(o,limited,retryAfter);
    return {limited,retryAfter};
  } finally { for (const reader of readers) reader.close(); }
}

async function commonsCaptions(source,o) {
  if (o.subSource === 'auto') return '';
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  const name = decodeURIComponent(new URL(source).pathname.split('/').pop());
  api.search = new URLSearchParams({action:'timedtext',title:'File:' + name,lang:o.subLang,trackformat:'srt'});
  try {
    const response = await fetch(api, {headers:{'User-Agent':commonsAgent},signal:AbortSignal.timeout(30000)});
    if (response.ok) return await response.text();
    await response.body?.cancel();
    if ([400,404].includes(response.status)) return '';
    throw captionError(o,response.status === 429,response.headers.get('retry-after'));
  } catch (error) {
    if (error instanceof TypeError || error.name === 'TimeoutError') throw captionError(o,false);
    throw error;
  }
}

async function sourceCaptions(dir,o,info) {
  const manual = info.subtitles || {};
  const existing = captionFile(await readdir(dir),o,manual);
  if (existing) return readFile(join(dir,existing),'utf8');
  const tags = [...(o.subSource === 'auto' ? [] : Object.keys(manual)),
    ...(o.subSource === 'manual' ? [] : Object.keys(info.automatic_captions || {}))];
  const lang = captionLanguage(tags,o,manual);
  if (!lang) return '';

  const scratch = await mkdtemp(join(dir,'caption-fetch-'));
  try {
    // This pass only requests one subtitle from the saved extraction. yt-dlp's ignore-errors
    // prevents its info-file fallback from retrying a rejected subtitle against the original URL.
    // The media pass stays strict. Here we verify the actual SRT before accepting success.
    const args = ['--ignore-config','--ignore-errors','--no-cache-dir','--skip-download','--no-playlist','--no-progress',
      '--socket-timeout','18','--retries','0','--fragment-retries','0','--extractor-retries','0',
      o.subSource !== 'auto' && Object.hasOwn(manual,lang) ? '--write-subs' : '--write-auto-subs',
      '--sub-langs',lang,'--sub-format','srt/vtt/best','--convert-subs','srt','-o','source.%(ext)s',
      '--load-info-json',resolve(dir,'source.info.json')];
    const outcome = await fetchWithYtDlp(args,scratch,o);
    try { return await readFile(join(scratch,'source.' + lang + '.srt'),'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw captionError(o,outcome.limited,outcome.retryAfter); throw error; }
  } finally { await rm(scratch,{recursive:true,force:true}); }
}

export async function prepareCaptions(job, source, info = {}) {
  const { options: o, dir } = job;
  if (o.captions === 'off') return null;
  let body;
  try {
    body = await withCaptionBackoff(
      () => source.startsWith('https://upload.wikimedia.org/') ? commonsCaptions(source,o) : sourceCaptions(dir,o,info),
      message => { job.message = message; job.onCaptionStatus?.(message); }
    );
  } catch (error) {
    if (o.type === 'text' || !(error instanceof CaptionRequestError)) throw error;
    job.notes.push(error.message);
    return null;
  }
  const cues = clippedCues(body, o.start, o.end);
  if (!cues.length) {
    const reason = 'No ' + captionLanguages[o.subLang] + ' captions were available for the selected source and time range.';
    if (o.type === 'text') throw Error(reason);
    job.notes.push(reason);
    return null;
  }
  const format = o.captions === 'embed' ? 'srt' : o.subFormat;
  const filename = 'captions.' + format;
  await writeFile(join(dir,filename), renderCues(cues, format));
  return { filename, format };
}
