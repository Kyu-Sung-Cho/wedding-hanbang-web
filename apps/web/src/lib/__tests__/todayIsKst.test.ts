// @vitest-environment node

/**
 * "오늘"을 UTC 로 읽던 자리들을 KST 로 못박는다.
 *
 * `toISOString()` 은 **어디서 돌든 UTC 날짜**를 준다 — 서버든 사용자의 브라우저·폰이든.
 * 한국은 UTC+9 이므로 **한국 시각 00:00~09:00 동안 그 값은 어제**다. 하루 중 9시간이다.
 *
 * 이 저장소는 그 사고를 이미 겪고 `lib/utils/kstDate.ts` 에 규칙을 세워 뒀다 —
 * "모든 사용자-노출 날짜 계산은 이 헬퍼를 통과시킨다". 그런데 실제로 그 헬퍼를 쓰는
 * 파일은 두 개뿐이었다.
 *
 * ## 여기서 고정하는 것
 *
 * 저장소 전체에 정규식 가드를 걸지 않는다. `toISOString().slice(0, 10)` 은 **왕복
 * 검증**(`parsed.toISOString().slice(0,10) === value`)에도 정당하게 쓰이고, 운영자
 * 화면에도 쓰인다. 전부 잡으면 허용 목록이 길어지고 그 목록이 다시 썩는다.
 *
 * 대신 **고친 자리만** 이름으로 붙잡는다. 되돌리면 여기서 깨진다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const RAW_UTC_TODAY = /new Date\(\)\.toISOString\(\)\.(?:slice\(0, 10\)|split\("T"\)\[0\])/u;

const FIXED_SITES = [
  {
    label: "일정 화면의 다가오는 일정 필터",
    path: "src/components/app/schedule/ScheduleContent.tsx",
    expected: "const todayStr = ymdInKst();",
  },
  {
    label: "채팅 옆 패널의 다가오는 일정 필터",
    path: "src/components/app/chat/panel/UpcomingTab.tsx",
    expected: "const todayStr = now ? ymdInKst(now) : \"\";",
  },
  {
    label: "온보딩 예식일 입력의 최소 날짜",
    path: "src/components/onboarding/WeddingDetails.tsx",
    expected: "min={ymdInKst()}",
  },
  // 2026-08-27: "랜딩 예식일 입력의 최소 날짜" 항목을 뺐다.
  //
  // 랜딩을 새 IA 로 다시 지으면서 히어로에서 **날짜 입력 자체가 없어졌다.** 첫 행동이
  // 날짜 입력에서 "스무 장면 답하기"(`/wedding-code`)로 바뀌었기 때문이다.
  // 지킬 자리가 없어진 것이지 규칙이 느슨해진 것이 아니다.
  //
  // 날짜를 받는 자리는 `/start-here` 로 옮겨졌는데 그쪽은 `min` 을 아예 걸지 않는다
  // (지난 날짜도 받는 화면이다). KST 경계 문제가 아니라 원래 무제한 입력이므로
  // 여기 항목으로 옮기지 않았다.
] as const;

describe("사용자에게 보이는 '오늘'은 한국 기준이다", () => {
  it.each(FIXED_SITES)("$label", ({ path, expected }) => {
    const text = source(path);
    expect(text).toContain(expected);
    expect(text).toContain('from "@/lib/utils/kstDate"');
    expect(text).not.toMatch(RAW_UTC_TODAY);
  });
});

describe("같은 화면 안에서 날짜 기준이 갈리지 않는다", () => {
  it("UpcomingTab 의 라벨과 필터가 같은 자를 쓴다", () => {
    // getDaysUntil 은 로컬 시간이라 원래 맞았다. todayStr 만 UTC 였다.
    // 그래서 한국 새벽에는 지난 일정이 "1일 전" 라벨을 달고 다가오는 목록에 남았다.
    const text = source("src/components/app/chat/panel/UpcomingTab.tsx");
    expect(text).toContain("ymdInKst(now)");
    expect(text).not.toContain("now.toISOString()");
  });
});
