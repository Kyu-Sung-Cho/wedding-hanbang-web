import { describe, expect, it } from "vitest";
import {
  buildLoungeFirstRunView,
  FIRST_RUN_TUTORIAL_STEPS,
  FIRST_RUN_TUTORIAL_VERSION,
  PREPARATION_PROGRESS_CATEGORY_KEYS,
  PREPARATION_PROGRESS_STATUS_LABELS,
  PREPARATION_PROGRESS_STATUS_OPTIONS,
  PREPARATION_STAGE_OPTIONS,
  buildAmoraFirstHello,
  buildCoupleInviteShareUrl,
  daysUntilWedding,
  isMissingFirstRunTutorialColumn,
  parseCoupleInviteFragment,
  parseFirstRunTutorialState,
  readPreparationStage,
  shouldShowFirstRunTutorial,
} from "@hanbang/shared";
import { PROGRESS_CHECKLIST_ITEMS } from "@/types/onboarding.types";

/**
 * 첫 실행 흐름을 떠받치는 공유 계약들.
 *
 * `packages/shared`에는 테스트 러너가 없어서(타입체크만 한다) 기존 공유 코드와 같은
 * 방식으로 여기서 검증한다. 이 계약들이 조용히 어긋나면 화면이 아니라 **두 앱이 서로
 * 다른 말을 하게 되므로**, 화면 테스트보다 이쪽이 먼저다.
 */

describe("준비 현황 19항목", () => {
  it("서버가 허용하는 키 집합과 정확히 같다", () => {
    // 서버(api/onboarding/route.ts)는 PROGRESS_CHECKLIST_ITEMS에서 허용 키를 만든다.
    // 모르는 키가 하나만 섞여도 요청 **전체**를 400으로 거절하므로, 앱이 따로 목록을
    // 조립하면 카테고리가 늘어난 날 온보딩이 통째로 막힌다.
    expect(PROGRESS_CHECKLIST_ITEMS.map((item) => item.key)).toEqual([
      ...PREPARATION_PROGRESS_CATEGORY_KEYS,
    ]);
    expect(PREPARATION_PROGRESS_CATEGORY_KEYS).toHaveLength(19);
    expect(new Set(PREPARATION_PROGRESS_CATEGORY_KEYS).size).toBe(19);
  });

  it("모든 항목이 라벨을 갖는다", () => {
    for (const item of PROGRESS_CHECKLIST_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.status).toBe("not_started");
    }
  });

  it("고르는 말과 보여주는 말이 같다", () => {
    // 예전에는 온보딩이 "예정", 라운지가 "예정", 앱이 "아직"이라 세 벌이었다.
    for (const option of PREPARATION_PROGRESS_STATUS_OPTIONS) {
      expect(option.label).toBe(PREPARATION_PROGRESS_STATUS_LABELS[option.value]);
    }
    expect(PREPARATION_PROGRESS_STATUS_OPTIONS).toHaveLength(4);
    expect(
      PREPARATION_PROGRESS_STATUS_OPTIONS.map((option) => option.value),
    ).toContain("not_applicable");
  });
});

