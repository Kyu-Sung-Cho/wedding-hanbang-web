import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {readAmoraWriterRetirementBoundedJsonResponse} from '../lib/amora-action-writer-retirement-http.mjs';

test('actual Response body stops and cancels as soon as received bytes exceed the fixed 256KiB cap',async()=>{
  let pulled=0,cancelled=0;
  const response=new Response(new ReadableStream({
    pull(controller){pulled++;controller.enqueue(new Uint8Array(65536));if(pulled===10)controller.close();},
    cancel(){cancelled++;},
  },{highWaterMark:0}));
  await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(response,{signal:new AbortController().signal}),
    /AMORA_WRITER_CAPTURE_UNAVAILABLE/);
  assert.equal(cancelled,1);
  assert.equal(pulled,5,'no full response is buffered after the first over-limit chunk');
  assert.equal(response.body.locked,false);
});

test('an exact 256KiB UTF-8 JSON body remains readable across split multibyte sequences',async()=>{
  const json=Buffer.from(JSON.stringify({text:'한글 원본7'}));
  const bytes=Buffer.concat([json,Buffer.alloc(262144-json.length,32)]);
  let offset=0;
  const response=new Response(new ReadableStream({pull(controller){
    if(offset===bytes.length){controller.close();return;}
    const length=offset===0?11:4093;
    controller.enqueue(new Uint8Array(bytes.subarray(offset,Math.min(offset+length,bytes.length))));
    offset=Math.min(offset+length,bytes.length);
  }},{highWaterMark:0}));
  const signal=new AbortController().signal;
  assert.deepEqual(await readAmoraWriterRetirementBoundedJsonResponse(response,{signal}),{text:'한글 원본7'});
  assert.equal(response.body.locked,false);
  assert.equal(getEventListeners(signal,'abort').length,0);
});

test('abort releases a never-ending actual stream even if its cancel promise never settles',async()=>{
  let cancelled=0,pulled=0,markPull;
  const started=new Promise(resolve=>{markPull=resolve;});
  const response=new Response(new ReadableStream({
    pull(){pulled++;markPull();return new Promise(()=>{});},
    cancel(){cancelled++;return new Promise(()=>{});},
  },{highWaterMark:0}));
  const controller=new AbortController(),baseline=getEventListeners(controller.signal,'abort').length;
  const task=readAmoraWriterRetirementBoundedJsonResponse(response,{signal:controller.signal});
  await started;
  controller.abort();
  await assert.rejects(task,/^Error: AMORA_WRITER_CAPTURE_UNAVAILABLE$/);
  assert.equal(cancelled,1);assert.equal(pulled,1);
  assert.equal(response.body.locked,false);
  assert.equal(getEventListeners(controller.signal,'abort').length,baseline);
});

test('a response arriving after abort is cancelled without accepting its otherwise valid JSON',async()=>{
  const controller=new AbortController();controller.abort();
  let cancelled=0,pulled=0;
  const response=new Response(new ReadableStream({
    pull(stream){pulled++;stream.enqueue(new TextEncoder().encode('[{"late":true}]'));stream.close();},
    cancel(){cancelled++;},
  },{highWaterMark:0}));
  await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(response,{signal:controller.signal}),/AMORA_WRITER_CAPTURE_UNAVAILABLE/);
  assert.equal(pulled,0);assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});

test('HTTP failures cancel unread private bodies and surface only the fixed safe error',async()=>{
  const secret='synthetic-private-response-content-not-a-real-credential';
  let cancelled=0,pulled=0;
  const response=new Response(new ReadableStream({
    pull(stream){pulled++;stream.enqueue(new TextEncoder().encode(secret));},
    cancel(){cancelled++;},
  },{highWaterMark:0}),{status:503});
  await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(response,{signal:new AbortController().signal}),error=>
    error.message==='AMORA_WRITER_CAPTURE_UNAVAILABLE'&&!error.stack.includes(secret)&&error.cause===undefined);
  assert.equal(cancelled,1);assert.equal(pulled,0);assert.equal(response.body.locked,false);
});

test('null, empty, invalid JSON, invalid UTF-8 and stream errors never expose raw source or upstream errors',async()=>{
  const secret='synthetic-private-definition-or-token-value';
  const responses=[new Response(null),new Response(''),new Response(secret),new Response(new Uint8Array([0xc3,0x28])),
    new Response(new ReadableStream({start(stream){stream.error(new Error(secret));}}))];
  for(const response of responses) {
    const signal=new AbortController().signal;
    await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(response,{signal}),error=>
      error.message==='AMORA_WRITER_CAPTURE_UNAVAILABLE'&&!error.stack.includes(secret)&&error.cause===undefined);
    assert.equal(response.body?.locked??false,false);
    assert.equal(getEventListeners(signal,'abort').length,0);
  }
});

test('UTF-8 byte count, not smaller string character length, controls the fixed resource cap',async()=>{
  let cancelled=0;
  const bytes=Buffer.from(JSON.stringify({text:'한'.repeat(90000)}));
  assert.ok(bytes.length>262144);assert.ok(bytes.toString('utf8').length<262144);
  let offset=0;
  const response=new Response(new ReadableStream({pull(stream){
    stream.enqueue(new Uint8Array(bytes.subarray(offset,offset+65536)));offset+=65536;
    if(offset>=bytes.length)stream.close();
  },cancel(){cancelled++;}},{highWaterMark:0}));
  await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(response,{signal:new AbortController().signal}),/AMORA_WRITER_CAPTURE_UNAVAILABLE/);
  assert.equal(response.body.locked,false);
  // The source already closed in the final over-limit pull; there is no remaining stream to cancel.
  assert.equal(cancelled,0);
});

test('unknown options, forged response objects and missing signals cannot start a body reader',async()=>{
  let reads=0;
  const forged={ok:true,text(){reads++;return '{}';},body:{getReader(){reads++;}}};
  for(const options of [undefined,{},null,{signal:new AbortController().signal,maximumBytes:999999}])
    await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(forged,options),/AMORA_WRITER_CAPTURE_UNAVAILABLE/);
  assert.equal(reads,0);
});

test('an already-locked actual response is rejected with the same safe error without releasing another reader',async()=>{
  const response=new Response('{}'),existing=response.body.getReader();
  try {
    await assert.rejects(readAmoraWriterRetirementBoundedJsonResponse(response,{signal:new AbortController().signal}),
      error=>error.message==='AMORA_WRITER_CAPTURE_UNAVAILABLE');
    assert.equal(response.body.locked,true);
    assert.equal((await existing.read()).done,false);
  } finally {await existing.cancel();existing.releaseLock();}
});
