import { settings } from './media-options.mjs';
import { parseSource } from './source-url.mjs';
import { captionsOnly, fetchSection, sourceArgs } from './extraction.mjs';

// Pin the finishing code: a saved command must keep its export behavior when the site changes.
const revision = '528ac7d2f3dcbe785244bcffb91ddda36ec2e0f9';
const finisher = 'https://codeload.github.com/andreistefanwork/reelfile/tar.gz/' + revision;
const finishArgs = ['--prefix','.','exec','--yes','--ignore-scripts','--no-audit','--no-fund','--package=' + finisher,'--','reelfile-finish'];

function literal(value, shell) {
  // All inputs go into single-quoted literals, including the URL and the job description.
  return "'" + value.replaceAll("'",shell === 'powershell' ? "''" : "'\"'\"'") + "'";
}
function command(executable, args, shell) {
  const words = args.map(arg => /^[a-zA-Z0-9_./:=+,-]+$/.test(arg) ? arg : literal(arg,shell));
  return [executable,...words].join(' ');
}

export function localCommand(payload, shell) {
  if (!['posix','powershell'].includes(shell)) throw Error('Choose a terminal.');
  const source = parseSource(payload.url);
  if (!source) throw Error('Use a supported public media link.');
  const o = settings(payload);
  const commons = Boolean(source.commonsName);
  const config = {url:source.url,format:o.format};
  // Record validated settings in a data file so the terminal never interprets them as code.
  for (const key of ['resolution','fps','videoCodec','audioCodec','bitrate','audioLang','subLang','subSource','subFormat']) {
    if (o[key]) config[key] = o[key];
  }
  if (o.captions !== 'only' && o.captions !== 'off') config.captions = o.captions;
  for (const key of ['metadata','chapters','thumbnail']) if (o[key]) config[key] = true;
  if (o.start) config.start = String(o.start);
  if (o.end !== null) config.end = String(o.end);
  const data = literal(JSON.stringify(config),shell);
  const args = sourceArgs(o,source.url,fetchSection(o,source.url),commons,true);
  // Resolve the same CDN URL as the server. Commons' file redirect adds tracking tags to embedded metadata.
  const resolveCommons = commons && !captionsOnly(o,commons) && command('node',['-e',
    "const n=decodeURIComponent(process.argv[1]);const h=require('node:crypto').createHash('md5').update(n).digest('hex');process.stdout.write('https://upload.wikimedia.org/wikipedia/commons/'+h[0]+'/'+h.slice(0,2)+'/'+encodeURIComponent(n))",
    '--',encodeURIComponent(source.commonsName)],shell);
  let extract = null;
  if (!captionsOnly(o,commons)) {
    extract = resolveCommons ? command('yt-dlp',args.slice(0,-1),shell) + ' "$sourceUrl"' : command('yt-dlp',args,shell);
  }

  if (shell === 'powershell') {
    return [
      '& {',
      "  $ErrorActionPreference = 'Stop'",
      "  $out = New-Item -ItemType Directory -Path ('Reelfile-' + [guid]::NewGuid().ToString('N'))",
      '  Push-Location -LiteralPath $out.FullName',
      '  try {',
      "    $work = New-Item -ItemType Directory -Path '.reelfile-work'",
      "    [IO.File]::WriteAllText([IO.Path]::Combine($work.FullName, 'job.json'), " + data + ')',
      ...(resolveCommons ? ['    $sourceUrl = ' + resolveCommons,
        "    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the Wikimedia file.' }"] : []),
      ...(extract ? ['    Push-Location -LiteralPath $work.FullName','    try {','      ' + extract,
        "      if ($LASTEXITCODE -ne 0) { throw 'yt-dlp failed.' }",'    } finally { Pop-Location }'] : []),
      '    ' + command('npm.cmd',finishArgs,shell),
      "    if ($LASTEXITCODE -ne 0) { throw 'Reelfile could not finish the export.' }",
      '  } finally { Pop-Location }',
      '}',
    ].join('\n');
  }
  return [
    '(', '  set -e', '  cd "$(mktemp -d ./Reelfile-XXXXXXXX)"',
    '  mkdir .reelfile-work', "  printf '%s\\n' " + data + ' > .reelfile-work/job.json',
    ...(resolveCommons ? ['  sourceUrl=$(' + resolveCommons + ')'] : []),
    ...(extract ? ['  (cd .reelfile-work && ' + extract + ')'] : []),
    '  ' + command('npm',finishArgs,shell), ')',
  ].join('\n');
}
