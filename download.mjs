import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { prepareCaptions } from './captions.mjs';
import { captionsOnly, fetchSection, sourceArgs } from './web/extraction.mjs';

const exec = promisify(execFile);
const probeFile = async path => JSON.parse((await exec('ffprobe', ['-v','error','-show_streams','-show_format','-show_chapters','-of','json',path],
  {maxBuffer: 16 * 1024 * 1024})).stdout);

function mediaError(output) {
  if (/no space left on device|disk quota exceeded/i.test(output)) return 'The server ran out of temporary storage.';
  if (/confirm you.?re not a bot|bot detection|blocked.*IP|HTTP Error 429|sign in to confirm/i.test(output)) return 'The video site blocked this server. Try another source.';
  if (/HTTP Error 403|private video|unavailable|not found|login required/i.test(output)) return 'The source did not make this media available to the server.';
  if (/requested format is not available|no video formats/i.test(output)) return 'No downloadable track matches these settings.';
  return 'The source could not be downloaded. Try another public link.';
}

async function processFile(program, args, cwd, onLine) {
  const child = spawn(program, args, { cwd, stdio: ['ignore','pipe','pipe'] });
  let diagnostic = '';
  const lines = createInterface({ input: child.stdout });
  lines.on('line', onLine);
  child.stderr.setEncoding('utf8').on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-6000); });
  try {
    const code = await new Promise((resolve, reject) => { child.once('error',reject); child.once('close',resolve); });
    if (code !== 0) throw Error(program === 'yt-dlp' || /no space left/i.test(diagnostic) ? mediaError(diagnostic) : 'FFmpeg could not prepare this combination of tracks and settings.');
  } finally { lines.close(); }
}

const videoEncoders = {
  h264: ['libx264','-preset','veryfast','-crf','22'],
  hevc: ['libx265','-preset','veryfast','-crf','26','-x265-params','pools=1:frame-threads=1'],
  vp9: ['libvpx-vp9','-deadline','realtime','-cpu-used','7','-crf','34','-b:v','0'],
  av1: ['libaom-av1','-cpu-used','8','-crf','35','-b:v','0','-row-mt','1'],
};
function videoArgs(o, stream) {
  const compatible = o.format === 'mkv' || (o.format === 'webm' ? ['vp8','vp9','av1'] : ['h264','hevc','av1','mpeg4']).includes(stream.codec_name);
  const filters = [];
  if (o.resolution !== 'best' && Math.min(stream.width, stream.height) > Number(o.resolution)) {
    filters.push('scale=' + (stream.width >= stream.height ? '-2:' + o.resolution : o.resolution + ':-2'));
  }
  const [n,d] = (stream.avg_frame_rate || '').split('/').map(Number);
  if (o.fps !== 'source' && (!(n/d > 0) || n/d > Number(o.fps))) filters.push('fps=' + o.fps);
  const codec = o.videoCodec === 'auto' ? (compatible ? stream.codec_name : null) : o.videoCodec;
  if (codec === stream.codec_name && !filters.length && !o.clip) return ['-c:v','copy'];
  const target = Object.hasOwn(videoEncoders, codec) ? codec : (o.format === 'webm' ? 'vp9' : 'h264');
  if (!filters.some(f => f.startsWith('scale=')) && (stream.width % 2 || stream.height % 2)) filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
  return [...(filters.length ? ['-vf',filters.join(',')] : []),'-c:v',...videoEncoders[target],'-threads:v','2','-pix_fmt','yuv420p', ...(target === 'hevc' && o.format === 'mp4' ? ['-tag:v','hvc1'] : [])];
}

function audioArgs(o, stream) {
  const codecs = { mp3:'libmp3lame', aac:'aac', opus:'libopus', flac:'flac', pcm_s16le:'pcm_s16le' };
  let target = o.type === 'audio' ? ({m4a:'aac',wav:'pcm_s16le'}[o.format] || o.format) : o.audioCodec;
  if (target === 'auto') {
    const valid = o.format === 'mkv' || (o.format === 'webm' ? ['opus','vorbis'] : ['aac','mp3','alac']).includes(stream.codec_name);
    target = valid && (o.bitrate === 'auto' || ['mp3','aac','opus'].includes(stream.codec_name)) ? stream.codec_name : (o.format === 'webm' ? 'opus' : 'aac');
  }
  const lossless = ['flac','pcm_s16le','alac'].includes(target);
  if (target === stream.codec_name && (o.bitrate === 'auto' || lossless) && !o.clip) return ['-c:a','copy'];
  if (!Object.hasOwn(codecs,target)) target = o.format === 'webm' ? 'opus' : 'aac';
  const args = ['-c:a',codecs[target]];
  if (['mp3','aac','opus'].includes(target)) args.push('-b:a',(o.bitrate === 'auto' ? '160' : o.bitrate) + 'k');
  if (target === 'mp3' && stream.channels > 2) args.push('-ac','2');
  return args;
}

