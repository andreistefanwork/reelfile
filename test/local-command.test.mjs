import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localCommand } from '../web/local-command.mjs';
import { settings } from '../web/media-options.mjs';
import { sourceArgs } from '../web/extraction.mjs';
import { canonicalSource } from '../sources.mjs';

const clip = {
  url: 'https://youtu.be/GJVwbyAY4Sk?t=7', format:'mkv', start:'1:05.125', end:'1:09', resolution:'144',
  fps:'24', videoCodec:'av1', audioCodec:'opus', audioLang:'ro', bitrate:'128',
  captions:'sidecar', subLang:'pt-BR', subSource:'auto', subFormat:'txt', thumbnail:true, metadata:true, chapters:true,
};

test('a pasted shell export preserves all settings and uses the shared extraction arguments', {skip:process.platform === 'win32'}, t => {
  const dir = mkdtempSync(join(tmpdir(),'reelfile-command-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const bin = join(dir,'bin');
  mkdirSync(bin);
  writeFileSync(join(bin,'yt-dlp'), "#!/usr/bin/env node\nrequire('node:fs').writeFileSync('arguments.json',JSON.stringify(process.argv.slice(2)))",{mode:0o755});
  writeFileSync(join(bin,'npm'), "#!/usr/bin/env node\nrequire('node:fs').writeFileSync('finish-arguments.json',JSON.stringify(process.argv.slice(2)))",{mode:0o755});
  const run = payload => execFileSync('sh',['-c',localCommand(payload,'posix')],{cwd:dir,env:{...process.env,PATH:bin + ':' + process.env.PATH}});
  run(clip);
  run(clip);
  const dirs = readdirSync(dir).filter(name=>name.startsWith('Reelfile-'));
  assert.equal(dirs.length,2);
  for (const dest of dirs) {
    const stage = join(dir,dest,'.reelfile-work');
    const job = JSON.parse(readFileSync(join(stage,'job.json')));
    assert.equal(job.url,'https://www.youtube.com/watch?v=GJVwbyAY4Sk');
    assert.deepEqual(settings(job),settings(clip));
    assert.deepEqual(JSON.parse(readFileSync(join(stage,'arguments.json'))),sourceArgs(settings(clip),job.url,true,false,true));
    const finish = JSON.parse(readFileSync(join(dir,dest,'finish-arguments.json')));
    assert.ok(finish.some(value=>/--package=https:\/\/codeload\.github\.com\/andreistefanwork\/reelfile\/tar\.gz\/[a-f0-9]{40}$/.test(value)));
    assert.equal(finish.at(-1),'reelfile-finish');
  }
  const quoted = {url:"https://commons.wikimedia.org/wiki/File:O'Brien_%26_friends.ogv",format:'mp3'};
  run(quoted);
  const last = readdirSync(dir).find(name=>name.startsWith('Reelfile-') && !dirs.includes(name));
  assert.equal(JSON.parse(readFileSync(join(dir,last,'.reelfile-work','arguments.json'))).at(-1),canonicalSource(quoted.url));
});

test('Commons text-only jobs skip media extraction and both shells preserve the quote in the title', () => {
  const text = {url:"https://commons.wikimedia.org/wiki/File:O'Brien.ogv",format:'vtt',subLang:'en',start:'21'};
  for (const shell of ['posix','powershell']) {
    const cmd = localCommand(text,shell);
    assert.doesNotMatch(cmd,/yt-dlp --ignore-config|onrender\.com|\/api\/jobs/);
    assert.match(cmd,/"format":"vtt"/);
    assert.match(cmd,/"start":"21"/);
    if (shell === 'powershell') assert.match(cmd,/O''Brien/);
  }
});

test('invalid source, incompatible tracks, and invalid times cannot generate commands', () => {
  for (const changes of [{url:'file:///tmp/file'}, {format:'webm',videoCodec:'hevc'}, {end:'2'}, {subLang:'all,en.*'}])
    assert.throws(()=>localCommand({...clip,...changes},'posix'));
});
