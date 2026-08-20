import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 채팅이 프로필을 읽는 select에 **새 컬럼을 얹지 마라.**
 *
 * ## 무슨 일이 있었나
 *
 * 첫 실행 안내 완료 시각(`first_run_tutorial_completed_at`)이 필요해서 기존 프로필
 * select에 한 칸 더 붙였다. 그 컬럼은 아직 운영 DB에 없다.
 *
 * PostgREST는 모르는 컬럼이 하나만 섞여도 **select 전체**를 42703으로 거절한다.
 * 그러면 이 파일의 레거시 폴백이 발동하는데, 그 폴백은 `preparation_status: null`을
 * 하드코딩한다. 그리고 `normalizePreparationStatus(null)`은 `"preparing"`이다.
 *
 * 결과: **예식을 미루거나 이어가지 않기로 한 사람에게 D-day 카운트다운과 재촉과
 * 축하가 전부 되살아난다.** `preparationStatus` 계약 파일이 첫 문단에서 "어떤 버그보다
 * 아픈 자리"라고 적어둔 그 상황을, 안내 플래그 하나 때문에 전 사용자에게 만들 뻔했다.
 *
 * ## 그래서 규칙
 *
 * 이 select는 **운영에 이미 있는 컬럼만** 담는다. 아직 없는 컬럼이 필요하면 별도 조회로
 * 따로 읽고, 실패는 그 기능만 조용히 포기한다 — 프로필 전체를 인질로 잡지 않는다.
 */

const ROUTE_SOURCE = readFileSync(
  path.join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8",
);

/** 이 파일이 쓰이는 시점에 운영 DB에 아직 없는 컬럼들. 적용되면 여기서 지운다. */
const COLUMNS_NOT_IN_PRODUCTION_YET = [
  "first_run_tutorial_completed_at",
  "first_run_tutorial_version",
];

function profileSelectArguments(): string[] {
  const selects: string[] = [];
  const pattern = /\.from\("profiles"\)\s*\.select\(\s*("(?:[^"\\]|\\.)*")/gu;
  for (const match of ROUTE_SOURCE.matchAll(pattern)) {
    selects.push(match[1]);
  }
  return selects;
}

describe("채팅 프로필 select 경계", () => {
  it("아직 운영에 없는 컬럼을 프로필 select에 섞지 않는다", () => {
    const selects = profileSelectArguments();
    expect(selects.length).toBeGreaterThan(0);

    for (const select of selects) {
      // 안내 완료 시각만 따로 읽는 전용 조회는 예외다 — 그건 실패해도 그 기능만 꺼진다.
      const isDedicatedTutorialRead =
        select.replace(/"/gu, "").trim() === "first_run_tutorial_completed_at";
      if (isDedicatedTutorialRead) continue;

      for (const column of COLUMNS_NOT_IN_PRODUCTION_YET) {
        expect(
          select.includes(column),
          `프로필 select에 아직 운영에 없는 컬럼(${column})이 섞였습니다. `
            + "PostgREST가 select 전체를 42703으로 거절하고, 폴백이 "
            + "preparation_status를 null로 만들어 예식을 미룬 사람에게 "
            + "카운트다운이 되살아납니다. 별도 조회로 분리하세요.",
        ).toBe(false);
      }
    }
  });

  it("폴백이 존재하고 preparation_status만 잃는다", () => {
    // 폴백 자체는 필요하다(preparation_status도 한때 없던 컬럼이다).
    // 다만 그 폴백이 발동하는 조건이 "새 기능 하나 추가"여서는 안 된다.
    expect(ROUTE_SOURCE).toMatch(/if \(withStatus\.error\.code !== "42703"\) return null;/u);
    expect(ROUTE_SOURCE).toMatch(/preparation_status: null,/u);
  });

  it("안내 완료 시각은 아모라가 아직 말하지 않은 대화에서만 조회한다", () => {
    // 평소 턴마다 DB를 한 번 더 왕복시키지 않는다.
    expect(ROUTE_SOURCE).toMatch(
      /!typedMessages\.some\(\(message\) => message\.role === "assistant"\)/u,
    );
    expect(ROUTE_SOURCE).toMatch(
      /tutorialCompletedAt: await readFirstRunTutorialCompletedAt\(actorId\)/u,
    );
  });
});
