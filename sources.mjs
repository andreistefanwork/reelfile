import { createHash } from 'node:crypto';

const videoId = /^[\w-]{11}$/;
const mediaName = /^[^/\\?#\x00-\x1f]+\.(?:webm|ogv|ogg|mp4|mpeg|mp3|wav|flac|opus)$/iu;

export function canonicalSource(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;

  const host = url.hostname;
  const path = url.pathname;
  if (host === 'media.w3.org' && path === '/2010/05/sintel/trailer.mp4') return 'https://media.w3.org' + path;
  let id;
  if (host === 'youtu.be') id = path.slice(1);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    id = path === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(path)?.[1];
  }
  if (id && videoId.test(id)) return 'https://www.youtube.com/watch?v=' + id;

  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const video = /^\/(?:video\/)?(\d+)\/?$/.exec(path);
    if (video) return 'https://vimeo.com/' + video[1];
  }

  if (host === 'commons.wikimedia.org' || host === 'upload.wikimedia.org') {
    const prefix = host === 'commons.wikimedia.org'
      ? /^\/wiki\/File:(.+)$/i : /^\/wikipedia\/commons\/[a-f0-9]\/[a-f0-9]{2}\/(.+)$/;
    let name;
    try { name = decodeURIComponent(prefix.exec(path)?.[1] ?? '').replaceAll(' ', '_').normalize('NFC'); }
    catch { return null; }
    if (!mediaName.test(name)) return null;
    const digest = createHash('md5').update(name).digest('hex');
    return 'https://upload.wikimedia.org/wikipedia/commons/' + digest[0] + '/' + digest.slice(0, 2) + '/' + encodeURIComponent(name);
  }
  return null;
}
