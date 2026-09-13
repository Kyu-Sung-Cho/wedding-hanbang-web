// 정확한 기존 함수 한 개의 EXECUTE 회수만 허용한다. 범용 migration 실행기가 아니다.
export const LEGACY_JOIN_ACL_PROJECT_REF = "slrtobkksjmxgzatjyqb";
export const LEGACY_JOIN_ACL_RELEASE_ID = "legacy-couple-join-acl-20260913";
export const LEGACY_JOIN_IDENTITY = "public.join_couple(text,text)";
export const LEGACY_JOIN_ACL_PINS = Object.freeze([
  { identity: "public.join_couple_invite_core(uuid,text,text,text)", definitionMd5: "d7beb27d7a909cbedb654e5754fbe359", beforeAcl: "{postgres=X/postgres}", afterAcl: "{postgres=X/postgres}", execute: [false, false, false] },
  { identity: "public.join_couple_server(uuid,text,text)", definitionMd5: "eebd05416877634056950287173b9baa", beforeAcl: "{postgres=X/postgres,service_role=X/postgres}", afterAcl: "{postgres=X/postgres,service_role=X/postgres}", execute: [false, false, true] },
  { identity: LEGACY_JOIN_IDENTITY, definitionMd5: "ca02d81fd41ba72ce8ef0df36eb3c708", beforeAcl: "{postgres=X/postgres,authenticated=X/postgres}", afterAcl: "{postgres=X/postgres}", execute: [false, true, false] },
]);

export const LEGACY_JOIN_ACL_INVENTORY_SQL = `
SELECT 'public.' || p.oid::regprocedure::text AS identity,
  r.rolname AS owner, p.prosecdef AS security_definer,
  md5(pg_get_functiondef(p.oid)) AS definition_md5, p.proacl::text AS acl,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_roles r ON r.oid=p.proowner
WHERE n.nspname='public' AND p.proname IN ('join_couple','join_couple_server','join_couple_invite_core')
ORDER BY p.oid::regprocedure::text;`;

function fail(code) { throw new Error(code); }

export function verifyLegacyJoinInventory(rows, phase) {
  if (!["before", "after"].includes(phase)) fail("JOIN_ACL_PHASE_INVALID");
  if (!Array.isArray(rows) || rows.length !== LEGACY_JOIN_ACL_PINS.length) fail("JOIN_ACL_IDENTITY_DRIFT");
  for (const pin of LEGACY_JOIN_ACL_PINS) {
    const matching = rows.filter(row => row.identity === pin.identity);
    if (matching.length !== 1) fail("JOIN_ACL_IDENTITY_DRIFT");
    const row = matching[0];
    if (row.owner !== "postgres" || row.security_definer !== true || row.definition_md5 !== pin.definitionMd5) fail("JOIN_ACL_FUNCTION_DRIFT");
    if (row.acl !== pin[`${phase}Acl`]) fail("JOIN_ACL_GRANT_DRIFT");
    const expected = phase === "after" && pin.identity === LEGACY_JOIN_IDENTITY ? [false, false, false] : pin.execute;
    if ([row.anon_execute, row.authenticated_execute, row.service_execute].some((value, index) => value !== expected[index])) fail("JOIN_ACL_EFFECTIVE_PRIVILEGE_DRIFT");
  }
}

function assertionSql(phase) {
  const checks = LEGACY_JOIN_ACL_PINS.map(pin => {
    const expected = phase === "after" && pin.identity === LEGACY_JOIN_IDENTITY ? [false, false, false] : pin.execute;
    return `IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid=to_regprocedure('${pin.identity}') AND r.rolname='postgres' AND p.prosecdef
      AND md5(pg_get_functiondef(p.oid))='${pin.definitionMd5}'
      AND p.proacl::text='${pin[`${phase}Acl`]}') THEN RAISE EXCEPTION 'JOIN_ACL_FUNCTION_OR_GRANT_DRIFT'; END IF;
    IF ${["anon", "authenticated", "service_role"].map((role, index) => `has_function_privilege('${role}','${pin.identity}','EXECUTE') IS DISTINCT FROM ${expected[index]}`).join(" OR ")}
      THEN RAISE EXCEPTION 'JOIN_ACL_EFFECTIVE_PRIVILEGE_DRIFT'; END IF;`;
  }).join("\n");
  return `DO $join_acl_${phase}$ BEGIN
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('join_couple','join_couple_server','join_couple_invite_core')) <> 3 THEN RAISE EXCEPTION 'JOIN_ACL_IDENTITY_DRIFT'; END IF;
    ${checks}
  END $join_acl_${phase}$;`;
}

export function buildLegacyJoinAclSql(mode) {
  if (!["apply", "rehearse", "rollback"].includes(mode)) fail("JOIN_ACL_MODE_INVALID");
  const reverse = mode === "rollback";
  return `BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(60913, 1);
${assertionSql(reverse ? "after" : "before")}
${reverse ? "GRANT EXECUTE ON FUNCTION public.join_couple(text,text) TO authenticated;" : "REVOKE EXECUTE ON FUNCTION public.join_couple(text,text) FROM PUBLIC, anon, authenticated, service_role;"}
${assertionSql(reverse ? "before" : "after")}
${mode === "rehearse" ? "ROLLBACK" : "COMMIT"};`;
}

