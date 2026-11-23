import { localCommand } from './local-command.mjs?v=2';
import { formats, videoCodecs, audioCodecs, resolutions, rates, bitrates, chapterFormats } from './catalog.mjs?v=2';
const form = document.querySelector('#media-form');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const statusLine = document.querySelector('#status');
const details = document.querySelector('#details');
const downloads = document.querySelector('#downloads');
const notes = document.querySelector('#notes');
const fields = form.elements;
const labels = {
  mp4:'MP4',mkv:'Matroska (MKV)',webm:'WebM',mp3:'MP3',m4a:'M4A (AAC)',opus:'Opus',flac:'FLAC',wav:'WAV (PCM)',
  txt:'Plain text (TXT)',srt:'SubRip (SRT)',vtt:'WebVTT (VTT)',auto:'Automatic',h264:'H.264 / AVC',hevc:'H.265 / HEVC',vp9:'VP9',av1:'AV1',
  aac:'AAC',none:'Mute video',off:'Off',embed:'Embed in video',sidecar:'Separate file',best:'Best available',source:'Source frame rate',
};
function choices(field, values, fallback, display = v => labels[v] || v) {
  const selected = values.includes(field.value) ? field.value : fallback;
  field.replaceChildren(...values.map(value => new Option(display(value),value)));
  field.value = selected;
}
function visible(id, show) {
  const field = document.getElementById(id);
  field.hidden = !show;
  for (const input of field.querySelectorAll('input,select')) input.disabled = !show;
}
function configure() {
  const type = fields.type.value;
  const video = type === 'video';
  const text = type === 'text';
  choices(fields.format, formats[type], formats[type][0]);
  const format = fields.format.value;
  if (video) {
    choices(fields.videoCodec,videoCodecs[format],'auto');
    choices(fields.audioCodec,audioCodecs[format],'auto');
  }
  choices(fields.captions,video ? ['off','sidecar','embed'] : ['off','sidecar'],'off');
  const captions = text || fields.captions.value !== 'off';
  visible('tracks',!text);
  document.querySelector('#tracks summary').textContent = video ? 'Video and audio tracks' : 'Audio track';
  visible('resolution-field',video);
  visible('video-codec-field',video);
  visible('fps-field',video);
  visible('audio-codec-field',video);
  visible('video-rate-field',video && fields.audioCodec.value !== 'none');
  visible('audio-rate-field',type === 'audio' && !['flac','wav'].includes(format));
  visible('language-field',!text && (!video || fields.audioCodec.value !== 'none'));
  visible('caption-mode',!text);
  visible('caption-format',!text && fields.captions.value === 'sidecar');
  visible('caption-language',captions);
  visible('caption-source',captions);
  visible('chapters-field',chapterFormats.includes(format));
  visible('tags-field',!text);
  document.querySelector('#text-hint').hidden = !text;
}
choices(fields.resolution,resolutions,'720',v => v === 'best' ? labels.best : v + 'p');
choices(fields.fps,rates,'source',v => v === 'source' ? labels.source : v + ' fps');
for (const field of [fields.videoRate,fields.audioRate]) choices(field,bitrates,'auto',v => v === 'auto' ? labels.auto : v + ' kbps');
choices(fields.subFormat,['srt','vtt','txt'],'srt');
form.addEventListener('change', event => {
  if (['type','format','captions','audioCodec'].includes(event.target.name)) configure();
  if (event.target.name === 'type' && fields.type.value === 'text') document.querySelector('#caption-panel').open = true;
});
configure();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;
function showSourceNote() {
  let host;
  try { host = new URL(form.elements.url.value).hostname; } catch { host = ''; }
  document.querySelector('#youtube-note').hidden = !/^(?:(?:www|m|music)\.)?youtube\.com$|^youtu\.be$/.test(host);
}
form.elements.url.addEventListener('input', showSourceNote);
document.querySelector('#sample').addEventListener('click', () => {
  form.elements.url.value = fields.type.value === 'text' || fields.captions.value !== 'off'
    ? 'https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_medium.ogv'
    : 'https://download.blender.org/peach/trailer/trailer_480p.mov';
  showSourceNote();
  form.elements.url.focus();
});

