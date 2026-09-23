import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';
export { nativeProfileRoleAvailable as nativeWeddingCodePairSessionAvailable };

// Windows PG17에 pg_cron이 없어 확장 존재 확인만 합성한다. DDL/RPC/ACL/transaction SQL은 실제 PostgreSQL로 검증한다.
// 운영 release 모듈에는 이 치환이 없으며 실제 확장/작업 catalog가 없으면 거절한다.
export function withSyntheticCron(sql) {
  return sql.replaceAll("(SELECT extname FROM pg_extension WHERE extname='pg_cron')", "(SELECT 'pg_cron'::name FROM pg_extension WHERE extname='plpgsql')")
    .replace(/extname\s*=\s*'pg_cron'/g, "extname='plpgsql'");
}
export async function createWeddingCodePairSessionNativeDatabase(root) {
  const owned=await createProfileRoleNativeDatabase();
  try {
    await owned.client.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA cron;
      CREATE TABLE public.unrelated_rows(id int PRIMARY KEY,note text);
      INSERT INTO public.unrelated_rows VALUES(1,'synthetic preserved');
      CREATE SEQUENCE public.unrelated_sequence;
      CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL,
        database text NOT NULL,username text NOT NULL,active boolean NOT NULL,nodename text NOT NULL,nodeport integer NOT NULL);
      CREATE FUNCTION cron.schedule(job_name text,job_schedule text,job_command text) RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE result bigint; BEGIN
        INSERT INTO cron.job(jobname,schedule,command,database,username,active,nodename,nodeport)
        VALUES(job_name,job_schedule,job_command,current_database(),current_user,true,'localhost',current_setting('port')::integer)
        ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid INTO result;
        RETURN result;
      END; $$;
      SELECT cron.schedule('unrelated-job','1 1 * * *','SELECT 1;');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    const predecessorSql=readFileSync(join(root,'supabase/migrations/20260920120000_wedding_preparation_style.sql'),'utf8');
    await owned.client.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260920120000','wedding_preparation_style',ARRAY[$1]::text[])",[predecessorSql]);
    return {...owned,predecessorSql};
  } catch(error) {await owned.close();throw error;}
}
