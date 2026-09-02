#!/usr/bin/env node
/**
 * 저장된 한글이 깨진 행을 **세고**, 되돌릴 수 있는 것만 **되돌린다.**
 *
 * ## 왜 필요한가
 *
 * 화면 쪽 되돌리기는 읽을 때마다 값을 고쳐 보여줄 뿐 저장된 값을 바꾸지 않는다.
 * 그래서 아모라 프롬프트, 검색, 알림처럼 화면을 거치지 않는 자리는 계속 깨진 값을
 * 본다(2026-08-24 실측: 저장 라벨이 깨져서 **화면은 멀쩡한데 아모라만** 항목 이름을
 * 못 알아봤다). 저장된 값을 고치는 자리는 여기다.
 *
 * ## 안전 규칙
 *
 * 1. **기본은 읽기 전용이다.** `--apply` 를 주지 않으면 한 줄도 쓰지 않는다.
 * 2. **되돌릴 수 있는 행만 쓴다.** 바이트 왕복이 정확히 맞고 결과에 한글이 나온
 *    경우만이다. 물음표로 잃어버린 행은 **건드리지 않는다** — 지우거나 우리가
 *    지어낸 문장으로 덮는 것은 사용자의 기록을 없애는 일이다.
 * 3. **목적지를 먼저 확인한다.** `verifySupabaseServiceDestinationFromEnv` 를
 *    통과해야 하고, 운영을 대상으로 쓰려면 project ref 가 박힌 별도 확인값이
 *    필요하다(`AGENTS.md` 의 service-role 규칙).
 * 4. **사용자 원문을 내보내지 않는다.** 출력은 개수와 종류뿐이다. `--sample` 을
 *    줘야 길이·hex 앞부분 같은 **내용 비포함 지문**만 보여준다.
 * 5. **쓰기 전에 다시 읽어 확인한다.** 쓴 값이 의도한 값과 다르면 그 자리에서 멈춘다.
 *
 * ## 쓰는 법
 *
 *   node scripts/repair-stored-korean.mjs                 # 세기만 한다
 *   node scripts/repair-stored-korean.mjs --sample        # 내용 비포함 지문까지
 *   node scripts/repair-stored-korean.mjs --apply         # 되돌릴 수 있는 것만 쓴다
 *   node scripts/repair-stored-korean.mjs --apply --table=chat_messages
 *
 * 운영을 대상으로 할 때는 `SUPABASE_PRODUCTION_WRITE_CONFIRM=OPERATOR_WRITE:<ref>`
 * 가 있어야 하고, 그 전에 백업·복구 검증·rollback artifact 를 갖춘다.
 */

import { createHash } from "node:crypto";
import process from "node:process";

import { verifySupabaseServiceDestinationFromEnv } from "./lib/supabase-service-destination.mjs";
import { loadStoredTextDiagnosis } from "./lib/stored-text-diagnosis.mjs";

const { diagnoseStoredText } = loadStoredTextDiagnosis();

/** 한 번에 읽을 행 수. 큰 커플의 대화도 메모리를 넘기지 않게 나눠 읽는다. */
const PAGE_SIZE = 200;

/** 훑을 자리. `column` 이 null 이면 JSONB 안을 훑는다. */
const TARGETS = [
  {
    table: "chat_messages",
    column: "content",
    select: "id, couple_id, content",
    describe: "대화 본문",
  },
  {
    table: "amora_actions",
    column: "title",
    select: "id, couple_id, title",
    describe: "아모라가 챙기기로 한 것의 제목",
  },
  {
    table: "wedding_journeys",
    column: null,
    jsonColumn: "progress",
    select: "id, couple_id, progress",
    describe: "일정·체크리스트가 든 progress JSONB",
  },
];

function parseArgs(argv) {
  const args = { apply: false, sample: false, table: null, coupleId: null };
  for (const raw of argv.slice(2)) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--sample") args.sample = true;
    else if (raw.startsWith("--table=")) args.table = raw.slice("--table=".length);
    else if (raw.startsWith("--couple=")) args.coupleId = raw.slice("--couple=".length);
    else {
      throw new Error(`모르는 인자: ${raw}`);
    }
  }
  return args;
}

