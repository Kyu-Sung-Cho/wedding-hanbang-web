import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_PURGE_PREVIEW,
  isPurgedOnFirstActivation,
} from "@/lib/ai/amoraMemoryPurgePreview";

/**
 * 기억을 처음 켜면 서버가 기존 기록을 지운다. 화면은 그 말을 한 적이 없었다.
 *
 * `set_amora_memory_consent` 는 최초 활성화 트랜잭션 안에서 세 가지를 지운다 —
 * 확인하지 않은 자동 기억, 그 범위의 대화 요약 **전부**, 프로필 전부. 설계 의도는
 * "동의 이전에 동의 없이 만들어진 것으로 시작하지 않는다" 이고 그건 옳다.
 *
 * 문제는 화면이었다. 설정 화면은 "정리된 기억 121개" 를 보여주면서 켜기 버튼 옆에
 * "정리해 다음 상담에 활용해요" 라고만 적었고, 토글에는 확인 창이 없었다
 * (`toggleMemory()` 가 바로 PATCH 를 보냈다). 그 버튼을 누른 사람은 목록이 사라진
 * 이유를 알 방법이 없고 되돌릴 수도 없다.
 *
 * 운영 실측(2026-08-25, 읽기전용): 삭제 조건에 걸리는 decision_nodes 243행,
 * chat_summaries 15행, 커플 6팀. 그중 한 커플이 121행이다.
 *
 * ## 이 테스트가 지키는 것
 *
 * 화면이 말하는 숫자와 **실제로 지워지는 양이 같아야 한다.** 다르면 경고가 없는
 * 것보다 나쁘다 — 사람이 "3개만 사라지는군" 하고 눌렀는데 121개가 사라진다.
 * 그래서 SQL 원문을 읽어 조건을 대조한다.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");
const MIGRATION = readFileSync(
  join(REPO_ROOT, "supabase", "migrations", "20260716090000_amora_memory_engine_v2.sql"),
  "utf8",
);

/** 최초 활성화 퍼지 블록만 잘라낸다. 파일 전체에서 찾으면 다른 DELETE 를 볼 수 있다. */
function readFirstActivationPurgeBlock(): string {
  const start = MIGRATION.indexOf("IF v_enabled AND v_legacy_purged_at IS NULL THEN");
  expect(start, "최초 활성화 퍼지 블록을 찾지 못했다 — 마이그레이션이 바뀌었나?").toBeGreaterThan(0);
  const end = MIGRATION.indexOf("v_legacy_purged_at := now();", start);
  expect(end, "퍼지 블록의 끝을 찾지 못했다").toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
}

describe("SQL 이 실제로 지우는 조건", () => {
  const block = readFirstActivationPurgeBlock();

  // toContain 은 접두사라서 이름이 늘어나도 통과한다 —
  // `amora_couple_profiles` 검사가 `amora_couple_profiles_gone` 을 놓쳤다(변형으로 확인).
  // 그래서 이름 뒤에 이어지는 문자까지 함께 본다.
  it.each([
    "decision_nodes",
    "chat_summaries",
    "amora_couple_profiles",
  ])("%s 를 지운다 — 하나라도 빠지면 우리가 세는 대상이 틀린 것", (table) => {
    expect(block).toMatch(new RegExp(`DELETE FROM public[.]${table}[\\s\\n]`));
  });

  it("대화 요약은 조건 없이 그 범위 전부를 지운다", () => {
    // 여기에 조건이 붙으면 우리가 세는 숫자가 과장된다.
    const summaryDelete = block.slice(block.indexOf("DELETE FROM public.chat_summaries"));
    const statement = summaryDelete.slice(0, summaryDelete.indexOf(";"));
    expect(statement).toContain("couple_id = p_couple_id");
    expect(statement).toContain("visibility = p_visibility");
    expect(statement).not.toContain("user_confirmed_at");
    expect(statement).not.toContain("memory_key");
  });

  it("자동 기억 조건 네 가지가 그대로다", () => {
    const nodeDelete = block.slice(block.indexOf("DELETE FROM public.decision_nodes"));
    const statement = nodeDelete.slice(0, nodeDelete.indexOf(";"));
    expect(statement).toContain("user_confirmed_at IS NULL");
    expect(statement).toContain("'user_corrected' IS DISTINCT FROM 'true'");
    expect(statement).toContain("memory_key IS NOT NULL");
    // 키 이름이 길어지기만 해도 통과하면 안 된다. `extracted_by_removed` 로 바꾼
    // 변형이 toContain 을 그대로 통과했다.
    expect(statement).toMatch(/[?] 'extracted_by'(?!\w)/);
  });
});

