import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {createAmoraWriterRetirementSourceRepository} from './amora-action-writer-retirement-source-repository.mjs';

const COMMIT='56e564b0f2653a22f40ca1c07f1eb8e75f9d7fd1';
const paths=['supabase/migrations','supabase/release-contracts','supabase/release-manifests',
  'scripts/lib','scripts/supabase-release-fence.mjs','.github/workflows/ci.yml'];

// Test-only exact predecessor. Never discover current SQL and subtract an unreviewed migration.
export function createWeddingCode36PredecessorRepository(sourceRoot) {
  const fixture=createAmoraWriterRetirementSourceRepository();
  const git=(args,input)=>execFileSync('git',['--no-replace-objects','-C',sourceRoot,'-c','protocol.allow=never',...args],{
    encoding:null,input,windowsHide:true,timeout:30_000,maxBuffer:32*1024*1024,
    stdio:['pipe','pipe','pipe'],env:{...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^git_/i.test(name))),
      GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'},
  });
  try {
    const pins=git(['ls-tree','-r','-l',COMMIT,'--',...paths]).toString('utf8').trim().split('\n').map(line=>{
      const match=/^100644 blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/u.exec(line);
      assert.ok(match,'predecessor Git tree is unavailable');
      const file=match[3];
      assert.ok(!file.includes('\\')&&!file.includes(':')&&file.split('/').every(part=>part&&part!=='.'&&part!=='..'));
      return {oid:match[1],bytes:Number(match[2]),file};
    });
    assert.equal(pins.filter(pin=>pin.file.startsWith('supabase/migrations/')).length,242);
    const originals=git(['cat-file','--batch'],pins.map(pin=>pin.oid).join('\n')+'\n');
    let cursor=0;
    for(const pin of pins) {
      const end=originals.indexOf(10,cursor);
      assert.ok(end>=cursor);assert.equal(originals.subarray(cursor,end).toString('ascii'),`${pin.oid} blob ${pin.bytes}`);
      const bytes=originals.subarray(end+1,end+1+pin.bytes);
      cursor=end+1+pin.bytes;assert.equal(originals[cursor++],10);
      assert.equal(bytes.length,pin.bytes);
      assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),pin.oid);
      const target=join(fixture.root,pin.file),delta=relative(fixture.root,target);
      assert.ok(delta&&!delta.startsWith(`..${sep}`));
      mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
    }
    assert.equal(cursor,originals.length);
    return {...fixture,sourceCommit:COMMIT,sourceProvenanceVerified:false,releaseAuthorized:false};
  } catch(error) {fixture.close();throw error;}
}