/**
 * 내용을 담지 않는 지문.
 *
 * 사용자 원문을 로그·문서에 남기지 않으면서도 "같은 값인가", "얼마나 긴가",
 * "어떤 바이트로 시작하나" 를 대조할 수 있어야 한다.
 */
function fingerprint(value) {
  const bytes = Buffer.from(value, "utf8");
  return {
    chars: [...value].length,
    bytes: bytes.length,
    head: bytes.subarray(0, 6).toString("hex"),
    sha: createHash("sha256").update(bytes).digest("hex").slice(0, 12),
  };
}

/** JSONB 안의 문자열을 전부 찾아 진단한다. 깊이·개수에 상한을 둔다. */
function diagnoseJson(value, depth = 0, budget = { left: 2000 }, out = []) {
  if (depth > 8 || budget.left <= 0) return out;
  budget.left -= 1;
  if (typeof value === "string") {
    const diagnosis = diagnoseStoredText(value);
    if (diagnosis.kind !== "clean") out.push({ value, diagnosis });
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) diagnoseJson(item, depth + 1, budget, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) diagnoseJson(item, depth + 1, budget, out);
  }
  return out;
}

/** 되돌린 JSONB. 바꾼 것이 없으면 null 을 돌려 쓰기를 건너뛴다. */
function repairJson(value, depth = 0, budget = { left: 2000 }) {
  if (depth > 8 || budget.left <= 0) return { value, changed: false };
  budget.left -= 1;
  if (typeof value === "string") {
    const diagnosis = diagnoseStoredText(value);
    return diagnosis.kind === "repairable"
      ? { value: diagnosis.repaired, changed: true }
      : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = repairJson(item, depth + 1, budget);
      if (result.changed) changed = true;
      return result.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const result = repairJson(item, depth + 1, budget);
      if (result.changed) changed = true;
      next[key] = result.value;
    }
    return { value: changed ? next : value, changed };
  }
  return { value, changed: false };
}

function emptyTally() {
  return { rows: 0, clean: 0, repairable: 0, lossy: 0, unreadable: 0, written: 0 };
}

async function readPage(supabase, target, coupleId, from) {
  let query = supabase.from(target.table).select(target.select).order("id").range(from, from + PAGE_SIZE - 1);
  if (coupleId) query = query.eq("couple_id", coupleId);
  const { data, error } = await query;
  if (error) throw new Error(`${target.table} 읽기 실패: ${error.message}`);
  return data ?? [];
}

