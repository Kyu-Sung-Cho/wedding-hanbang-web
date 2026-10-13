import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';
import {pinnedArtifact} from './current-baseline-release-contract.mjs';
import {AMORA_WRITER_RETIREMENT_COMPANIONS} from './amora-action-writer-retirement-bundle.mjs';

export const ORIGINAL7_SOURCE_PINS=Object.freeze([
  ['20260906074227_amora_manual_actions_actor_boundary.sql','57da05968e382fd5116f2e7ae53df05503ad49bf836112a975bfbca331154865'],
  ['20260611160000_journey_progress_atomic_merge.sql','c9ecd25ce1be3b16f2b1361926e9b7f7984442a6e2ffe0e74b4de5a009ff4138'],
  ['20260716100000_journey_progress_atomic_item_patch.sql','9442d3a993e97e6f1d92e6c051429b69ccfa1f9e798ca6d93b1077cf598c6637'],
  ['20260731123000_couple_plan_change_write_boundary.sql','78558fed4cc693ca9ac204be7a401ff4ee4451b42534bc70b8b55d4129a6e7db'],
  ['20261012002000_amora_action_view_v2.sql','d8dc07b1e3543bc4530ea9dd3ecd616d4108b7f8739663a4e0237168e9ddc7f3'],
].map(row=>Object.freeze(row)));
const CATALOG=[
  ['mutate_own_amora_action','uuid,text,text,jsonb',0,
    'p_couple_id uuid, p_action_id text, p_operation text, p_values jsonb',null,
    ['search_path=""','lock_timeout=5s','statement_timeout=15s'],'v','authenticated',
    'ae95f4bcada2c3b015ff8f6fb04232b9613a83289ff0c5556f1a8601310c0e14',
    'a327bc32748fffee8ed183a63d200eb60a38feb993b3cb88f1b8e9acbbd174c5'],
  ['update_own_legacy_amora_action','uuid,uuid,text,bigint,jsonb',0,
    'p_couple_id uuid, p_journey_id uuid, p_action_id text, p_expected_revision bigint, p_values jsonb',null,
    ['search_path=""','lock_timeout=5s','statement_timeout=15s'],'v','authenticated',
    '13fa2ab6677021ec6a40469a7249192cc0cec312254994643eefa95034e7b080',
    'b86e33006be7cb718b3df6984ff99f6396117e718a45c0ea2c359eb5abcf83ea'],
  ['apply_journey_progress_patch','uuid,jsonb,text[]',1,
    "p_couple_id uuid, p_patch jsonb DEFAULT '{}'::jsonb, p_remove_keys text[] DEFAULT '{}'::text[]",
    "'{}'::jsonb, '{}'::text[]",['search_path=public'],'v','service_role',
    '08b69e56247aec0b651fd6426f87e2e7e8a4759eed12ccca1990ff0362a6271b',
    '79bf17d9a7be4582f023dc64282ef03fda1c122c5f21ad40c9a6e9b1bf88ebab'],
  ['apply_journey_progress_item_patch','uuid,text,jsonb',2,
    "p_couple_id uuid, p_item_key text, p_item_patch jsonb DEFAULT '{}'::jsonb","'{}'::jsonb",
    ['search_path=pg_catalog, public'],'v','service_role',
    'd443d54b9742baa058ed5e47d3f1707c2d6a8dc5ffa9db767d47ea34ddcaba60',
    '4a5b66228e2ec3aa5a65761035a7625158dd332fbc4890afa966f925a171d1b1'],
  ['normalize_couple_plan_changes','jsonb',3,'p_changes jsonb',null,['search_path=pg_catalog, public'],'i',null,
    'd86abcf6212ac59a0ba5cd58ccca01f39daa83aec03403e572194728db3906ae',
    'e35bd7b0cc475f807cef33ba1c1927b6f487d5ed1eea7df30edc03e54ea145c3'],
  ['apply_couple_plan_change_locked','uuid,uuid',3,'p_request_id uuid, p_apply_user_id uuid',null,
    ['search_path=pg_catalog, public'],'v',null,
    '97787da3e40e519cbcf528c5b92acc26d8f6057b42c45d3e1acee9c8cce905a2',
    'a51233ab23a74178536a995ed8586ff505ac426d432ad1b3dfb21b18834cf4f2'],
  ['patch_own_amora_action_view_v2','uuid,text,text,jsonb',4,
    'p_couple_id uuid, p_action_id text, p_expected_updated_at text, p_values jsonb',null,
    ['search_path=""','lock_timeout=5s','statement_timeout=15s'],'v','authenticated',
    'e6d854ab802fa1797760ffce9803845af3be0da3b88931ca7539610d5beab4f9',
    'db92dc53754786dfc768bcce66c9562205220863debb914621b88329e4746e7c'],
];
export const ORIGINAL7_IDENTITIES=Object.freeze(CATALOG.map(([name,args])=>`public.${name}(${args})`).sort());
const digest=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex');
const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};

