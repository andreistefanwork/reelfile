export const commonsAgent = 'Reelfile/1.0 (https://verdant-delta-4cyx.here.now/; media downloader)';

export function fetchSection(o, source) {
  return o.clip && o.type !== 'text' && ['www.youtube.com','vimeo.com'].includes(new URL(source).hostname);
}

export function captionsOnly(o, commons) {
  return o.type === 'text' && !o.thumbnail && commons;
}

export function sourceArgs(o, source, section, commons = source.startsWith('https://upload.wikimedia.org/'), terminal = false) {
  const args = ['--ignore-config','--no-cache-dir','--no-playlist','--no-colors','--newline','--js-runtimes','node',
    '--socket-timeout','18','--retries','1','--fragment-retries','1','--match-filters','!is_live','--write-info-json',
    '-o','source.%(ext)s'];
  if (!terminal) args.push('--progress','--progress-delta','1','--progress-template','download:PROGRESS:%(progress._percent_str)s');
  if (commons) args.push('--user-agent', commonsAgent);
  if (!commons && o.captions !== 'off') {
    if (o.subSource !== 'auto') args.push('--write-subs');
    if (o.subSource !== 'manual') args.push('--write-auto-subs');
    // Keep caption metadata, but defer the actual HTTP request until after the media download.
    args.push('--sub-langs',o.subLang + '(?:-[A-Za-z]{2}|-[0-9]{3})?(?:-orig)?','--sub-format','srt/vtt/best','-o','subtitle:');
  }
  if (o.thumbnail) args.push('--write-thumbnail','--convert-thumbnails','jpg');
  if (o.type === 'text') args.push('--skip-download');
  else {
    let formats;
    const preferred = o.audioLang ? '[language^=' + o.audioLang + ']' : '';
    if (o.type === 'audio') formats = (preferred ? 'ba' + preferred + '/b' + preferred + '/' : '') + 'ba/b';
    else if (o.audioCodec === 'none') formats = 'bv/b';
    else formats = (preferred ? 'bv+ba' + preferred + '/b' + preferred + '/' : '') + 'bv+ba/b/bv';
    if (section) {
      args.push('--download-sections','*' + o.start + '-' + (o.end ?? 'inf'));
      if (o.type === 'video') args.push('--force-keyframes-at-cuts');
    }
    args.push('-f',formats,'--merge-output-format','mkv','--no-simulate','--print-to-file','after_move:filepath','source-path.txt');
    if (o.type === 'video') {
      const sort = [o.resolution === 'best' ? 'res' : 'res:' + o.resolution, o.fps === 'source' ? 'fps' : 'fps:' + o.fps];
      if (o.videoCodec !== 'auto') sort.push('vcodec:' + ({h264:'h264',hevc:'h265',vp9:'vp9',av1:'av1'}[o.videoCodec]));
      args.push('-S',sort.join(','));
    }
  }
  return [...args,'--',source];
}