async function scanTarget(supabase, target, args, tally) {
  const samples = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = await readPage(supabase, target, args.coupleId, from);
    if (rows.length === 0) break;

    for (const row of rows) {
      tally.rows += 1;

      if (target.column) {
        const diagnosis = diagnoseStoredText(row[target.column]);
        tally[diagnosis.kind] += 1;
        if (diagnosis.unreadable) tally.unreadable += 1;
        if (diagnosis.kind === "clean") continue;
        if (args.sample && samples.length < 5) {
          samples.push({ id: row.id, kind: diagnosis.kind, ...fingerprint(row[target.column] ?? "") });
        }
        if (args.apply && diagnosis.kind === "repairable") {
          await writeColumn(supabase, target, row, diagnosis.repaired);
          tally.written += 1;
        }
        continue;
      }

      const found = diagnoseJson(row[target.jsonColumn]);
      if (found.length === 0) { tally.clean += 1; continue; }
      const worst = found.some((entry) => entry.diagnosis.kind === "lossy") ? "lossy" : "repairable";
      tally[worst] += 1;
      tally.unreadable += found.filter((entry) => entry.diagnosis.unreadable).length;
      if (args.sample && samples.length < 5) {
        samples.push({ id: row.id, kind: worst, fields: found.length, ...fingerprint(found[0].value) });
      }
      if (args.apply) {
        const repaired = repairJson(row[target.jsonColumn]);
        if (repaired.changed) {
          await writeJson(supabase, target, row, repaired.value);
          tally.written += 1;
        }
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }
  return samples;
}

/** 쓰고 나서 다시 읽어 확인한다. 다르면 그 자리에서 멈춘다. */
async function writeColumn(supabase, target, row, repaired) {
  const { error } = await supabase
    .from(target.table)
    .update({ [target.column]: repaired })
    .eq("id", row.id);
  if (error) throw new Error(`${target.table}#${row.id} 쓰기 실패: ${error.message}`);

  const { data, error: readError } = await supabase
    .from(target.table)
    .select(`id, ${target.column}`)
    .eq("id", row.id)
    .single();
  if (readError) throw new Error(`${target.table}#${row.id} 확인 읽기 실패: ${readError.message}`);
  if (data?.[target.column] !== repaired) {
    throw new Error(`${target.table}#${row.id} 쓴 값이 의도와 다릅니다. 중단합니다.`);
  }
}

async function writeJson(supabase, target, row, repaired) {
  const { error } = await supabase
    .from(target.table)
    .update({ [target.jsonColumn]: repaired })
    .eq("id", row.id);
  if (error) throw new Error(`${target.table}#${row.id} 쓰기 실패: ${error.message}`);

  const { data, error: readError } = await supabase
    .from(target.table)
    .select(`id, ${target.jsonColumn}`)
    .eq("id", row.id)
    .single();
  if (readError) throw new Error(`${target.table}#${row.id} 확인 읽기 실패: ${readError.message}`);
  if (JSON.stringify(data?.[target.jsonColumn]) !== JSON.stringify(repaired)) {
    throw new Error(`${target.table}#${row.id} 쓴 값이 의도와 다릅니다. 중단합니다.`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  // 목적지를 먼저 본다. 쓰기라면 운영 확인값까지 요구한다.
  const destination = verifySupabaseServiceDestinationFromEnv({
    access: args.apply ? "operator-write" : "read",
  });
  console.log(`[repair-stored-korean] 대상: ${destination.url} (${destination.projectRef})`);
  console.log(`[repair-stored-korean] 모드: ${args.apply ? "쓰기 — 되돌릴 수 있는 행만" : "읽기 전용"}`);
  if (args.coupleId) console.log(`[repair-stored-korean] 커플 한정: ${args.coupleId}`);

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const targets = args.table ? TARGETS.filter((t) => t.table === args.table) : TARGETS;
  if (targets.length === 0) throw new Error(`모르는 표: ${args.table}`);

  let lossyTotal = 0;
  for (const target of targets) {
    const tally = emptyTally();
    const samples = await scanTarget(supabase, target, args, tally);
    lossyTotal += tally.lossy;
    console.log(`\n[${target.table}] ${target.describe}`);
    console.log(`  훑은 행        ${tally.rows}`);
    console.log(`  멀쩡           ${tally.clean}`);
    console.log(`  되돌릴 수 있음 ${tally.repairable}${args.apply ? ` (쓴 행 ${tally.written})` : ""}`);
    console.log(`  되돌릴 수 없음 ${tally.lossy}  ← 원문 바이트가 없습니다`);
    console.log(`  읽을 글자 없음 ${tally.unreadable}`);
    for (const sample of samples) {
      console.log(`    · ${sample.id} [${sample.kind}] chars=${sample.chars} bytes=${sample.bytes} head=${sample.head} sha=${sample.sha}`);
    }
  }

  if (lossyTotal > 0) {
    console.log(
      `\n되돌릴 수 없는 행이 ${lossyTotal}건 있습니다. 이 스크립트는 그 행을 건드리지 않습니다 —\n`
      + "지우거나 지어낸 문장으로 덮는 것은 사용자의 기록을 없애는 일입니다.\n"
      + "사용자가 화면에서 직접 다시 적는 것이 지금의 유일한 복구 경로입니다.",
    );
  }
  if (!args.apply) {
    console.log("\n읽기 전용으로 돌았습니다. 되돌리려면 --apply 를 주세요(운영은 확인값이 더 필요합니다).");
  }
}

main().catch((error) => {
  console.error(`[repair-stored-korean] 중단: ${error.message}`);
  process.exitCode = 1;
});
