const form = document.querySelector('#media-form');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const statusLine = document.querySelector('#status');
const details = document.querySelector('#details');
const save = document.querySelector('#save');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;
function showSourceNote() {
  let host;
  try { host = new URL(form.elements.url.value).hostname; } catch { host = ''; }
  document.querySelector('#youtube-note').hidden = !/^(?:(?:www|m|music)\.)?youtube\.com$|^youtu\.be$/.test(host);
}
form.elements.url.addEventListener('input', showSourceNote);
document.querySelector('#sample').addEventListener('click', () => {
  form.elements.url.value = 'https://download.blender.org/peach/trailer/trailer_480p.mov';
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
      details.textContent = (job.title || 'Download') + ' · ' + (job.size / 1000000).toFixed(1) + ' MB · Available for 10 minutes';
      save.href = endpoint + '/file';
      save.download = (job.title || 'download').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) + '.' + job.format;
      save.textContent = 'Save ' + job.format.toUpperCase();
      save.hidden = false;
      return;
    }
    show(job.message);
    await wait(3000);
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  working(true);
  save.hidden = true;
  details.textContent = '';
  show('Connecting… The first request can take a minute while the server wakes up.');
  try {
    const values = new FormData(form);
    const { id } = await request('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: values.get('url').trim(), format: values.get('format') }) });
    await follow(id);
  } catch (error) {
    show(error.name === 'TimeoutError' || error instanceof TypeError ? 'The server could not be reached. Try again in a moment.' : error.message, true);
  } finally { working(false); }
});
