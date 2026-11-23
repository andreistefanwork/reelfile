// Exercise the real CLI boundary with local media and a deterministic caption server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {settings} from '../web/media-options.mjs';
import {sourceArgs} from '../web/extraction.mjs';
import {finishDownload} from '../download.mjs';

const run = promisify(execFile);

test('a subtitle HTTP 429 preserves the MP4, fails a transcript, and does not retry the blocked track', async t => {
  const dir = await mkdtemp(join(tmpdir(),'reelfile-subtitle-http-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const fixture = join(dir,'fixture.mp4');
  await run('ffmpeg',['-v','error','-f','lavfi','-i','color=size=160x90:rate=10:duration=1','-c:v','libx264','-threads','1',fixture]);
  const video = await readFile(fixture);
  let limited = true;
  const hits = { video:0, ro:0, other:0 };
  const server = createServer((req,res) => {
    if (req.url === '/video.mp4') { hits.video++; res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':video.length}); res.end(video); }
    else if (req.url === '/ro.vtt') {
      hits.ro++;
      if (limited) { res.writeHead(429,{'Retry-After':'3600'}); res.end(); }
      else { res.writeHead(200,{'Content-Type':'text/vtt'}); res.end('WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nBună ziua\n'); }
    } else { hits.other++; res.writeHead(404); res.end(); }
  });
  await new Promise((ok,fail) => { server.once('error',fail); server.listen(0,'127.0.0.1',ok); });
  t.after(() => new Promise(done => server.close(done)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const url = base + '/watch';
  const info = {id:'fixture',title:'Test',webpage_url:url,original_url:url,extractor:'generic',extractor_key:'Generic',
    url:base+'/video.mp4',ext:'mp4',duration:1,vcodec:'h264',automatic_captions:{
      ro:[{url:base+'/ro.vtt',ext:'vtt'}],'ro-orig':[{url:base+'/other.srt',ext:'srt'}]
    }};
  await writeFile(join(dir,'fixture.json'),JSON.stringify(info));
  const options = settings({format:'mp4',captions:'embed',subLang:'ro',subSource:'prefer'});
  const args = sourceArgs(options,url,false).slice(0,-2);
  assert.ok(!args.includes('--ignore-errors'));
  await run('yt-dlp',[...args,'--load-info-json','fixture.json'],{cwd:dir});
  assert.equal(hits.ro,0);
  assert.ok(hits.video>0);
  const requests = hits.video;
  const job = {dir,options,files:{},notes:[]};
  await finishDownload(job,url);
  const streams = async file => JSON.parse((await run('ffprobe',['-v','error','-show_streams','-of','json',file])).stdout).streams;
  assert.deepEqual((await streams(job.files.file.file)).map(s=>s.codec_type),['video']);
  assert.match(job.notes.join(' '),/Romanian.*HTTP 429/);
  assert.equal(hits.ro,1);

  const transcript = {dir,options:settings({format:'txt',subLang:'ro'}),files:{},notes:[]};
  await assert.rejects(finishDownload(transcript,url),/HTTP 429.*later/);
  assert.equal(hits.ro,2);
  limited = false;
  job.notes = [];
  await finishDownload(job,url);
  assert.ok((await streams(job.files.file.file)).some(s=>s.codec_type==='subtitle'));
  assert.deepEqual(job.notes,[]);
  assert.deepEqual(hits,{video:requests,ro:3,other:0});
});