function readSource(root,file,sha256) {
  const anchor=realpathSync(root);
  let target=anchor;
  for(const part of ['supabase','migrations',file]) {
    target=join(target,part);requireValue(!lstatSync(target).isSymbolicLink(),'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_LINK_FORBIDDEN');
  }
  const delta=relative(anchor,realpathSync(target));
  requireValue(delta&&!isAbsolute(delta)&&delta!=='..'&&!delta.startsWith(`..${sep}`),'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_PATH_INVALID');
  const before=lstatSync(target),bytes=readFileSync(target),after=lstatSync(target);
  requireValue(before.isFile()&&before.size>0&&before.size<=4*1024*1024&&before.ino===after.ino
    &&before.dev===after.dev&&before.mtimeMs===after.mtimeMs&&before.size===after.size&&bytes.length===before.size
    &&digest(bytes)===sha256,'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_PIN_CHANGED');
  return bytes.toString('utf8');
}
function bodyOf(sql,name) {
  const prefix=new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,'ig');
  const starts=[...sql.matchAll(prefix)];requireValue(starts.length,'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_FUNCTION_MISSING');
  const tail=sql.slice(starts.at(-1).index),match=/\bAS\s+(\$[a-z_]*\$)([\s\S]*?)\1\s*;/i.exec(tail);
  requireValue(match,'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_FUNCTION_MISSING');return match[2];
}
const configuration=config=>config.map(entry=>{
  const split=entry.indexOf('='),name=entry.slice(0,split),value=entry.slice(split+1);
  const values=value==='""'?['']:value.split(', ');
  return ` SET ${name} TO ${values.map(item=>`'${item.replaceAll("'","''")}'`).join(', ')}\n`;
}).join('');

/** 공개 저장소 원문으로만 결정적으로 유도한다. actual private 원문/DB ID/캡처시각을 복사하지 않는다. */
export function deriveFixedOriginal7FromRepo(repoRoot) {
  requireValue(typeof repoRoot==='string','AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_ROOT_INVALID');
  const sources=ORIGINAL7_SOURCE_PINS.map(([file,sha])=>readSource(repoRoot,file,sha));
  return CATALOG.map(([name,args,index,argumentsText,defaults,config,volatility,other,definitionSha256,bodySha256])=>{
    let body=bodyOf(sources[index],name);
    // 승인된 한 기존 progress body의 source-only CRLF bridge다. 관찰한 정의는 normalize하지 않는다.
    if(name==='apply_journey_progress_patch')body=body.replace(/\r?\n/g,'\r\n');
    requireValue(digest(body)===bodySha256,'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_BODY_CHANGED');
    const definition=`CREATE OR REPLACE FUNCTION public.${name}(${argumentsText})\n RETURNS jsonb\n LANGUAGE plpgsql\n`
      +(volatility==='i'?' IMMUTABLE SECURITY DEFINER\n':' SECURITY DEFINER\n')+configuration(config)
      +`AS $function$${body}$function$\n`;
    requireValue(digest(definition)===definitionSha256,'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_DEFINITION_ENVELOPE_MISMATCH');
    const acl=[['postgres','postgres','EXECUTE',false],...(other?[[other,'postgres','EXECUTE',false]]:[])]
      .sort((a,b)=>a[0].localeCompare(b[0]));
    return {identity:`public.${name}(${args})`,definition,definitionSha256,bodySha256,bodyMd5:digest(body,'md5'),
      owner:'postgres',result:'jsonb',language:'plpgsql',securityDefiner:true,config,
      strict:false,volatility,parallel:'u',cost:100,rows:0,support:'-',kind:'f',leakProof:false,returnsSet:false,
      defaultCount:(argumentsText.match(/\bDEFAULT\b/g)||[]).length,arguments:argumentsText,defaults,
      rawAcl:['postgres=X/postgres',...(other?[`${other}=X/postgres`]:[])],acl};
  }).sort((a,b)=>a.identity.localeCompare(b.identity));
}

/** 원본 header/attributes/ACL는 불변이다. 고정 5개 후속 body만 exact 대상으로 재생한다. */
export function deriveFixedApplied7FromRepo(repoRoot) {
  const replacement={mutate_own_amora_action:0,update_own_legacy_amora_action:0,
    apply_journey_progress_patch:1,apply_journey_progress_item_patch:1,
    normalize_couple_plan_changes:2,apply_couple_plan_change_locked:4,patch_own_amora_action_view_v2:4};
  const sources=AMORA_WRITER_RETIREMENT_COMPANIONS.map(([file,sha256])=>pinnedArtifact(repoRoot,{file,sha256}).toString('utf8'));
  return deriveFixedOriginal7FromRepo(repoRoot).map(fn=>{
    const name=fn.identity.slice(7,fn.identity.indexOf('(')),body=bodyOf(sources[replacement[name]],name);
    const marker='$function$',start=fn.definition.indexOf(marker)+marker.length,end=fn.definition.lastIndexOf(marker);
    requireValue(start>=marker.length&&end>start,'AMORA_WRITER_RETIREMENT_RECOVERY_SOURCE_DEFINITION_ENVELOPE_MISMATCH');
    const definition=fn.definition.slice(0,start)+body+fn.definition.slice(end);
    return {...fn,definition,definitionSha256:digest(definition),bodySha256:digest(body),bodyMd5:digest(body,'md5')};
  });
}
