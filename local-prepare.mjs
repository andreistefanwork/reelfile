#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { canonicalSource } from './sources.mjs';
import { settings } from './web/media-options.mjs';
import { captionsOnly, fetchSection, sourceArgs } from './web/extraction.mjs';

async function main() {
  const options = {};
  for (const key of ['url','url64','format','resolution','fps','videoCodec','audioCodec','bitrate','audioLang','captions','subLang','subSource','subFormat','start','end']) {
    options[key] = {type:'string'};
  }
  for (const key of ['metadata','chapters','thumbnail']) options[key] = {type:'boolean'};
  const {values} = parseArgs({options});
  const {url64, ...job} = values;
  if (url64) job.url = Buffer.from(url64,'base64url').toString('utf8');
  const source = canonicalSource(job.url);
  if (!source) throw Error('Use a supported public media link.');
  const o = settings(job);
  const dir = '.reelfile-work';
  await mkdir(dir);
  await writeFile(dir + '/job.json',JSON.stringify(job));
  const commons = source.startsWith('https://upload.wikimedia.org/');
  if (captionsOnly(o, commons)) return;

  // yt-dlp reads its own POSIX-style config on Windows, keeping percent templates,
  // exclamation marks and other media arguments out of CMD's expansion rules.
  const args = sourceArgs(o,source,fetchSection(o,source),commons,true).slice(0,-2);
  const conf = args.map(arg => "'" + arg.replaceAll("'", "'\"'\"'") + "'").join('\n');
  await writeFile(dir + '/source.conf','# coding: utf-8\n' + conf + '\n');
  await writeFile(dir + '/source.urls',source + '\n');
}
main().catch(error => { console.error('Reelfile: ' + error.message); process.exitCode = 1; });
