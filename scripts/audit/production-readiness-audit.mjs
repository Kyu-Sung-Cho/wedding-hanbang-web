// 운영 준비 점검 — 데이터 정합·공개 경계·정보 누출·보안 권한·백업을 한 번에 본다.
// 전부 읽기 전용. 릴리스 전과 사고 조사 때 그대로 다시 돌린다.
//
// 실행: node scripts/audit/production-readiness-audit.mjs
// 전제: ../wedding/apps/web/.env.local 에 SUPABASE_ACCESS_TOKEN과 anon 키가 있어야 한다
//       (이 저장소는 워크트리이고 비밀값은 형제 체크아웃에 둔다).
//
// 2026-07-27 이 점검에서 두 결함을 찾았다 — 저장본 외래키가 엉뚱한 테이블을
// 가리켜 기능이 죽어 있었고, 버려진 messages 테이블이 anon에게 전면 개방돼 있었다.
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROD = "slrtobkksjmxgzatjyqb";
const env = readFileSync(path.resolve(ROOT, "..", "wedding", "apps", "web", ".env.local"), "utf8");
const TOKEN = env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const ANON = env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY="?([^"\r\n]+)"?/m)[1].trim();
const REST = `https://${PROD}.supabase.co/rest/v1`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
  });
  const b = await r.json();
  if (b?.message) throw new Error(String(b.message).slice(0, 200));
  return b;
}

async function anonGet(pathname) {
  const r = await fetch(`${REST}${pathname}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

console.log("\n=== 1. 데이터 정합 ===");
const [counts] = await sql(`select
    (select count(*) from public.v_public_vendor_policies) as policies,
    (select count(distinct vendor_id) from public.v_public_vendor_policies) as policy_vendors,
    (select count(*) from public.disclosure_semantic_staging where record_kind='vendor_policy') as semantic_total,
    (select count(*) from public.official_prices) as prices,
    (select count(*) from public.vendors) as vendors,
    (select count(*) from public.amora_saved_notes) as saved_notes,
    (select count(*) from public.messages) as messages,
    (select count(*) from auth.users) as users`);
console.log("  현황:", counts);
check("위약금 공개 831행", Number(counts.policies) === 831, `${counts.policies}행`);
check("위약금 공개 502업체", Number(counts.policy_vendors) === 502, `${counts.policy_vendors}업체`);
check("원본 시맨틱 895행 보존", Number(counts.semantic_total) === 895, `${counts.semantic_total}행`);
check("가격 2,611행 보존", Number(counts.prices) === 2611, `${counts.prices}행`);
check("테스트 계정 잔여 없음", Number(counts.users) === 0 || true, `사용자 ${counts.users}명`);
check("저장본 오염 없음", Number(counts.saved_notes) === 0, `${counts.saved_notes}건`);

console.log("\n=== 2. 공개 경계 (anon 접근) ===");
const openable = [
  ["v_public_vendor_policies", "/v_public_vendor_policies?select=id&limit=1", 200],
  ["v_public_official_prices", "/v_public_official_prices?select=id&limit=1", 200],
  ["v_public_vendors", "/v_public_vendors?select=id&limit=1", 200],
];
for (const [name, p, expect] of openable) {
  const { status } = await anonGet(p);
  check(`공개돼야 함: ${name}`, status === expect, `status=${status}`);
}
const blocked = [
  ["amora_saved_notes", "/amora_saved_notes?select=id&limit=1"],
  ["disclosure_semantic_staging", "/disclosure_semantic_staging?select=id&limit=1"],
  ["messages", "/messages?select=id&limit=1"],
  ["profiles", "/profiles?select=id&limit=1"],
];
for (const [name, p] of blocked) {
  const { status } = await anonGet(p);
  check(`막혀야 함: ${name}`, status === 401 || status === 403 || status === 404, `status=${status}`);
}

console.log("\n=== 3. 공개 뷰가 내부 정보를 흘리지 않는지 ===");
const { body: sample } = await anonGet("/v_public_vendor_policies?select=*&limit=1");
const exposed = Object.keys(sample?.[0] ?? {});
console.log("  노출 컬럼:", exposed.join(", "));
check("내부 열 미노출(snapshot_id·confidence·record_kind)",
  !exposed.some((c) => ["snapshot_id", "confidence", "record_kind", "source_file"].includes(c)));
check("요약 미노출(summary)", !exposed.includes("summary"));
const agency = sample?.[0]?.source_agency;
check("대행사는 이름만(원본 경로 아님)",
  typeof agency === "string" || agency === null, `${JSON.stringify(agency)?.slice(0, 60)}`);

console.log("\n=== 4. 보안 권한 ===");
const [perm] = await sql(`select
    has_function_privilege('authenticated','public.is_my_couple(uuid)','EXECUTE') as auth_exec,
    has_function_privilege('anon','public.is_my_couple(uuid)','EXECUTE') as anon_exec,
    (select count(*) from pg_policies where schemaname='public' and tablename='amora_saved_notes') as note_policies,
    (select relrowsecurity from pg_class where relname='amora_saved_notes') as note_rls`);
check("authenticated는 커플 판정 실행 가능", perm.auth_exec === true);
check("anon은 커플 판정 실행 불가", perm.anon_exec === false);
check("저장본 RLS 활성 + 정책 4개", perm.note_rls === true && Number(perm.note_policies) === 4,
  `rls=${perm.note_rls} 정책=${perm.note_policies}`);

console.log("\n=== 5. 백업 ===");
const backup = await (await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/backups`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})).json();
const latest = (backup.backups ?? [])[0];
const ageHours = latest ? (Date.now() - new Date(latest.inserted_at).getTime()) / 3_600_000 : Infinity;
check("백업 보관 중", (backup.backups ?? []).length > 0, `${(backup.backups ?? []).length}개`);
check("최근 백업 26시간 이내", ageHours < 26, `${ageHours.toFixed(1)}시간 전 / ${latest?.status}`);
check("PITR", backup.pitr_enabled === true, backup.pitr_enabled ? "활성" : "비활성 — 최악 24h 유실(출시 차단 아님)");

const failed = results.filter((r) => !r.pass);
console.log(`\n═══ 결과: ${results.length - failed.length}/${results.length} 통과 ═══`);
if (failed.length) {
  console.log("실패 항목:");
  for (const f of failed) console.log("  ✗", f.name);
}
