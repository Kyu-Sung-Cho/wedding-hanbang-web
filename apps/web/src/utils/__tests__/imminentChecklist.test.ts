import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
    "src/app/(app)/lounge/LoungeHubSections.tsx",
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