function show(message, error = false) {
  result.hidden = false;
  result.classList.toggle('error', error);
  statusLine.textContent = message;
}
function working(active) {
  busy = active;
  submit.disabled = active;
  submit.textContent = active ? 'Preparing…' : 'Prepare download';
}
async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(90000), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || Object.keys(data).length === 0) {
    const error = new Error(data.error || 'The server is waking up or unavailable. Please try again in a moment.');
    error.transient = response.status >= 500 || response.status === 200;
    throw error;
  }
  return data;
}
async function follow(id) {
  const endpoint = '/api/jobs/' + id;
  let failures = 0;
  for (;;) {
    let job;
    try { job = await request(endpoint); failures = 0; }
    catch (error) {
      if (error.transient === false || ++failures > 4) throw error;
      show('Reconnecting to the server…');
      await wait(4000);
      continue;
    }
    if (job.status === 'error') throw new Error(job.message);
    if (job.status === 'ready') {
      show('Your ' + job.format.toUpperCase() + ' is ready.');
      const size = job.size < 1000 ? job.size + ' B' : job.size < 1000000 ? (job.size / 1000).toFixed(1) + ' KB' : (job.size / 1000000).toFixed(1) + ' MB';
      details.textContent = (job.title || 'Download') + ' · ' + size + ' · Available for 10 minutes';
      const files = job.files || { file: { format: job.format } };
      for (const [key, file] of Object.entries(files)) {
        const link = document.createElement('a');
        link.className = 'save';
        link.href = endpoint + '/' + key;
        link.download = (job.title || 'download').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) + '.' + file.format;
        link.textContent = key === 'thumbnail' ? 'Save cover image' : (key === 'captions' ? 'Save captions · ' : 'Save ') + file.format.toUpperCase();
        downloads.append(link);
      }
      notes.textContent = (job.notes || []).join(' ');
      notes.hidden = !notes.textContent;
      return;
    }
    show(job.message);
    await wait(3000);
  }
}
function formPayload() {
  const values = new FormData(form);
  const payload = Object.fromEntries(values);
  payload.url = payload.url.trim();
  payload.bitrate = values.get('videoRate') || values.get('audioRate') || 'auto';
  for (const key of ['metadata','chapters','thumbnail']) payload[key] = values.has(key);
  delete payload.type;
  delete payload.videoRate;
  delete payload.audioRate;
  return payload;
}

const terminal = document.querySelector('#terminal');
const copyStatus = document.querySelector('#copy-status');
const preview = document.querySelector('#command-preview');
const commandText = document.querySelector('#command-text');
terminal.value = /Windows/i.test(navigator.userAgent) ? 'powershell' : 'posix';

let commandVersion = 0;
function clearCommand() {
  commandVersion++;
  copyStatus.textContent = '';
  commandText.value = '';
  preview.open = false;
  preview.hidden = true;
}
form.addEventListener('input', clearCommand);
form.addEventListener('change', clearCommand);
document.querySelector('#sample').addEventListener('click', clearCommand);
document.querySelector('#copy-command').addEventListener('click', async () => {
  clearCommand();
  if (!form.reportValidity()) return;
  const version = commandVersion;
  let text;
  try { text = localCommand(formPayload(),terminal.value); }
  catch (error) { copyStatus.textContent = error.message; return; }
  commandText.value = text;
  preview.hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    if (version === commandVersion) copyStatus.textContent = 'Copied. Paste the command into the selected terminal.';
  } catch {
    if (version !== commandVersion) return;
    preview.open = true;
    commandText.focus();
    commandText.select();
    copyStatus.textContent = 'Clipboard access is unavailable. Copy the selected command manually.';
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  working(true);
  downloads.replaceChildren();
  notes.hidden = true;
  details.textContent = '';
  show('Connecting… The first request can take a minute while the server wakes up.');
  try {
    const payload = formPayload();
    const { id } = await request('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) });
    await follow(id);
  } catch (error) {
    show(error.name === 'TimeoutError' || error instanceof TypeError ? 'The server could not be reached. Try again in a moment.' : error.message, true);
  } finally { working(false); }
});
