// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 체크리스트 항목의 **글자를 그리는** 화면은 전부 안내(`note`)도 함께 그린다.
 *
 * 2026-08-19에 note를 넣으면서 모달에만 마크업을 붙였다. 그래서 체크가 실제로 일어나는
 * 일정 화면의 시간축에서는 안내가 안 보였고, 검색은 note까지 훑는데 화면에는 없었다.
 * 22개 문장을 써 놓고 한 곳에서만 쓴 셈이다.
 *
 * "항목을 그리는 화면"을 문자열로 자동 판별하려 했더니 내비게이션·필터 버튼의 `item.label`까지
 * 걸려 못 쓴다. 그래서 **항목을 손에 쥐는 파일(`mergeChecklist`)을 전부 세워 놓고, 각각이
 * 그것으로 무엇을 하는지 여기에 적는다.** 새 파일이 항목을 쥐면 목록에 없어서 실패하고,
 * 그때 사람이 "이건 그리나 안 그리나"를 한 번 판단하게 된다.
 */
const SRC = resolve(process.cwd(), "src");
const MERGES = /\bmerge(Planning)?Checklist\(/;

type Role = "draws" | "counts" | "writes" | "exempt";

/** 항목을 쥐는 파일과, 그 파일이 항목으로 하는 일. */
const SURFACES: Record<string, { role: Role; why: string }> = {
  "src/components/app/schedule/CategoryChecklistModal.tsx": { role: "draws", why: "분야를 열었을 때의 항목 목록" },
  "src/components/app/schedule/TimelineView.tsx": { role: "draws", why: "일정 화면 시간축 — 여기서도 체크가 일어난다" },
  "src/components/app/chat/panel/ChecklistTab.tsx": { role: "draws", why: "아모라 옆 정보 패널의 기본 탭" },

  "src/app/(app)/dashboard/page.tsx": { role: "counts", why: "개수만 쓴다" },
  "src/app/(app)/lounge/progressSummary.ts": { role: "counts", why: "라운지 진행률 계산 — 화면이 아니라 계산부다" },
  "src/components/app/checklist/ChecklistContent.tsx": { role: "counts", why: "분야 카드의 개수와 검색 색인에만 쓴다 — 항목은 모달이 그린다" },
  "src/utils/checklist.ts": { role: "counts", why: "병합·집계 함수 자체" },
  "src/utils/imminentChecklist.ts": { role: "counts", why: "임박 분야 계산" },
  "src/lib/amora/lifecycle.ts": { role: "counts", why: "아모라 선톡 판단용 집계" },

  "src/components/app/schedule/ScheduleContent.tsx": { role: "writes", why: "저장 경로 — 그리지 않는다" },
  "src/lib/ai/amoraAtomicToolOperation.ts": { role: "writes", why: "아모라 원자 실행 저장 경로" },
  "src/lib/ai/tools/scheduleTools.ts": { role: "writes", why: "아모라 도구 저장 경로" },
};

/**
 * ActionCard는 `mergeChecklist`를 쓰지 않아 이 목록 밖이지만, 항목을 3개까지 미리보기한다.
 * 저장된 사용자 행에서 읽어 애초에 note가 데이터에 없고(저장 전에 떼어 낸다), 대화 속 카드에
 * 두 줄짜리 안내가 3개 붙으면 카드가 대화를 밀어낸다. 그래서 의도적으로 뺐다.
 */
const DELIBERATELY_WITHOUT_NOTES = "src/components/app/chat/ActionCard.tsx";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const holders = walk(SRC)
  .filter((file) => MERGES.test(readFileSync(file, "utf8")))
  .map((file) => relative(process.cwd(), file).split(sep).join("/"));

describe("항목을 그리는 화면은 안내도 그린다", () => {
  it("항목을 쥐는 파일을 실제로 찾아낸다", () => {
    expect(holders.length).toBeGreaterThan(5);
  });

  it("새로 항목을 쥔 파일이 있으면 무슨 일을 하는지 적게 한다", () => {
    const unlisted = holders.filter((file) => !(file in SURFACES));
    expect(unlisted, "SURFACES에 역할을 적어라 — 그리는 화면이면 ChecklistItemText를 쓸 것").toEqual([]);
  });

  it("그린다고 적힌 화면은 전부 공용 컴포넌트를 쓴다", () => {
    const bare = Object.entries(SURFACES)
      .filter(([, { role }]) => role === "draws")
      .filter(([file]) => !readFileSync(resolve(process.cwd(), file), "utf8").includes("ChecklistItemText"))
      .map(([file]) => file);
    expect(bare, "항목만 그리고 안내는 빠뜨린 화면").toEqual([]);
  });

  it("그린다고 적힌 화면은 근거 링크도 함께 단다", () => {
    // 안내만 보여 주고 "왜?"에 답할 길을 안 주면 반쪽이다. 근거 링크는 체크박스 밖에
    // 있어야 해서 컴포넌트가 따로다 — 그래서 따로 확인한다.
    const missing = Object.entries(SURFACES)
      .filter(([, { role }]) => role === "draws")
      .filter(([file]) => !readFileSync(resolve(process.cwd(), file), "utf8").includes("ChecklistItemSource"))
      .map(([file]) => file);
    expect(missing, "안내는 그리는데 근거로 갈 길이 없는 화면").toEqual([]);
  });

  it("그리지 않는다고 적힌 파일이 몰래 항목을 그리지 않는다", () => {
    const sneaky = Object.entries(SURFACES)
      .filter(([, { role }]) => role !== "draws")
      .filter(([file]) => readFileSync(resolve(process.cwd(), file), "utf8").includes("ChecklistItemText"))
      .map(([file]) => file);
    expect(sneaky, "역할이 바뀌었으면 SURFACES를 고쳐라").toEqual([]);
  });

  it("목록에 죽은 항목이 없다", () => {
    const stale = Object.keys(SURFACES).filter((file) => !holders.includes(file));
    expect(stale, "더는 항목을 쥐지 않는 파일").toEqual([]);
  });

  it("의도적으로 안내를 뺀 화면은 그 사실이 그대로다", () => {
    const source = readFileSync(resolve(process.cwd(), DELIBERATELY_WITHOUT_NOTES), "utf8");
    expect(source).toContain("slice(0, 3)");
    expect(source).not.toContain("ChecklistItemText");
  });
});
