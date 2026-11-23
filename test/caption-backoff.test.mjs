import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterTime, CaptionRequestError, withCaptionBackoff} from '../caption-backoff.mjs';
import {mediaError} from '../download.mjs';

const limited = () => new CaptionRequestError('Romanian',true,true);
const noop = () => {};
function fakeClock() {
  let time = Date.now();
  const delays = [];
  return {delays, now:()=>time, random:()=>0, wait:async ms => {delays.push(ms); time+=ms;}};
}

test('retries only 429s, with three exponentially increasing delays', async () => {
  const clock = fakeClock();
  let attempts = 0;
  await assert.rejects(withCaptionBackoff(async()=>{attempts++;throw limited();},noop,clock),/HTTP 429/);
  assert.equal(attempts,4);
  assert.deepEqual(clock.delays,[30000,60000,120000]);
  for (const error of [new CaptionRequestError('Romanian',false,false),new Error('HTTP 403')]) {
    let called = 0;
    await assert.rejects(withCaptionBackoff(()=>{called++;throw error;},noop,clock), e=>e===error);
    assert.equal(called,1);
  }
});

test('waits at least Retry-After and stops immediately on success', async () => {
  const clock=fakeClock(), messages=[];
  let calls=0;
  const result=await withCaptionBackoff(()=>{
    if (++calls===2) return 'Romanian SRT';
    const e=limited();e.retryAt=clock.now()+95000;throw e;
  },m=>messages.push(m),clock);
  assert.equal(result,'Romanian SRT');
  assert.deepEqual(clock.delays,[95000]);
  assert.match(messages[0],/Retry 1 of 3/);
});

test('accepts HTTP dates and integer seconds; never shortens a long or unrepresentable cooldown',async()=>{
  const now=Date.UTC(2026,10,23,12);
  assert.equal(retryAfterTime('75',now),now+75000);
  assert.equal(retryAfterTime('Mon, 23 Nov 2026 12:02:00 GMT',now),now+120000);
  assert.equal(retryAfterTime('-1',now),null);
  assert.equal(retryAfterTime('invalid',now),null);
  const clock=fakeClock();
  for(const header of ['3600','9'.repeat(400)]) {
    const e=new CaptionRequestError('Romanian',true,true,header);
    await assert.rejects(withCaptionBackoff(()=>{throw e;},noop,clock),err=>err===e);
  }
  assert.deepEqual(clock.delays,[]);
});

test('upstream media rate limits and bot checks produce distinct instructions',()=>{
  assert.match(mediaError('ERROR: [youtube] Sign in to confirm you’re not a bot'),/bot or IP check.*Copy terminal command/);
  assert.match(mediaError('HTTP Error 429: Too Many Requests'),/hosted media request.*HTTP 429.*before caption processing/);
  assert.doesNotMatch(mediaError('private video'),/HTTP 429|bot or IP/);
});

test('a series of allowed cooldowns cannot exhaust the budget and trigger an early retry', async () => {
  const clock=fakeClock();
  let attempts=0;
  await assert.rejects(withCaptionBackoff(()=>{
    attempts++;
    const err=limited();
    err.retryAt=clock.now()+360000;
    throw err;
  },noop,clock),/429/);
  assert.equal(attempts,2);
  assert.deepEqual(clock.delays,[360000]);
});
