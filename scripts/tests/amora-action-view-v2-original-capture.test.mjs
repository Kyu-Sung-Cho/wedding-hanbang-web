import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-original-capture.mjs',import.meta.url);
test('actual original capture refuses a non-exact source before transport or private artifact creation',async()=>{
  const {captureAmoraActionViewV2PrivateOriginal}=await import(moduleUrl);
  let queries=0,stores=0;
  await assert.rejects(captureAmoraActionViewV2PrivateOriginal({repoRoot,expectedCommit:'0'.repeat(40),
    query:async()=>{queries++;throw new Error('not expected');},storeFactory:()=>{stores++;throw new Error('not expected');}}),
  error=>error.code==='AMORA_VIEW_V2_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  assert.equal(queries,0);assert.equal(stores,0);
});
test('missing inspection cannot be replaced with a caller verified assertion',async()=>{
  const {captureAmoraActionViewV2PrivateOriginal}=await import(moduleUrl);
  let queries=0,stores=0;
  await assert.rejects(captureAmoraActionViewV2PrivateOriginal({repoRoot,expectedCommit:'0'.repeat(40),verified:true,
    query:async()=>{queries++;return [];},storeFactory:()=>{stores++;}}),
  error=>error.code==='AMORA_VIEW_V2_CAPTURE_ARGUMENT_INVALID');
  assert.equal(queries,0);assert.equal(stores,0);
});
