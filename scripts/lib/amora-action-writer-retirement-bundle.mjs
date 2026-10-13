import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';

export const AMORA_WRITER_RETIREMENT_FILE='20261013003000_amora_action_writer_retirement_v1.sql';
export const AMORA_WRITER_RETIREMENT_SHA='9ef6042ce666c054a2e887197bd8fb41be211d9a854731bb90d9d48dc399b649';
export const AMORA_WRITER_RETIREMENT_COMPANIONS=Object.freeze([
  ['supabase/release-candidates/amora-action-writer-cutover-v1/cutover_writer_retirement_identity_v1.sql',
    '25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca'],
  ['supabase/release-candidates/amora-action-writer-retirement-v1/retirement_service_writers_v1.sql',
    '56edb08862ce7e178a35a357abd323954a8b35debd1fe8f2c0906aa51b6588d4'],
  ['supabase/release-candidates/amora-action-writer-retirement-v1/retirement_reserved_plan_writers_v1.sql',
    '20138aab7a821c4e6ddc105b3a480160942800c389157afd500efccc91d2380d'],
  ['supabase/release-candidates/amora-action-writer-retirement-v1/retirement_direct_journey_guard_v1.sql',
    '3b98d9c86e1092fa5e1cd10561cfc1d25cb30e405dfc144320e9e717ddc9103c'],
  ['supabase/release-candidates/amora-action-writer-retirement-v1/transport_conflict_response_v1.sql',
    '63512f8bdaafa2fee69006cf75365c9556ca0fb898b81bfaa36d21582fdf75ee'],
].map(pin=>Object.freeze(pin)));
const PREFIX='-- 정식 마이그레이션 검수 후보: Amora old writer retirement + identity boundary + non-retrying conflict transport. 운영에 적용되거나 승인된 릴리스가 아니다.\nBEGIN;\n';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};

function readFrozen(root,file) {
  requireValue(typeof file==='string'&&!isAbsolute(file)&&!file.includes('\\')
    &&file.split('/').every(part=>part&&part!=='.'&&part!=='..'),'AMORA_WRITER_RETIREMENT_BUNDLE_PATH_INVALID');
  const anchor=realpathSync(root);
  let target=anchor;
  for(const part of file.split('/')) {
    target=join(target,part);requireValue(!lstatSync(target).isSymbolicLink(),'AMORA_WRITER_RETIREMENT_BUNDLE_LINK_FORBIDDEN');
  }
  const delta=relative(anchor,realpathSync(target));
  requireValue(delta&&!isAbsolute(delta)&&delta!=='..'&&!delta.startsWith(`..${sep}`),'AMORA_WRITER_RETIREMENT_BUNDLE_PATH_INVALID');
  const before=lstatSync(target);
  requireValue(before.isFile()&&before.size>0&&before.size<=256*1024,'AMORA_WRITER_RETIREMENT_BUNDLE_SIZE_INVALID');
  const bytes=readFileSync(target),after=lstatSync(target);
  requireValue(before.ino===after.ino&&before.dev===after.dev&&before.mtimeMs===after.mtimeMs
    &&before.size===after.size&&bytes.length===before.size,'AMORA_WRITER_RETIREMENT_BUNDLE_SOURCE_CHANGED');
  return bytes;
}

/** 고정 원문만 exact 합성한다. 임의 SQL/envelope를 승인하거나 실행하는 renderer가 아니다. */
export function buildAmoraWriterRetirementBundle(repoRoot) {
  requireValue(typeof repoRoot==='string','AMORA_WRITER_RETIREMENT_BUNDLE_ROOT_INVALID');
  let sql=PREFIX;
  for(const [file,sha256] of AMORA_WRITER_RETIREMENT_COMPANIONS) {
    const bytes=readFrozen(repoRoot,file);
    requireValue(digest(bytes)===sha256,'AMORA_WRITER_RETIREMENT_COMPANION_HASH_MISMATCH');
    const source=bytes.toString('utf8');
    requireValue(!source.includes('\r'),'AMORA_WRITER_RETIREMENT_COMPANION_ENVELOPE_INVALID');
    const envelope=/^((?:--[^\n]*\n)*)BEGIN;\n([\s\S]*)COMMIT;\n\n?$/.exec(source);
    requireValue(envelope,'AMORA_WRITER_RETIREMENT_COMPANION_ENVELOPE_INVALID');
    sql+=`-- Frozen companion ${file} SHA256 ${sha256}\n`+envelope[1]+envelope[2]+'\n';
  }
  sql+='COMMIT;\n';
  requireValue(digest(sql)===AMORA_WRITER_RETIREMENT_SHA&&Buffer.byteLength(sql)===46366,'AMORA_WRITER_RETIREMENT_BUNDLE_HASH_MISMATCH');
  return Object.freeze({file:AMORA_WRITER_RETIREMENT_FILE,version:AMORA_WRITER_RETIREMENT_FILE.slice(0,14),name:AMORA_WRITER_RETIREMENT_FILE.slice(15,-4),
    sql,sha256:AMORA_WRITER_RETIREMENT_SHA,bytes:Buffer.byteLength(sql),statementsSha256:digest(JSON.stringify([sql])),
    releaseAuthorized:false,remoteWritesPerformed:false});
}
