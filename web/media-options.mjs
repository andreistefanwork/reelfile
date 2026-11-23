import { formats, videoCodecs, audioCodecs, resolutions, rates, bitrates, chapterFormats } from './catalog.mjs';
export const mime = {
  mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8', srt: 'application/x-subrip', vtt: 'text/vtt; charset=utf-8', jpg: 'image/jpeg',
};

function choice(value, fallback, allowed, name) {
  const selected = value ?? fallback;
  if (!allowed.includes(selected)) throw Error('Choose a valid ' + name + '.');
  return selected;
}

function language(value, fallback) {
  const code = value ?? fallback;
  if (typeof code !== 'string' || (code && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(code)))
    throw Error('Enter a language code such as en, ro, or pt-BR.');
  return code;
}

export function seconds(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^(?:\d+:){0,2}\d+(?:\.\d{1,3})?$/.test(value.trim()))
    throw Error('Enter seconds, M:SS, or H:MM:SS for the clip times.');
  const fields = value.trim().split(':').map(Number);
  if (fields.slice(1).some(n => n >= 60)) throw Error('Minutes and seconds after a colon must be below 60.');
  const total = fields.reduce((n, part) => n * 60 + part, 0);
  if (!Number.isSafeInteger(Math.round(total * 1000))) throw Error('The clip timestamp is too large.');
  return total;
}

export function settings(input) {
  const format = choice(input.format, 'mp4', Object.values(formats).flat(), 'output format');
  const type = Object.hasOwn(videoCodecs, format) ? 'video' : formats.audio.includes(format) ? 'audio' : 'text';
  const start = seconds(input.start) ?? 0;
  const end = seconds(input.end);
  if (end !== null && end <= start) throw Error('The end of the clip must come after the start.');
  const result = { format, type, start, end, clip: start > 0 || end !== null,
    captions: type === 'text' ? 'only' : choice(input.captions, 'off', type === 'video' ? ['off','embed','sidecar'] : ['off','sidecar'], 'caption option'),
    metadata: input.metadata === true, chapters: input.chapters === true && chapterFormats.includes(format), thumbnail: input.thumbnail === true };
  if (result.captions !== 'off') {
    result.subLang = language(input.subLang || 'en', 'en');
    result.subSource = choice(input.subSource,'prefer',['prefer','manual','auto'],'caption source');
    result.subFormat = type === 'text' ? format : choice(input.subFormat,'srt',formats.text,'subtitle file format');
  }
  if (type === 'video') {
    result.videoCodec = choice(input.videoCodec,'auto',videoCodecs[format],'video codec for this container');
    result.audioCodec = choice(input.audioCodec,'auto',audioCodecs[format],'audio codec for this container');
    result.resolution = choice(input.resolution,'720',resolutions,'resolution');
    result.fps = choice(input.fps,'source',rates,'frame rate');
  }
  if (type !== 'text') {
    result.audioLang = language(input.audioLang, '');
    result.bitrate = choice(input.bitrate,'auto',bitrates,'audio bitrate');
  }
  return result;
}
