// 운영 준비 점검 — 데이터 정합·공개 경계·정보 누출·보안 권한·백업을 한 번에 본다.
// 전부 읽기 전용. 릴리스 전과 사고 조사 때 그대로 다시 돌린다.
//
// 실행: node scripts/audit/production-readiness-audit.mjs
// 전제: apps/web/.env.local 에 SUPABASE_ACCESS_TOKEN과 anon 키가 있어야 한다.
//       워크트리에서 비밀값을 형제 체크아웃에 두는 배치도 그대로 지원한다.
//
// 2026-07-27 이 점검에서 두 결함을 찾았다 — 저장본 외래키가 엉뚱한 테이블을
// 가리켜 기능이 죽어 있었고, 버려진 messages 테이블이 anon에게 전면 개방돼 있었다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROD = "slrtobkksjmxgzatjyqb";

// 형제 체크아웃 경로만 하드코딩해 두면 그 배치를 쓰는 컴퓨터에서만 돌아간다.
// 조사 때 다시 돌리려고 저장소에 넣은 스크립트이므로 자기 저장소를 먼저 본다.
const REQUIRED_ENV_KEYS = ["SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

function readEnvFile() {
  const candidates = [
    path.resolve(ROOT, "apps", "web", ".env.local"),
    path.resolve(ROOT, "..", "wedding", "apps", "web", ".env.local"),
  ];
  const present = candidates.filter((candidate) => existsSync(candidate));
  if (present.length === 0) {
    throw new Error(
      `.env.local을 찾지 못했다. 다음 중 한 곳에 두라:\n  ${candidates.join("\n  ")}`,
    );
  }

  // **있는 파일**이 아니라 **키가 든 파일**을 고른다. 워크트리에서 비밀값을 형제
  // 체크아웃에 두는 배치에서는 자기 저장소의 .env.local이 존재하되 운영 토큰이
  // 없다 — 존재만 보고 첫 파일을 잡으면 그 컴퓨터에서 감사가 못 돈다(2026-07-27
  // 이 저장소에서 실제로 재현됐다). 여러 파일이 자격을 갖추면 자기 저장소가 우선.
  const usable = present.find((candidate) => {
    const source = readFileSync(candidate, "utf8");
    return REQUIRED_ENV_KEYS.every((key) => new RegExp(`^${key}=`, "m").test(source));
  });
  if (!usable) {
    const detail = present
      .map((candidate) => {
        const source = readFileSync(candidate, "utf8");
        const missing = REQUIRED_ENV_KEYS.filter(
          (key) => !new RegExp(`^${key}=`, "m").test(source),
        );
        return `  ${candidate} — 없는 키: ${missing.join(", ")}`;
      })
      .join("\n");
    throw new Error(`필요한 키를 모두 가진 .env.local이 없다:\n${detail}`);
  }
  console.log(`  env: ${path.relative(ROOT, usable) || usable}`);
  return readFileSync(usable, "utf8");
}

function requireKey(source, pattern, name) {
  const matched = source.match(pattern);
  if (!matched) throw new Error(`${name}이 .env.local에 없다 — 이 점검은 그 값 없이 돌 수 없다.`);
  return matched[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * 소비자 화면이 주장하는 공시 라운드와 그 근거 스냅샷을 `period.ts`에서 읽는다.
 *
 * 여기 값을 베껴 두면 그게 곧 드리프트다 — 이 점검이 막으려는 바로 그 상태가 된다.
 * 그래서 단일 출처인 TS 소스를 읽는다. 파싱이 깨지면 조용히 넘어가지 않고 던진다
 * (검사가 공회전하는 것이 이 저장소가 실제로 겪은 실패 유형이다).
 */
function readDisclosureRoundPins() {
  const source = readFileSync(
    path.resolve(ROOT, "apps", "web", "src", "lib", "price", "period.ts"),
    "utf8",
  );
  const round = /export const DISCLOSURE_ROUND\s*=\s*"([^"]+)"/.exec(source);
  const labels = /export const DISCLOSURE_ROUND_SNAPSHOT_LABELS\s*=\s*\[([^\]]*)\]/.exec(source);
  if (!round || !labels) {
    throw new Error(
      "period.ts에서 DISCLOSURE_ROUND / DISCLOSURE_ROUND_SNAPSHOT_LABELS를 못 읽었다"
      + " — 상수 이름이나 형식이 바뀌었다. 이 점검을 고치기 전에는 공시 라운드 대조가 없다.",
    );
  }
  const parsed = [...labels[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (parsed.length === 0) {
    throw new Error("DISCLOSURE_ROUND_SNAPSHOT_LABELS가 비어 있다 — 대조할 근거가 없다.");
  }
  return { DISCLOSURE_ROUND: round[1], DISCLOSURE_ROUND_SNAPSHOT_LABELS: parsed };
}

const { DISCLOSURE_ROUND, DISCLOSURE_ROUND_SNAPSHOT_LABELS } = readDisclosureRoundPins();

const env = readEnvFile();
const TOKEN = requireKey(env, /^SUPABASE_ACCESS_TOKEN=(.*)$/m, "SUPABASE_ACCESS_TOKEN");
const ANON = requireKey(
  env,
  /^NEXT_PUBLIC_SUPABASE_ANON_KEY="?([^"\r\n]+)"?/m,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);
const REST = `https://${PROD}.supabase.co/rest/v1`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// `apps/web/src/lib/price/period.ts`의 formatDisclosurePeriod와 같은 규칙.
// 사용자가 실제로 보는 문구를 그대로 재현해야 대조에 쓸 수 있다 — 분기만 처리하고
// 월 형식을 빼면 화면이 "2025년 11월"인데 여기는 "2025-11"로 찍혀, 정작 대조가
// 필요한 자리에서 재현이 깨진다.
const quarterLabel = (value) => {
  const normalized = String(value ?? "").trim();
  const quarter = /^(\d{4})Q([1-4])$/i.exec(normalized);
  if (quarter) return `${quarter[1]}년 ${quarter[2]}분기`;
  const month = /^(\d{4})-(0?[1-9]|1[0-2])$/.exec(normalized);
  if (month) return `${month[1]}년 ${Number(month[2])}월`;
  return normalized || "기간 확인 필요";
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
    (select count(*) from auth.users) as users,
    -- E2E(saved-notes-real-path-e2e.mjs)가 만드는 임시 계정 도메인. 정리 실패를 잡는다.
    (select count(*) from auth.users
      where email like '%@hanbang-test.invalid') as leftover_test_users`);
console.log("  현황:", counts);
check("위약금 공개 831행", Number(counts.policies) === 831, `${counts.policies}행`);
check("위약금 공개 502업체", Number(counts.policy_vendors) === 502, `${counts.policy_vendors}업체`);
check("원본 시맨틱 895행 보존", Number(counts.semantic_total) === 895, `${counts.semantic_total}행`);
check("가격 2,611행 보존", Number(counts.prices) === 2611, `${counts.prices}행`);
// `=== 0 || true`로 적어 두어 절대 실패하지 않던 검사였다. 실사용자가 생기면
// 전체 사용자 수는 당연히 0이 아니므로, 정말 확인하려던 것(E2E 임시 계정 정리)만 본다.
check(
  "테스트 계정 잔여 없음",
  Number(counts.leftover_test_users) === 0,
  `잔여 ${counts.leftover_test_users}건 · 전체 사용자 ${counts.users}명`,
);
check("저장본 오염 없음", Number(counts.saved_notes) === 0, `${counts.saved_notes}건`);

// 화면은 `period_label`을 "YYYY년 N분기"로 그대로 렌더한다
// (`price/vendor/[slug]/page.tsx`). 그 값이 실제 공시 라운드와 다르면 사이트가
// 소비자에게 틀린 기준 시점을 주장하게 된다 — 이 제품의 전제가 무너지는 자리다.
// 자기 일관성으로는 잡히지 않는다(`collected_at`은 적재 시점이라 라벨과 우연히
// 맞는다). 그래서 값을 그대로 찍어 사람이 공시 게시일과 대조하게 한다.
// 출처: 한국소비자원 참가격 → 서비스가격정보 → 결혼서비스 중요정보 공개 →
//       결혼준비대행서비스 (지역별 게시물). 게시일을 아래 값과 비교할 것.
console.log("\n=== 1-b. 공시 스냅샷 출처 (사람 대조 필요) ===");
const snapshots = await sql(`select period_label, source, source_note,
    collected_at, published_at, is_current, published
  from public.price_snapshots
  order by is_current desc, collected_at desc
  limit 5`);
for (const snapshot of snapshots) {
  console.log(
    `  ${snapshot.is_current ? "[현재]" : "      "} period_label=${snapshot.period_label}`
    + ` · 화면표기="${quarterLabel(snapshot.period_label)}"`
    + ` · source=${snapshot.source} · collected_at=${snapshot.collected_at}`
    + ` · published_at=${snapshot.published_at} · published=${snapshot.published}`,
  );
  if (snapshot.source_note) console.log(`           source_note=${snapshot.source_note}`);
}
console.log(
  `  화면이 주장하는 공시 기준 시점: "${quarterLabel(DISCLOSURE_ROUND)}"`
  + ` (${DISCLOSURE_ROUND}) — 근거 스냅샷 ${DISCLOSURE_ROUND_SNAPSHOT_LABELS.join(", ")}`,
);

// 표시값을 DB에서 떼어낸 대가로 생긴 함정을 여기서 막는다. 다음 라운드를
// 적재하고 `DISCLOSURE_ROUND`를 안 고치면 화면이 옛 시점을 계속 주장하는데,
// 단위 테스트는 리터럴만 고정하므로 전부 통과한다. DB를 볼 수 있는 곳은
// 여기뿐이라 대조도 여기서 한다.
// 위 표시용 조회는 limit 5다. 대조는 발행 스냅샷 전체를 따로 본다 —
// 6번째에 새 라운드가 들어와 있으면 표시용 조회로는 안 보인다.
const publishedSnapshots = await sql(
  "select distinct period_label from public.price_snapshots where published is true",
);
const publishedLabels = [...new Set(publishedSnapshots.map((row) => row.period_label))];
const unpinned = publishedLabels.filter(
  (label) => !DISCLOSURE_ROUND_SNAPSHOT_LABELS.includes(label),
);
check(
  "공시 라운드 표기가 발행 스냅샷과 맞물려 있음",
  publishedLabels.length > 0 && unpinned.length === 0,
  publishedLabels.length === 0
    ? "발행된 스냅샷이 없다 — 조회가 잘못됐는지 확인할 것"
    : unpinned.length > 0
      ? `핀에 없는 발행 스냅샷 ${unpinned.join(", ")}`
        + ` — 새 공시 라운드가 들어왔다. 게시일을 확인해 apps/web/src/lib/price/period.ts의`
        + ` DISCLOSURE_ROUND와 DISCLOSURE_ROUND_SNAPSHOT_LABELS를 갱신할 것`
      : `발행 스냅샷 ${publishedLabels.join(", ")}`,
);

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