export function validateLegacyJoinConnection(connectionString, expectedRef) {
  if (expectedRef !== LEGACY_JOIN_ACL_PROJECT_REF) fail("JOIN_ACL_TARGET_REF_MISMATCH");
  let parsed;
  try { parsed = new URL(connectionString); } catch { fail("JOIN_ACL_CONNECTION_INVALID"); }
  // 단일 direct-host 계약. pooler/임의 hostname은 대상 검증을 우회하지 않고 별도 검토한다.
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
      || parsed.hostname !== `db.${expectedRef}.supabase.co`
      || (parsed.port && parsed.port !== "5432") || parsed.pathname !== "/postgres"
      || decodeURIComponent(parsed.username) !== "postgres" || !parsed.password
      || parsed.search || parsed.hash) fail("JOIN_ACL_CONNECTION_INVALID");
  return parsed;
}

// 기존 Management API 릴리스 경로와 같은 HTTPS endpoint를 사용하되 고정 쿼리만 받는다.
export function createLegacyJoinManagementClient({ accessToken, expectedRef, mode = "inspect", confirmation, fetchImpl = globalThis.fetch }) {
  if (expectedRef !== LEGACY_JOIN_ACL_PROJECT_REF) fail("JOIN_ACL_TARGET_REF_MISMATCH");
  if (typeof accessToken !== "string" || accessToken.length < 20 || /[\r\n]/.test(accessToken)) fail("JOIN_ACL_MANAGEMENT_TOKEN_REQUIRED");
  if (!["inspect", "apply", "rehearse", "rollback"].includes(mode)) fail("JOIN_ACL_MODE_INVALID");
  if (mode !== "inspect" && confirmation !== `${LEGACY_JOIN_ACL_RELEASE_ID}:${expectedRef}:${mode}`) fail("JOIN_ACL_CONFIRMATION_REQUIRED");
  return {
    async query(sql) {
      // HTTP 요청마다 세션이 달라진다. inventory와 쓰기 bundle 각각에 SET LOCAL이 있다.
      if (sql === "SET search_path = public, pg_catalog") return { rows: [] };
      const readOnly = sql === LEGACY_JOIN_ACL_INVENTORY_SQL;
      if (!readOnly && (mode === "inspect" || sql !== buildLegacyJoinAclSql(mode))) fail("JOIN_ACL_MANAGEMENT_QUERY_FORBIDDEN");
      const query = readOnly
        ? `BEGIN READ ONLY; SET LOCAL search_path=public,pg_catalog; ${LEGACY_JOIN_ACL_INVENTORY_SQL} COMMIT;`
        : sql;
      let response;
      try {
        response = await fetchImpl(`https://api.supabase.com/v1/projects/${expectedRef}/database/query`, {
          method: "POST", redirect: "error", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, read_only: false }), signal: AbortSignal.timeout(45000),
        });
      } catch { fail("JOIN_ACL_MANAGEMENT_OUTCOME_UNVERIFIED"); }
      if (!response.ok) fail("JOIN_ACL_MANAGEMENT_OUTCOME_UNVERIFIED");
      let rows;
      try {
        const body = await response.text();
        if (Buffer.byteLength(body) > 65536) fail("JOIN_ACL_MANAGEMENT_RESPONSE_INVALID");
        rows = JSON.parse(body);
      } catch { fail("JOIN_ACL_MANAGEMENT_RESPONSE_INVALID"); }
      if (!Array.isArray(rows)) fail("JOIN_ACL_MANAGEMENT_RESPONSE_INVALID");
      return { rows };
    },
  };
}

export async function runLegacyJoinAcl({ client, mode, confirmation, expectedRef, beforeMutation }) {
  if (!["inspect", "apply", "rehearse", "rollback"].includes(mode)) fail("JOIN_ACL_MODE_INVALID");
  if (expectedRef !== LEGACY_JOIN_ACL_PROJECT_REF) fail("JOIN_ACL_TARGET_REF_MISMATCH");
  if (mode !== "inspect" && confirmation !== `${LEGACY_JOIN_ACL_RELEASE_ID}:${expectedRef}:${mode}`) fail("JOIN_ACL_CONFIRMATION_REQUIRED");
  await client.query("SET search_path = public, pg_catalog");
  const before = (await client.query(LEGACY_JOIN_ACL_INVENTORY_SQL)).rows;
  if (mode === "inspect") {
    try { verifyLegacyJoinInventory(before, "before"); return { status: "legacy-executable", inventory: before }; }
    catch { verifyLegacyJoinInventory(before, "after"); return { status: "legacy-revoked", inventory: before }; }
  }
  verifyLegacyJoinInventory(before, mode === "rollback" ? "after" : "before");
  if (typeof beforeMutation !== "function") fail("JOIN_ACL_BASELINE_WRITER_REQUIRED");
  await beforeMutation(before);
  try {
    await client.query(buildLegacyJoinAclSql(mode));
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    // COMMIT 뒤 연결 단절 가능성도 있어 자동 재시도·자동 권한 복원은 하지 않는다.
    fail("JOIN_ACL_OUTCOME_REQUIRES_INSPECTION");
  }
  const after = (await client.query(LEGACY_JOIN_ACL_INVENTORY_SQL)).rows;
  verifyLegacyJoinInventory(after, mode === "apply" ? "after" : "before");
  return { status: mode === "apply" ? "legacy-revoked" : mode === "rollback" ? "legacy-restored" : "rehearsed-and-rolled-back", before, after };
}
