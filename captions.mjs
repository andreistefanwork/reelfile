import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export const commonsAgent = 'Reelfile/1.0 (https://verdant-delta-4cyx.here.now/; media downloader)';

export async function prepareCaptions(job, source) {
  const { options: o, dir } = job;
  if (o.captions === 'off') return null;
  let body = '';
  if (source.startsWith('https://upload.wikimedia.org/')) {
    if (o.subSource !== 'auto') {
      const api = new URL('https://commons.wikimedia.org/w/api.php');
      const name = decodeURIComponent(new URL(source).pathname.split('/').pop());
      api.search = new URLSearchParams({action:'timedtext',title:'File:' + name,lang:o.subLang,trackformat:'srt'});
      const response = await fetch(api, { headers: {'User-Agent': commonsAgent}, signal: AbortSignal.timeout(30000) });
      if (response.ok) body = await response.text();
      else if (response.status !== 404) job.notes.push('Wikimedia could not serve the requested caption track.');
    }
  } else {
    const files = await readdir(dir);
    const names = [o.subLang, o.subLang + '-orig'].map(lang => 'source.' + lang + '.srt');
    const name = names.find(candidate => files.includes(candidate));
    if (name) body = await readFile(join(dir, name), 'utf8');
  }
  const cues = clippedCues(body, o.start, o.end);
  if (!cues.length) {
    const reason = 'No ' + o.subLang + ' captions were available for the selected source and time range.';
    if (o.type === 'text') throw Error(reason);
    job.notes.push(reason);
    return null;
  }
  const format = o.captions === 'embed' ? 'srt' : o.subFormat;
  const filename = 'captions.' + format;
  await writeFile(join(dir,filename), renderCues(cues, format));
  return { filename, format };
}
