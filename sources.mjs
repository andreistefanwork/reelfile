import { createHash } from 'node:crypto';
import { parseSource } from './web/source-url.mjs';

export function canonicalSource(input) {
  const source = parseSource(input);
  if (!source) return null;
  if (!source.commonsName) return source.url;
  const digest = createHash('md5').update(source.commonsName).digest('hex');
  return 'https://upload.wikimedia.org/wikipedia/commons/' + digest[0] + '/' + digest.slice(0, 2) + '/' + encodeURIComponent(source.commonsName);
}
