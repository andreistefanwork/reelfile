import { settings } from './media-options.mjs?v=3';
import { parseSource } from './source-url.mjs';
import { captionsOnly, fetchSection, sourceArgs } from './extraction.mjs?v=4';

// A saved command must keep its export behavior when the site changes.
const revision = '96b6c4b38688bc7753ceebeb266b7d962d1988eb';
const finisher = 'https://codeload.github.com/andreistefanwork/reelfile/tar.gz/' + revision;
const npmArgs = ['--prefix','.','exec','--yes','--ignore-scripts','--no-audit','--no-fund','--package=' + finisher,'--'];
const finishArgs = [...npmArgs,'reelfile-finish'];

function literal(value) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
function command(executable, args) {
  const words = args.map(arg => /^[a-zA-Z0-9_./:=+,-]+$/.test(arg) ? arg : literal(arg));
  return [executable,...words].join(' ');
}

function cmdCommand(config, needsMedia) {
  // Only expansion-free ASCII reaches CMD, including through CALL's second parsing pass.
  const {url,...options} = config;
  let source = ['--url',url];
  if (!/^[A-Za-z0-9_./:?=-]+$/.test(url)) {
    const bytes = String.fromCharCode(...new TextEncoder().encode(url));
    source = ['--url64',btoa(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')];
  }
  const prepare = ['call','npm.cmd',...npmArgs,'reelfile-prepare',...source];
  for (const [key,value] of Object.entries(options)) {
    prepare.push('--' + key);
    if (value !== true) prepare.push(value);
  }
  const steps = ['mkdir %D','cd %D',prepare.join(' ')];
  if (needsMedia) steps.push('cd .reelfile-work','yt-dlp --ignore-config --config-locations source.conf --batch-file source.urls','cd ..');
  steps.push(['call','npm.cmd',...finishArgs].join(' '));
  // One % is the interactive FOR syntax. A fresh child shell contains directory changes.
  const line = 'for %D in (Reelfile-%RANDOM%-%RANDOM%-%RANDOM%) do cmd.exe /d /s /v:off /c "' + steps.join(' && ') + '"';
  if (line.length > 8191) throw Error('This link exceeds the Command Prompt line length. Use a shorter media link.');
  return line;
}

export function localCommand(payload, shell) {
  if (!['posix','cmd'].includes(shell)) throw Error('Choose a terminal.');
  const source = parseSource(payload.url);
  if (!source) throw Error('Use a supported public media link.');
  const o = settings(payload);
  const commons = Boolean(source.commonsName);
  const config = {url:source.url,format:o.format};
  for (const key of ['resolution','fps','videoCodec','audioCodec','bitrate','audioLang','subLang','subSource','subFormat']) {
    if (o[key]) config[key] = o[key];
  }
  if (o.captions !== 'only' && o.captions !== 'off') config.captions = o.captions;
  for (const key of ['metadata','chapters','thumbnail']) if (o[key]) config[key] = true;
  if (o.start) config.start = String(o.start);
  if (o.end !== null) config.end = String(o.end);
  const needsMedia = !captionsOnly(o,commons);
  if (shell === 'cmd') return cmdCommand(config,needsMedia);

  const data = literal(JSON.stringify(config));
  const args = sourceArgs(o,source.url,fetchSection(o,source.url),commons,true);
  // Commons' redirect adds tracking parameters to embedded metadata. Resolve the original CDN URL.
  const resolveCommons = commons && needsMedia && command('node',['-e',
    "const n=decodeURIComponent(process.argv[1]);const h=require('node:crypto').createHash('md5').update(n).digest('hex');process.stdout.write('https://upload.wikimedia.org/wikipedia/commons/'+h[0]+'/'+h.slice(0,2)+'/'+encodeURIComponent(n))",
    '--',encodeURIComponent(source.commonsName)]);
  let extract = null;
  if (needsMedia) extract = resolveCommons ? command('yt-dlp',args.slice(0,-1)) + ' "$sourceUrl"' : command('yt-dlp',args);
  return [
    '(', '  set -e', '  cd "$(mktemp -d ./Reelfile-XXXXXXXX)"',
    '  mkdir .reelfile-work', "  printf '%s\\n' " + data + ' > .reelfile-work/job.json',
    ...(resolveCommons ? ['  sourceUrl=$(' + resolveCommons + ')'] : []),
    ...(extract ? ['  (cd .reelfile-work && ' + extract + ')'] : []),
    '  ' + command('npm',finishArgs), ')',
  ].join('\n');
}
