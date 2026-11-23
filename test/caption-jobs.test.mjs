import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { prepareCaptions } from '../captions.mjs';
import { settings } from '../web/media-options.mjs';
import { sourceArgs } from '../web/extraction.mjs';

const clip = 'https://www.youtube.com/watch?v=GJVwbyAY4Sk';
test('an unavailable Romanian track is optional for video and required for transcript jobs', async t => {
  const dir = await mkdtemp(join(tmpdir(),'reelfile-captions-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const media = {dir,notes:[],options:settings({format:'mp4',captions:'embed',subLang:'ro'})};
  assert.equal(await prepareCaptions(media,clip),null);
  assert.match(media.notes[0],/No Romanian captions/);
  await assert.rejects(prepareCaptions({dir,notes:[],options:settings({format:'txt',subLang:'ro'})},clip),/No Romanian captions/);
});

test('creator and automatic source choices request only the selected track types', () => {
  for (const [subSource,manual,auto] of [['prefer',true,true],['manual',true,false],['auto',false,true]]) {
    const args = sourceArgs(settings({format:'srt',subLang:'ro',subSource}),clip,false);
    assert.equal(args.includes('--write-subs'),manual);
    assert.equal(args.includes('--write-auto-subs'),auto);
    const matches = new RegExp('^(?:' + args[args.indexOf('--sub-langs')+1] + ')$');
    assert.ok(matches.test('ro') && matches.test('ro-RO') && matches.test('ro-orig'));
    assert.equal(matches.test('en'),false);
  }
});

test('CMD preparation stores expansion-sensitive yt-dlp arguments in files', async t => {
  const dir = await mkdtemp(join(tmpdir(),'reelfile-cmd-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const helper = fileURLToPath(new URL('../local-prepare.mjs',import.meta.url));
  execFileSync(process.execPath,[helper,'--url',clip,'--format','mp4','--captions','sidecar','--subLang','ro','--start','3'],{cwd:dir});
  const read = name => readFile(join(dir,'.reelfile-work',name),'utf8');
  assert.equal((await read('source.urls')).trim(),clip);
  assert.equal(JSON.parse(await read('job.json')).subLang,'ro');
  const conf = await read('source.conf');
  for (const token of ['source.%(ext)s','!is_live','--download-sections','*3-inf','--write-subs','--write-auto-subs']) assert.ok(conf.includes(token));
});
