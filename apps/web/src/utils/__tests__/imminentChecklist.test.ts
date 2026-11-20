import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CHECKLIST_MAP } from "@/constants/checklists";
import type { ProgressItem } from "@/types/database.types";
import { getImminentCategories } from "@/utils/imminentChecklist";

/** 오늘 자정에서 `days`일 뒤의 결혼식 날짜. 테스트가 달력 날짜에 묶이지 않게 한다. */
function weddingInDays(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

/** 이 분야에서 `leftIds`만 남기고 전부 끝낸 진행 기록. */
function progressWithOnlyLeft(categoryKey: string, leftIds: string[]): Record<string, ProgressItem> {
  const template = CHECKLIST_MAP[categoryKey];
  return {
    [categoryKey]: {
      status: "in_progress",
      checklist: template.items.map((item) => ({
        id: item.id,
        label: item.label,
        done: !leftIds.includes(item.id),
      })),
    },
  };
}

/**
 * 2026-09-15 — 분야에 기본 확인 시점이 하나뿐이라, 이른 분야에 묶인 늦은 항목(촬영 뒤 사진 고르기,
 * 결혼식 직전 최종으로 입어 보기, 빌린 옷 돌려주기, 결혼식 날 확인)이 하나만 남아도 그 분야가
 * 결혼식 날까지 "기본 확인 시점에서 N일 지남"으로 떴다. 제때 준비하는 커플도 그랬다.
 */
describe("늦게 하는 항목만 남은 분야는 지남으로 뜨지 않는다", () => {
  const find = (list: ReturnType<typeof getImminentCategories>, key: string) =>
    list.find((category) => category.key === key);

  it("사진 촬영: 촬영까지 끝낸 커플은 결혼식 100일 전에 알림이 없다", () => {
    const progress = progressWithOnlyLeft("studio", ["studio_08", "studio_11"]);
    // 예전 규칙이면 150일 전 기준으로 50일 지남이었다.
    expect(CHECKLIST_MAP.studio.ddayDeadline).toBeGreaterThan(100);
    expect(find(getImminentCategories(progress, weddingInDays(100)), "studio")).toBeUndefined();

    // 사진 고르기의 시점(30일 전)이 가까워지면 그 항목 기준으로 말한다.
    const near = find(getImminentCategories(progress, weddingInDays(50)), "studio");
    expect(near?.deadlineDaysLeft).toBe(20);
    expect(near?.urgency).toBe("urgent");
  });

  it("드레스: 최종으로 입어 보기만 남은 커플은 결혼식 30일 전에 지남이 아니다", () => {
    const progress = progressWithOnlyLeft("dress", ["dress_08", "dress_09"]);
    const dress = find(getImminentCategories(progress, weddingInDays(30)), "dress");
    expect(dress?.urgency).not.toBe("overdue");
    expect(dress?.deadlineDaysLeft).toBe(23);
  });

  it("계약에서 정한 날에 하는 일만 남으면 결혼식이 지나도 알림에 넣지 않는다", () => {
    const progress = progressWithOnlyLeft("dress", ["dress_09"]);
    expect(find(getImminentCategories(progress, weddingInDays(-20)), "dress")).toBeUndefined();
  });

  it("헤어·메이크업: 결혼식 날 확인만 남은 커플은 결혼식 20일 전에 지남이 아니다", () => {
    const progress = progressWithOnlyLeft("makeup", ["makeup_07"]);
    expect(find(getImminentCategories(progress, weddingInDays(20)), "makeup")?.urgency).not.toBe("overdue");
  });

  it("이른 항목을 안 했으면 예전처럼 분야 기본 시점 기준으로 지남이라고 말한다", () => {
    const progress = progressWithOnlyLeft("studio", ["studio_05", "studio_08"]);
    const studio = find(getImminentCategories(progress, weddingInDays(100)), "studio");
    expect(studio?.urgency).toBe("overdue");
    expect(studio?.deadlineDaysLeft).toBe(100 - CHECKLIST_MAP.studio.ddayDeadline);

    // 기록이 없는 분야도 그대로다.
    const untouched = find(getImminentCategories({}, weddingInDays(100)), "studio");
    expect(untouched?.deadlineDaysLeft).toBe(100 - CHECKLIST_MAP.studio.ddayDeadline);
  });
});

/**
 * 2026-08-19 — 같은 값을 화면마다 다른 말로 불렀다: WeeklyCard "3일 지남" / 챗 패널 빨간
 * "3일 초과" / 라운지 "기본 확인 시점에서 3일 지남". 상수 자신은
 * `weddingPlanning.ts`에서 "화면 정렬용 기본 확인 시점이며 실제 마감일이 아니다"라고
 * 못 박는데, 화면 둘이 그 유보를 지운 채 단정하고 있었다.
 *
 * 소스 문자열을 보는 이유: 이 문구들은 컴포넌트 안에 인라인 템플릿으로 있어서
 * 렌더 없이 잡으려면 여기가 가장 싸다.
 */
describe("마감 표현이 화면마다 갈리지 않는다", () => {
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");

  const SURFACES = [
    "src/components/app/WeeklyCard.tsx",
    "src/components/app/chat/panel/UpcomingTab.tsx",
    // 2026-11-17 파운더 디자인 아티팩트: 옛 라운지 본문(`LoungeHubSections.tsx`)은 더는 그려지지 않아
    // 목록에서 뺐다. 새 청첩장 홈은 d-day 마감을 그리지 않는다(할 일의 "이번 주 안에"는 사람이 적은 글).
  ];

  it("d-day 문구에 '기본 확인 시점'을 함께 적는다", () => {
    for (const path of SURFACES) {
      expect(read(path), `${path}: 유보 없는 마감 표현`).toContain("기본 확인 시점");
    }
  });

  it("실제 마감처럼 읽히는 낱말을 쓰지 않는다", () => {
    for (const path of SURFACES) {
      expect(read(path), `${path}: '초과'는 실제 마감을 넘긴 것처럼 읽힌다`).not.toMatch(
        /일 초과`/,
      );
    }
  });
});