describe("준비 단계", () => {
  it("제안값은 19항목 키 안에서만 움직인다", () => {
    const allowed = new Set<string>(PREPARATION_PROGRESS_CATEGORY_KEYS);
    for (const option of PREPARATION_STAGE_OPTIONS) {
      for (const key of Object.keys(option.suggested)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it("저장된 progress에서 단계를 읽고, 없으면 null이다", () => {
    expect(readPreparationStage({ __stage: "venue_booked" })).toBe("venue_booked");
    // 예전에 온보딩을 마친 커플에게는 단계가 없다. 그건 오류가 아니다.
    expect(readPreparationStage({})).toBeNull();
    expect(readPreparationStage({ __stage: "wat" })).toBeNull();
    expect(readPreparationStage(null)).toBeNull();
    expect(readPreparationStage([])).toBeNull();
  });
});

describe("초대 링크", () => {
  it("코드를 경로가 아니라 '#' 뒤에 싣는다", () => {
    const url = buildCoupleInviteShareUrl({
      code: "WH-A3F91B2C7D40",
      origin: "https://hanbang.ai",
    });
    expect(url).toBe("https://hanbang.ai/invite#WH-A3F91B2C7D40");

    // 열쇠가 서버 접근 로그·리퍼러에 쌓이지 않아야 한다.
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/invite");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("#WH-A3F91B2C7D40");
  });

  it("origin이 이상하면 링크를 만들지 않는다", () => {
    for (const origin of ["", "javascript:alert(1)", "not a url", null, 42]) {
      expect(
        buildCoupleInviteShareUrl({ code: "WH-A3F91B2C7D40", origin }),
      ).toBeNull();
    }
  });

  it("사람이 어디를 복사해 왔든 코드를 꺼낸다", () => {
    for (const value of [
      "https://hanbang.ai/invite#WH-A3F91B2C7D40",
      "#WH-A3F91B2C7D40",
      "WH-A3F91B2C7D40",
      "  wh-a3f91b2c7d40  ",
    ]) {
      expect(parseCoupleInviteFragment(value)).toBe("WH-A3F91B2C7D40");
    }
    for (const junk of ["", "#", "#WH-SHORT", null, undefined, 42]) {
      expect(parseCoupleInviteFragment(junk)).toBeNull();
    }
  });
});

describe("첫 실행 튜토리얼 상태", () => {
  it("컬럼이 아직 없어도 '안 봤다'로 읽는다", () => {
    // 앱이 마이그레이션보다 먼저 나가는 순간은 반드시 생긴다. 그때 최악이 "안내를
    // 한 번 더 본다"여야 하고, "첫 화면이 오류"여서는 안 된다.
    expect(parseFirstRunTutorialState({})).toEqual({
      completedAt: null,
      version: null,
    });
    expect(parseFirstRunTutorialState(null)).toEqual({
      completedAt: null,
      version: null,
    });
    expect(isMissingFirstRunTutorialColumn({ code: "42703" })).toBe(true);
    expect(
      isMissingFirstRunTutorialColumn({
        message: 'column profiles.first_run_tutorial_completed_at does not exist',
      }),
    ).toBe(true);
    expect(isMissingFirstRunTutorialColumn({ code: "23505" })).toBe(false);
    expect(isMissingFirstRunTutorialColumn(null)).toBe(false);
  });

  it("온보딩을 마치지 않았으면 띄우지 않는다", () => {
    const unseen = { completedAt: null, version: null };
    expect(
      shouldShowFirstRunTutorial({ onboardingCompleted: false, state: unseen }),
    ).toBe(false);
    expect(
      shouldShowFirstRunTutorial({ onboardingCompleted: true, state: unseen }),
    ).toBe(true);
  });

  it("이미 본 사람에게는 다시 띄우지 않는다 — 판이 오르기 전까지는", () => {
    const seen = {
      completedAt: "2026-08-19T00:00:00.000Z",
      version: FIRST_RUN_TUTORIAL_VERSION,
    };
    expect(
      shouldShowFirstRunTutorial({ onboardingCompleted: true, state: seen }),
    ).toBe(false);
    expect(
      shouldShowFirstRunTutorial({
        onboardingCompleted: true,
        state: { ...seen, version: FIRST_RUN_TUTORIAL_VERSION - 1 },
      }),
    ).toBe(true);
    // 이번 세션에 이미 띄웠으면 같은 화면을 다시 밟아도 또 뜨지 않는다.
    expect(
      shouldShowFirstRunTutorial({
        onboardingCompleted: true,
        state: { completedAt: null, version: null },
        shownThisSession: true,
      }),
    ).toBe(false);
  });

  it("마지막 스텝이 아모라 버튼을 가리킨다", () => {
    // ⑤에서 ⑥으로 넘어가는 고리다. 여기가 끊기면 "튜토리얼이 끝나면 아모라가 먼저
    // 말을 건다"의 앞부분이 사라진다.
    expect(FIRST_RUN_TUTORIAL_STEPS.at(-1)?.id).toBe("amora-fab");
    expect(FIRST_RUN_TUTORIAL_STEPS.at(-1)?.optional).toBe(false);
    // 파트너가 이미 연결된 사람에게는 초대 카드가 없다.
    expect(
      FIRST_RUN_TUTORIAL_STEPS.find((step) => step.id === "lounge-invite")?.optional,
    ).toBe(true);
  });
});

describe("아모라 첫마디", () => {
  const NOW = Date.UTC(2026, 7, 20); // 2026-08-20

  it("남은 날을 시간대에 흔들리지 않게 센다", () => {
    expect(daysUntilWedding("2026-08-21", NOW)).toBe(1);
    expect(daysUntilWedding("2026-08-20", NOW)).toBe(0);
    expect(daysUntilWedding("2026-08-19", NOW)).toBe(-1);
    // 실재하지 않는 날짜로 D-day를 지어내지 않는다.
    expect(daysUntilWedding("2026-02-30", NOW)).toBeNull();
    expect(daysUntilWedding("2026/08/21", NOW)).toBeNull();
    expect(daysUntilWedding(null, NOW)).toBeNull();
  });

  it("아는 것이 하나도 없어도 말은 건다", () => {
    const hello = buildAmoraFirstHello({ now: NOW });
    expect(hello.preview.length).toBeGreaterThan(0);
    expect(hello.body).toContain("아모라");
    // 없는 D-day를 만들지 않는다.
    expect(hello.body).not.toMatch(/\d+일 남았어요/);
  });

  it("사용자가 적은 것만 되읽는다", () => {
    const hello = buildAmoraFirstHello({
      weddingDate: "2026-10-17",
      preparationStage: "venue_booked",
      partnerLinked: true,
      now: NOW,
    });
    expect(hello.body).toContain("58일 남았어요");
    expect(hello.body).toContain("결혼식장을 계약했어요");
    // 파트너가 이미 있으면 초대 이야기를 꺼내지 않는다.
    expect(hello.body).not.toContain("초대 코드");
  });

  it("파트너가 아직 없으면 초대 한 줄을 덧붙인다", () => {
    const hello = buildAmoraFirstHello({
      weddingDate: "2026-10-17",
      partnerLinked: false,
      now: NOW,
    });
    expect(hello.body).toContain("초대 코드");
  });

  it("판정하지 않고, 없는 사실을 말하지 않고, 자기를 플래너라 부르지 않는다", () => {
    for (const stage of PREPARATION_STAGE_OPTIONS) {
      for (const partnerLinked of [true, false]) {
        for (const weddingDate of ["2026-10-17", "2026-08-19", null]) {
          const { preview, body } = buildAmoraFirstHello({
            preparationStage: stage.value,
            weddingDate,
            partnerLinked,
            now: NOW,
          });
          const text = `${preview}\n${body}`;

          // 진척 판정
          for (const banned of ["늦으셨", "늦었", "잘하고 계", "잘 하고 계", "서두르"]) {
            expect(text).not.toContain(banned);
          }
          // 근거 없는 사실
          for (const banned of ["업체", "견적", "계약금", "위약금", "예산은", "%"]) {
            expect(text).not.toContain(banned);
          }
          // 호칭 — 제품 계약상 정본은 "결혼 준비 동반자"다.
          for (const banned of ["플래너", "파트너"]) {
            expect(text).not.toContain(banned);
          }
        }
      }
    }
  });
});

describe("라운지 첫 도착", () => {
  const NOW = Date.UTC(2026, 7, 20); // 2026-08-20

  it("도착하면 거기도 비어 있다는 사실과 어긋나지 않는다", () => {
    // 이 카드는 라운지가 비었을 때만 뜬다 = 예산도 일정도 비어 있다. 그런데 문구가
    // "적어두면 남은 예산이 보여요"라고 하면, 눌러서 도착한 사람은 또 빈 화면을 만난다 —
    // 이 기능이 없애려던 경험을 한 걸음 뒤로 옮기는 것이다.
    for (const stage of PREPARATION_STAGE_OPTIONS) {
      const { nextStep } = buildLoungeFirstRunView({
        preparationStage: stage.value,
        now: NOW,
      });
      const text = `${nextStep.title} ${nextStep.body}`;

      // 이미 거기 뭔가 있다고 단정하지 않는다.
      for (const banned of ["남은 일정을 확인", "쌓인", "정리해 둔"]) {
        expect(text).not.toContain(banned);
      }
      // 판정·추천·지어낸 숫자도 없다.
      for (const banned of ["늦", "추천", "최고", "보장", "%"]) {
        expect(text).not.toContain(banned);
      }
      expect(nextStep.cta.length).toBeGreaterThan(0);
    }
  });

  it("날짜를 사람이 쓰는 말로 되읽는다", () => {
    const thisYear = buildLoungeFirstRunView({
      weddingDate: "2026-12-20",
      now: NOW,
    });
    expect(thisYear.echo[0]).toEqual({
      label: "결혼식",
      value: "12월 20일 · 122일 남음",
    });

    // 해가 바뀌면 연도를 붙인다 — "1월 3일"만 보면 올해인지 내년인지 모른다.
    const nextYear = buildLoungeFirstRunView({
      weddingDate: "2027-01-03",
      now: NOW,
    });
    expect(nextYear.echo[0]?.value).toContain("2027년 1월 3일");

    // 아직 안 정한 것도 사실이라 빈칸으로 두지 않는다.
    expect(buildLoungeFirstRunView({ now: NOW }).echo[0]).toEqual({
      label: "결혼식",
      value: "날짜는 아직",
    });
  });

  it("말하지 않은 것은 줄 자체가 없다", () => {
    const view = buildLoungeFirstRunView({ now: NOW });
    // 결혼식 줄만 남는다(그건 "아직"으로라도 말한다).
    expect(view.echo).toHaveLength(1);
    expect(view.invite).toBeNull();

    const full = buildLoungeFirstRunView({
      weddingDate: "2026-12-20",
      preparationStage: "venue_booked",
      weddingStyleLabel: "미니멀",
      partnerLinked: false,
      now: NOW,
    });
    expect(full.echo.map((line) => line.label)).toEqual([
      "결혼식",
      "지금",
      "원하는 분위기",
    ]);
    expect(full.invite).not.toBeNull();
  });
});