const escapeTag = text => String(text ?? '').replace(/[\\=;#\n]/g, c => '\\' + c);
async function chapterFile(job, info, probe) {
  const o = job.options;
  const chapters = info.chapters || probe.chapters || [];
  const parts = [';FFMETADATA1'];
  for (const c of chapters) {
    const a = Math.max(Number(c.start_time),o.start) - o.start;
    const b = Math.min(Number(c.end_time),o.end ?? Infinity) - o.start;
    if (b > a) parts.push('[CHAPTER]','TIMEBASE=1/1000','START=' + Math.round(a*1000),'END=' + Math.round(b*1000),'title=' + escapeTag(c.title || c.tags?.title || ''));
  }
  await writeFile(join(job.dir,'chapters.ffmeta'), parts.join('\n') + '\n');
}
function languageBase(tag) {
  try { return new Intl.Locale(tag).language; } catch { return undefined; }
}

async function exportMedia(job, input, info, caption, section) {
  const o = job.options;
  const probe = await probeFile(join(job.dir,input));
  const video = probe.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = probe.streams.filter(s => s.codec_type === 'audio');
  const preferred = languageBase(o.audioLang);
  const selected = audio.find(s => o.audioLang && s.tags?.language?.toLowerCase() === o.audioLang.toLowerCase())
    || (preferred && audio.find(s => languageBase(s.tags?.language) === preferred))
    || audio.find(s => s.disposition?.default) || audio[0];
  if (o.type === 'video' && !video) throw Error('This source has no video track.');
  if (o.type === 'audio' && !selected) throw Error('This source has no audio track.');
  const duration = Number(probe.format.duration);
  const seek = section ? 0 : o.start;
  if (seek && duration > 0 && seek >= duration) throw Error('The clip starts after the end of the source.');
  const requestedLength = o.end === null ? Infinity : o.end - o.start;
  const length = Math.min(requestedLength, duration > 0 ? duration - seek : Infinity);
  const args = ['-hide_banner','-loglevel','error','-nostdin','-y'];
  if (seek) args.push('-ss',String(seek));
  args.push('-i',input);
  const embed = Boolean(caption && o.captions === 'embed');
  if (embed) args.push('-i',caption.filename);
  if (o.chapters) {
    await chapterFile(job,info,probe);
    args.push('-f','ffmetadata','-i','chapters.ffmeta');
  }
  if (o.end !== null) args.push('-t',String(o.end - o.start));
  if (o.type === 'video') args.push('-map','0:' + video.index,...videoArgs(o,video));
  if (selected && o.audioCodec !== 'none') args.push('-map','0:' + selected.index,...audioArgs(o,selected));
  if (embed) args.push('-map','1:s:0','-c:s',({mp4:'mov_text',webm:'webvtt',mkv:'srt'}[o.format]),'-metadata:s:s:0','title=' + o.subLang);
  args.push('-map_metadata',o.metadata ? '0' : '-1','-map_chapters',o.chapters ? (embed ? '2' : '1') : '-1');
  if (o.metadata) {
    for (const [key,value] of Object.entries({title:info.title,artist:info.artist || info.uploader,comment:info.webpage_url})) {
      if (typeof value === 'string') args.push('-metadata',key + '=' + value);
    }
  }
  if (['mp4','m4a'].includes(o.format)) args.push('-movflags','+faststart');
  args.push('-progress','pipe:1','-nostats','media.' + o.format);
  job.message = 'Preparing your ' + o.format.toUpperCase() + '…';
  await processFile('ffmpeg',args,job.dir,line => {
    if (line.startsWith('out_time_us=') && Number.isFinite(length) && length > 0) {
      const percent = Math.min(99, Math.max(0,Math.round(Number(line.slice(12)) / (length * 10000))));
      if (Number.isFinite(percent)) job.message = 'Preparing your file · ' + percent + '%';
    }
  });
  return {filename:'media.' + o.format,format:o.format};
}

async function addFile(job, key, entry) {
  const file = join(job.dir,entry.filename);
  const { size } = await stat(file);
  if (!size) throw Error('The selected output is empty.');
  job.files[key] = {...entry,file,size};
}
export async function download(job, source) {
  const o = job.options;
  // Commons serves caption tracks separately from the media CDN, so a text-only request can skip the media entirely.
  if (!captionsOnly(o, source.startsWith('https://upload.wikimedia.org/'))) {
    await processFile('yt-dlp',sourceArgs(o,source,fetchSection(o,source)),job.dir,line => {
      if (line.startsWith('PROGRESS:')) {
        const pct = parseFloat(line.slice(9));
        if (Number.isFinite(pct)) job.message = 'Downloading a media track · ' + Math.round(pct) + '%';
      }
    });
  }
  await finishDownload(job,source);
  const keep = new Set(Object.values(job.files).map(f => f.filename));
  for (const name of await readdir(job.dir)) if (!keep.has(name)) await rm(join(job.dir,name),{recursive:true,force:true});
}

// Both the web service and the terminal export finish the same downloaded tracks here.
export async function finishDownload(job, source) {
  const o = job.options;
  const section = fetchSection(o,source);
  let info = {};
  try { info = JSON.parse(await readFile(join(job.dir,'source.info.json'),'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  job.title = info.title || decodeURIComponent(new URL(source).pathname.split('/').pop());
  const caption = await prepareCaptions(job,source,info.subtitles || {});
  if (o.type === 'text') await addFile(job,'file',caption);
  else {
    let input;
    try { input = basename((await readFile(join(job.dir,'source-path.txt'),'utf8')).trim()); }
    catch { throw Error('The source is live or has no downloadable media.'); }
    if (!/^source\.[A-Za-z0-9]+$/.test(input)) throw Error('The source returned an unexpected media file.');
    await addFile(job,'file',await exportMedia(job,input,info,caption,section));
    if (caption && o.captions === 'sidecar') await addFile(job,'captions',caption);
  }
  if (o.thumbnail) {
    if ((await readdir(job.dir)).includes('source.jpg')) await addFile(job,'thumbnail',{filename:'source.jpg',format:'jpg'});
    else job.notes.push('The source did not provide a cover image.');
  }
}
