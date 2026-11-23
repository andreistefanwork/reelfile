import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../media-options.mjs';
import { captionFile, clippedCues, renderCues } from '../captions.mjs';

test('existing requests keep their output, with no duration or size cap', () => {
  assert.equal(settings({format:'mp4'}).resolution,'720');
  assert.equal(settings({format:'mp3'}).type,'audio');
  assert.equal(settings({format:'mkv',start:'1:00:00',end:'4:01:05.5'}).end,14465.5);
});

test('the server validates container, track, language and time selections', () => {
  for (const request of [
    {format:'webm',videoCodec:'h264'}, {format:'mp4',audioCodec:'opus'}, {format:'txt',subLang:'all,en.*'}, {format:'srt',subLang:'fr'},
    {format:'mp3',start:'2:62'}, {format:'m4a',start:'11',end:'0:10'}, {format:'mp4',resolution:'--config'},
  ]) assert.throws(() => settings(request));
  assert.equal(settings({format:'mp4',start:'1:02.125'}).start,62.125);
});

const captions = '1\r\n00:00:01,000 --> 00:00:03,000\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nHello\r\n<i>world</i>\r\n\r\n3\r\n00:00:07,000 --> 00:00:09,000\r\nAfter\r\n';
test('both clip boundaries truncate overlapping cues and rebase timestamps', () => {
  const cues = clippedCues(captions,2,4.25);
  assert.deepEqual(cues.map(({a,b})=>[a,b]), [[0,1000],[1000,2250]]);
  assert.match(renderCues(cues,'srt'),/00:00:01,000 --> 00:00:02,250/);
  assert.match(renderCues(cues,'vtt'),/^WEBVTT\n\n00:00:00.000/);
  assert.equal(renderCues(cues,'txt'),'Hello\nworld\n');
});

test('caption selection stays in the selected language and prefers a creator track over automatic variants', () => {
  const options = settings({format:'srt',subLang:'ro'});
  const files = ['source.en.srt','source.ro.srt','source.ro-RO.srt','source.ro-orig.srt'];
  assert.equal(captionFile(files,options,{'ro-RO':[]}), 'source.ro-RO.srt');
  assert.equal(captionFile(files,options,{}), 'source.ro.srt');
  assert.equal(captionFile(['source.en.srt'],options,{}), undefined);
  assert.equal(settings({format:'mp4',audioLang:'it'}).audioLang,'it');
});
