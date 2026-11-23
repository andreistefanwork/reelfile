#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { constants } from 'node:fs';
import { copyFile, lstat, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { finishDownload } from './download.mjs';
import { canonicalSource } from './sources.mjs';
import { settings } from './web/media-options.mjs';

async function main() {
  const dir = resolve('.reelfile-work');
  if (!(await lstat(dir)).isDirectory()) throw Error('Run the copied command in full to create its working directory.');
  const input = JSON.parse(await readFile(join(dir,'job.json'),'utf8'));
  const source = canonicalSource(input.url);
  if (!source) throw Error('The job has an unsupported media link.');
  const options = settings(input);
  const job = {dir, options, files:{}, notes:[], onCaptionStatus: message => console.log(message)};
  await finishDownload(job, source);
  const title = String(job.title || 'media').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/[. ]+$/g,'').slice(0,85);
  const stem = 'Reelfile - ' + (title || 'media');
  for (const [key,f] of Object.entries(job.files)) {
    const suffix = key === 'thumbnail' ? ' - cover' : key === 'captions' ? ' - captions' : '';
    const output = join(dirname(dir), stem + suffix + '.' + f.format);
    await copyFile(f.file,output,constants.COPYFILE_EXCL);
    console.log('Saved ' + output);
  }
  for (const note of job.notes) console.log(note);
  // Only remove recognized regular job files. Never recursively delete a user-supplied directory.
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if (entry.isFile() && /^(?:source(?:\.[\w-]+){1,4}|source-path\.txt|job\.json|media\.[a-z0-9]+|captions\.[a-z0-9]+|chapters\.ffmeta)$/.test(entry.name)) await unlink(join(dir,entry.name));
  }
  try { await rmdir(dir); } catch (error) { if (!['ENOTEMPTY','EBUSY','EPERM'].includes(error.code)) throw error; }
}

main().catch(error => { console.error('Reelfile: ' + error.message); process.exitCode = 1; });
