import assert from 'node:assert/strict';
import {copyFileSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildAmoraWriterRetirementBundle,AMORA_WRITER_RETIREMENT_COMPANIONS} from '../../lib/amora-action-writer-retirement-bundle.mjs';
import {STATIC_PREDECESSOR_PIN} from '../../lib/amora-action-writer-retirement-release-contract.mjs';

/** Owned source-only fixture, not Git/CI/operating provenance. No destination or identity override. */
export function createAmoraWriterRetirementSourceRepository() {
  const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
  const artifact=JSON.parse(readFileSync(join(repoRoot,STATIC_PREDECESSOR_PIN.file),'utf8'));
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'hanbang-b2-owned-source-'));
  const marker='source242-only-not-operating-provenance';
  writeFileSync(join(root,'.owner'),marker,{flag:'wx'});
  try {
    for(const file of [...artifact.dependencyPins.map(row=>row.file),STATIC_PREDECESSOR_PIN.file,...AMORA_WRITER_RETIREMENT_COMPANIONS.map(row=>row[0])]) {
      const target=join(root,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(repoRoot,file),target);
    }
    const bundle=buildAmoraWriterRetirementBundle(root);
    writeFileSync(join(root,'supabase/migrations',bundle.file),bundle.sql,{flag:'wx'});
  } catch(error) {close();throw error;}
  function close() {
    const target=realpathSync(root),delta=relative(parent,target);
    assert.ok(delta.startsWith('hanbang-b2-owned-source-')&&!delta.includes(sep)&&!lstatSync(root).isSymbolicLink());
    assert.equal(readFileSync(join(target,'.owner'),'utf8'),marker);
    rmSync(target,{recursive:true,force:false});
  }
  return {root,close,sourceProvenanceVerified:false,releaseAuthorized:false};
}
