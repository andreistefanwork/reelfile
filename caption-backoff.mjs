import {setTimeout as sleep} from 'node:timers/promises';

const retries = 3;
const waitBudget = 10 * 60_000;

export function retryAfterTime(header, now = Date.now()) {
  const value = String(header ?? '').trim();
  if (/^\d+$/.test(value)) return now + Number(value) * 1000;
  if (!/[A-Za-z]{3}/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

export class CaptionRequestError extends Error {
  constructor(language, transcript, limited, header) {
    const retryAt = limited ? retryAfterTime(header) : null;
    const reason = limited ? 'The source rate-limited the ' + language + ' caption request (HTTP 429).' : 'The ' + language + ' caption track could not be retrieved.';
    const until = retryAt > Date.now() && retryAt <= 8.64e15 ? ' The source asks to wait until ' + new Date(retryAt).toISOString() + '.' : '';
    super(reason + until + (transcript ? ' Try the transcript again later.' : ' The media will be saved without captions.'));
    this.limited = limited;
    this.retryAt = retryAt;
  }
}

// The provider's minimum always wins. If it exceeds the remaining budget, return the
// original error with that time, rather than clamping the delay and retrying early.
export async function withCaptionBackoff(request, notify, {wait = sleep, now = Date.now, random = Math.random} = {}) {
  let waited = 0;
  for (let n = 0; ; n++) {
    try { return await request(); }
    catch (error) {
      if (!(error instanceof CaptionRequestError) || !error.limited || n >= retries) throw error;
      const time = now();
      const delay = Math.max(Math.ceil(30_000 * 2 ** n * (1 + random() / 10)), (error.retryAt ?? time) - time);
      if (delay > waitBudget - waited) throw error;
      waited += delay;
      const when = new Date(time + delay).toISOString().slice(11,19) + ' UTC';
      notify('Caption request rate-limited (HTTP 429). Retry ' + (n+1) + ' of ' + retries + ' at ' + when + '.');
      await wait(delay);
      notify('Requesting captions again (retry ' + (n+1) + ' of ' + retries + ')…');
    }
  }
}