describe("우리가 세는 조건이 SQL 과 같다", () => {
  it.each([
    ["memory_key 가 있는 자동 기억", { user_confirmed_at: null, memory_key: "budget.total", metadata: {} }, true],
    ["extracted_by 만 있는 옛 추출물", { user_confirmed_at: null, memory_key: null, metadata: { extracted_by: "haiku" } }, true],
  ])("지워진다: %s", (_label, row, expected) => {
    expect(isPurgedOnFirstActivation(row)).toBe(expected);
  });

  it.each([
    ["사용자가 확인한 기억", { user_confirmed_at: "2026-08-01T00:00:00Z", memory_key: "budget.total", metadata: {} }],
    ["사용자가 직접 고친 기억", { user_confirmed_at: null, memory_key: "budget.total", metadata: { user_corrected: true } }],
    ["자동으로 만들어진 것이 아닌 결정", { user_confirmed_at: null, memory_key: null, metadata: {} }],
    ["metadata 가 아예 없는 행", { user_confirmed_at: null, memory_key: null, metadata: null }],
  ])("살아남는다: %s", (_label, row) => {
    expect(isPurgedOnFirstActivation(row)).toBe(false);
  });

  it("metadata 가 배열이어도 터지지 않는다", () => {
    expect(isPurgedOnFirstActivation({ user_confirmed_at: null, memory_key: null, metadata: [] })).toBe(false);
  });

  it("아무것도 없을 때의 기본값은 0 이다", () => {
    expect(EMPTY_PURGE_PREVIEW.total).toBe(0);
  });
});

describe("웹 설정 화면이 켜기 전에 멈춘다", () => {
  const page = readFileSync(
    join(REPO_ROOT, "apps", "web", "src", "app", "(app)", "settings", "amora-memory", "page.tsx"),
    "utf8",
  );

  it("퍼지가 예정돼 있으면 PATCH 대신 확인 화면을 연다", () => {
    expect(page).toContain("setting.legacyPurgedAt === null");
    expect(page).toContain("setting.pendingPurge.total > 0");
    expect(page).toContain("setConfirmEnable(true)");
  });

  it("확인 관문이 실제 적용보다 앞에 있다", () => {
    const gateAt = page.indexOf("if (willPurge && !confirmEnable)");
    const applyAt = page.indexOf("await applyMemoryToggle();");
    expect(gateAt).toBeGreaterThan(0);
    expect(applyAt).toBeGreaterThan(gateAt);
  });

  it("무엇이 사라지는지 숫자로 말한다", () => {
    expect(page).toContain("정리된 기억 ${setting.pendingPurge.memories}개");
    expect(page).toContain("대화 요약 ${setting.pendingPurge.summaries}개");
  });

  it("되돌릴 수 없다고 말한다", () => {
    expect(page).toContain("되돌릴 수 없어요");
  });

  it("남는 것도 함께 말한다 — 다 사라진다고 읽히면 안 된다", () => {
    expect(page).toContain("채팅 원문");
  });

  it("기계 한국어를 쓰지 않는다", () => {
    // 목록의 마지막이 "…개"(모음)일 수도 "상담 참고 맥락"(자음)일 수도 있어서
    // 조사를 고정하면 "1개이(가) 사라지고" 가 된다. 운영 데이터로 확인한 실제 문장이다.
    // 답은 조사 후보를 나열하는 게 아니라 거기서 문장을 끊는 것이다.
    expect(page).not.toContain("이(가)");
    expect(page).not.toContain("을(를)");
    expect(page).not.toContain("와(과)");
  });
});

describe("모바일도 같은 말을 한다", () => {
  const screen = readFileSync(
    join(REPO_ROOT, "apps", "mobile", "app", "settings", "amora-memory.tsx"),
    "utf8",
  );

  it("켜기 전에 Alert 로 멈춘다", () => {
    expect(screen).toContain("setting.pendingPurge.total > 0");
    expect(screen).toContain("지우고 켜기");
    expect(screen).toContain("그대로 두기");
  });

  it("취소가 기본이고 적용은 destructive 다", () => {
    expect(screen).toContain('{ text: "그대로 두기", style: "cancel" }');
    expect(screen).toContain('style: "destructive"');
  });

  it("웹과 같은 사실을 말한다", () => {
    expect(screen).toContain("되돌릴 수 없어요");
    expect(screen).toContain("채팅 원문");
  });

  it("기계 한국어를 쓰지 않는다", () => {
    expect(screen).not.toContain("이(가)");
    expect(screen).not.toContain("을(를)");
    expect(screen).not.toContain("와(과)");
  });
});
