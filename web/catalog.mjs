export const formats = {
  video: ['mp4', 'mkv', 'webm'],
  audio: ['mp3', 'm4a', 'opus', 'flac', 'wav'],
  text: ['txt', 'srt', 'vtt'],
};
export const videoCodecs = {
  mp4: ['auto', 'h264', 'hevc', 'av1'],
  webm: ['auto', 'vp9', 'av1'],
  mkv: ['auto', 'h264', 'hevc', 'vp9', 'av1'],
};
export const audioCodecs = {
  mp4: ['auto', 'aac', 'none'],
  webm: ['auto', 'opus', 'none'],
  mkv: ['auto', 'aac', 'opus', 'mp3', 'none'],
};
export const resolutions = ['best','144','240','360','480','720','1080','1440','2160','4320'];
export const rates = ['source','24','30','50','60'];
export const bitrates = ['auto','64','96','128','160','192','256','320'];
export const chapterFormats = ['mp4','mkv','webm','mp3','m4a'];
