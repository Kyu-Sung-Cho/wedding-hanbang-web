import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPrivilegeDatabase} from '../../../supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs';
import {buildAmoraWriterRetirementBundle,AMORA_WRITER_RETIREMENT_COMPANIONS} from '../../lib/amora-action-writer-retirement-bundle.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE,STATIC_PREDECESSOR_PIN} from '../../lib/amora-action-writer-retirement-release-contract.mjs';

const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const owner='owned-amora-maintenance-source242-native-only';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function ownedSource(){
  const raw=readFileSync(join(repoRoot,STATIC_PREDECESSOR_PIN.file));
  assert.equal(sha(raw),STATIC_PREDECESSOR_PIN.sha256,'Actual fixed static predecessor required before copying files');
  const artifact=JSON.parse(raw.toString('utf8'));
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'hanbang-amora-maintenance-source-'));
  writeFileSync(join(root,'.owner'),owner,{flag:'wx'});
  const close=()=>{
    const target=realpathSync(root),delta=relative(parent,target);
    assert.ok(delta.startsWith('hanbang-amora-maintenance-source-')&&!delta.includes(sep)&&!lstatSync(root).isSymbolicLink());
    assert.equal(readFileSync(join(target,'.owner'),'utf8'),owner);
    rmSync(target,{recursive:true,force:false});
  };
  try{
    for(const file of [...artifact.dependencyPins.map(pin=>pin.file),STATIC_PREDECESSOR_PIN.file,
      ...AMORA_WRITER_RETIREMENT_COMPANIONS.map(([file])=>file)]){
      const target=join(root,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(repoRoot,file),target);
    }
    const bundle=buildAmoraWriterRetirementBundle(root);
    writeFileSync(join(root,'supabase/migrations',bundle.file),bundle.sql,{flag:'wx'});
    return {root,bundle,close};
  }catch(error){close();throw error;}
}
export const maintenanceLedgerSql=`SELECT count(*)::int AS count,
  md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
    ORDER BY version)::text,'[]')) AS md5 FROM supabase_migrations.schema_migrations`;

/** 실제 owned PG17과 실제 함수 원문이다. 역사215 statements의 대체문은 명시적 합성값이며 운영 원장 PASS가 아니다. */
export async function createMaintenanceNativeDatabase(){
  const source=ownedSource();let f;
  try{
    const plan=loadAmoraWriterRetirementPlan({repoRoot:source.root,mode:AMORA_WRITER_RETIREMENT_MODE});
    assert.equal(sha(readFileSync(join(repoRoot,'supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs'))),
      '698f10019a144fd44c98e125576d12f2d781ebecd810468653ea471effef2f13','Original frozen native fixture must remain unchanged');
    f=await createPrivilegeDatabase({phase:'before'});
    const sql=readFileSync(join(source.root,'supabase/migrations/20260731123000_couple_plan_change_write_boundary.sql'),'utf8');
    const highImpact=sql.match(/CREATE OR REPLACE FUNCTION public\.couple_plan_change_is_high_impact\([\s\S]*?\$function\$;/)?.[0];
    assert.ok(highImpact,'Real high-impact dependency source required');await f.exec(highImpact);
    await f.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
    for(const row of plan.expectedBefore230){
      // 역사 원문을 보유한 것처럼 해시를 대입하지 않는다. 이 실제 값의 raw digest만 전후 보존 검증한다.
      const statements=row.statementsSha256===null?null:[`SYNTHETIC-LOCAL-HISTORY-ONLY:${row.version}:${row.name}`];
      await f.db.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',[row.version,row.name,statements]);
    }
    const system=(await f.db.query('SELECT system_identifier::text AS system FROM pg_control_system()')).rows[0].system;
    assert.notEqual(system,'7581440907192989109');
    return {...f,sourceRoot:source.root,plan,system,
      operationalLedgerVerified:false,fullSchemaVerified:false,executionProvenanceVerified:false,releaseAuthorized:false,
      async installB2(client=f.db){
        const actual=buildAmoraWriterRetirementBundle(source.root);
        assert.equal(actual.sha256,source.bundle.sha256);
        const body=actual.sql.slice(actual.sql.indexOf('BEGIN;')+'BEGIN;'.length).replace(/COMMIT;\n$/,'');
        await client.query('BEGIN');
        try{
          await client.query(body);
          await client.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',[actual.version,actual.name,[actual.sql]]);
          await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK');throw error;}
      },
      async close(){try{await f.close();}finally{source.close();}},
    };
  }catch(error){try{await f?.close();}finally{source.close();}throw error;}
}
