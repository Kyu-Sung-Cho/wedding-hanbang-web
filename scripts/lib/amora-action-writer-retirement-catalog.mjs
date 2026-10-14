import {createHash} from 'node:crypto';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {buildAmoraWriterRetirementPrivilegesObservationSql,validateAmoraWriterRetirementPrivilegesObservation} from './amora-action-writer-retirement-privileges.mjs';
import {validateAmoraWriterRetirementLedger} from './amora-action-writer-retirement-recovery.mjs';
import {amoraWriterRetirementPreservedCatalogSql,amoraWriterRetirementRowsSql,amoraWriterRetirementLedgerSql,amoraWriterRetirementRawLedgerShaSql,amoraWriterRetirementRawLedgerMd5Sql} from './amora-action-writer-retirement-state.mjs';

const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};
const keys=(value,expected)=>requireValue(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===expected.slice().sort().join(','),'AMORA_WRITER_CATALOG_SHAPE_INVALID');
const same=(a,b)=>requireValue(JSON.stringify(a)===JSON.stringify(b),'AMORA_WRITER_CATALOG_PRESERVED_DRIFT');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const md5=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);

export function buildAmoraWriterRetirementObservationSql(value) {
  keys(value,['repoRoot','phase']);
  const source=buildAmoraWriterRetirementPrivilegesObservationSql(value);
  const start=source.indexOf('SELECT jsonb_build_object('),end=source.lastIndexOf(' AS observation;');
  requireValue(start>=0&&end>start,'AMORA_WRITER_CATALOG_SQL_INVALID');
  const privileges=source.slice(start+7,end);
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','amora-writer-retirement-original7-observation-v1','phase','${value.phase}',
 'privileges',${privileges},'rows',${amoraWriterRetirementRowsSql()},'preservedCatalogSha256',${amoraWriterRetirementPreservedCatalogSql()},
 'ledger',${amoraWriterRetirementLedgerSql()},'rawLedgerSha256',${amoraWriterRetirementRawLedgerShaSql()},
 'rawLedgerMd5',${amoraWriterRetirementRawLedgerMd5Sql()}) AS b2_observation;
COMMIT;
`;
}

/** Pure content validation only. Runtime must issue its own actual observation proof; caller JSON is not authority. */
export function validateAmoraWriterRetirementObservation(raw,value) {
  keys(value,['repoRoot','phase','expectedNativeSystemIdentifier','beforeObservation']);
  keys(raw,['format','phase','privileges','rows','preservedCatalogSha256','ledger','rawLedgerSha256','rawLedgerMd5']);
  requireValue(raw.format==='amora-writer-retirement-original7-observation-v1'&&raw.phase===value.phase,'AMORA_WRITER_CATALOG_SOURCE_INVALID');
  const p=loadAmoraWriterRetirementPlan({repoRoot:value.repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const before=value.beforeObservation;
  if(value.phase==='after')requireValue(before?.phase==='before','AMORA_WRITER_CATALOG_BEFORE_REQUIRED');
  else requireValue(before===null,'AMORA_WRITER_CATALOG_BEFORE_REQUIRED');
  validateAmoraWriterRetirementPrivilegesObservation(raw.privileges,{...value,beforeObservation:before?.privileges??null});
  keys(raw.rows,['amoraActionsCount','amoraActionsSha256','journeysCount','journeysSha256']);
  requireValue(['amoraActionsCount','journeysCount'].every(key=>Number.isSafeInteger(raw.rows[key])&&raw.rows[key]>=0)
    &&['amoraActionsSha256','journeysSha256'].every(key=>sha(raw.rows[key]))&&sha(raw.preservedCatalogSha256)
    &&sha(raw.rawLedgerSha256)&&md5(raw.rawLedgerMd5),'AMORA_WRITER_CATALOG_DIGEST_INVALID');
  if(value.expectedNativeSystemIdentifier===null)validateAmoraWriterRetirementLedger(raw.ledger,value.phase==='before'?p.expectedBefore230:p.expectedAfter231);
  else requireValue(Array.isArray(raw.ledger)&&raw.ledger.length===(value.phase==='before'?230:231),'AMORA_WRITER_CATALOG_NATIVE_LEDGER_INVALID');
  if(before) {
    validateAmoraWriterRetirementObservation(before,{...value,phase:'before',beforeObservation:null});
    same(raw.rows,before.rows);
    same(raw.preservedCatalogSha256,before.preservedCatalogSha256);
  }
  return Object.freeze({format:raw.format,status:'catalog-compatible-'+value.phase,phase:value.phase,
    sourceSha256:raw.privileges.sourceSha256,observedAt:raw.privileges.observedAt,systemIdentifier:raw.privileges.systemIdentifier,
    rawLedgerMd5:raw.rawLedgerMd5,rawLedgerSha256:raw.rawLedgerSha256,preservedCatalogSha256:raw.preservedCatalogSha256,
    observationSha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    collectorExecutionProvenanceVerified:false,privateRecoveryVerified:false,nativeReplayVerified:false,releaseAuthorized:false,remoteWritesPerformed:false});
}
