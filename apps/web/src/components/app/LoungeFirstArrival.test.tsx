// @vitest-environment jsdom

import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PREPARATION_STAGE_OPTIONS } from "@hanbang/shared";

import { WEDDING_APP_ROUTES } from "../../../weddingAppRoutes";
import LoungeFirstArrival, {
  buildLoungeFirstArrival,
  DESTINATION_PATH,
  INVITE_PATH,
  LoungeFirstArrivalEmptyNote,
  type LoungeFirstArrivalInput,
} from "./LoungeFirstArrival";
import type { ProgressItem } from "@/types/database.types";

const NOW = Date.parse("2026-08-20T00:00:00.000Z");

function makeInput(
  overrides: Partial<LoungeFirstArrivalInput> = {},
): LoungeFirstArrivalInput {
  return {
    onboardingCompleted: true,
    weddingDate: "2026-12-20",
    progress: {} as Record<string, ProgressItem>,
    totalBudget: 0,
    spentBudget: 0,
    checkedItemCount: 0,
    partnerLinked: false,
    now: NOW,
    ...overrides,
  };
}

function progressOf(value: Record<string, unknown>) {
  return value as unknown as Record<string, ProgressItem>;
}

describe("첫 도착 화면은 라운지가 비어 있을 때만 나온다", () => {
  it("온보딩만 끝난 빈 라운지에서는 나온다", () => {
    expect(buildLoungeFirstArrival(makeInput())).not.toBeNull();
  });

  // 2026-09-04 실측: 사진 600만원·드레스 300만원을 배정한 커플에게 "지금은 비어 있어요" 가
  // 떴다 — 아래 예산 위젯이 "남은 예산 5,000만원" 을 그리면서. 배정액은 사람이 만든 데이터다.
  it("카테고리에 예산을 배정했으면 비어 있다고 말하지 않는다", () => {
    expect(
      buildLoungeFirstArrival(makeInput({
        totalBudget: 50_000_000,
        progress: progressOf({ studio: { budget: 6_000_000 }, dress: { budget: 3_000_000 } }),
      })),
    ).toBeNull();
    expect(
      buildLoungeFirstArrival(makeInput({ progress: progressOf({ studio: { spent: 100_000 } }) })),
    ).toBeNull();
  });

  it("총예산만 적은 상태는 여전히 첫 도착 화면이다(되읽어 줄 대상)", () => {
    expect(buildLoungeFirstArrival(makeInput({ totalBudget: 50_000_000 }))).not.toBeNull();
  });

  it("온보딩을 마치지 않았으면 되읽을 것이 없으므로 나오지 않는다", () => {
    expect(
      buildLoungeFirstArrival(makeInput({ onboardingCompleted: false })),
    ).toBeNull();
  });

  it.each([
    ["체크한 항목이 생기면", makeInput({ checkedItemCount: 1 })],
    [
      "카테고리 상태를 남기면",
      makeInput({
        progress: progressOf({ venue: { category: "venue", status: "in_progress" } }),
      }),
    ],
    [
      '"해당 없음"으로 끈 것도 사용자가 남긴 결정이라',
      makeInput({
        progress: progressOf({ ham: { category: "ham", status: "not_applicable" } }),
      }),
    ],
    ["지출을 기록하면", makeInput({ spentBudget: 500_000 })],
    [
      "일정을 등록하면",
      makeInput({
        progress: progressOf({
          __events: [
            {
              id: "evt_1",
              date: "2026-09-01",
              title: "상견례",
              createdAt: "2026-08-20T00:00:00.000Z",
              updatedAt: "2026-08-20T00:00:00.000Z",
            },
          ],
        }),
      }),
    ],
  ])("%s 저절로 사라진다", (_label, input) => {
    expect(buildLoungeFirstArrival(input)).toBeNull();
  });

  it("단계·분위기 같은 예약 키만 있는 것은 '데이터가 생겼다'로 치지 않는다", () => {
    const view = buildLoungeFirstArrival(
      makeInput({
        progress: progressOf({
          __stage: "venue_booked",
          __preferences: { weddingStyle: "natural" },
        }),
      }),
    );
    expect(view).not.toBeNull();
  });
});

describe("사용자가 말하지 않은 것은 줄이 없다", () => {
  it("단계·분위기를 말했으면 그대로 되읽는다", () => {
    const view = buildLoungeFirstArrival(
      makeInput({
        progress: progressOf({
          __stage: "venue_booked",
          __preferences: { weddingStyle: "natural" },
        }),
      }),
    );

    expect(view?.echo).toEqual([
      // 카드의 다른 값이 전부 사람이 쓰는 말인데 날짜만 `2026-12-20`이면,
      // "들었다"가 아니라 저장된 레코드를 보여주는 느낌이 된다.
      { label: "결혼식", value: "12월 20일 · 122일 남음" },
      { label: "지금", value: "결혼식장을 계약했어요" },
      { label: "원하는 분위기", value: "편안한 분위기" },
    ]);
  });

  it("단계·분위기를 말하지 않았으면 그 줄 자체가 없다", () => {
    const view = buildLoungeFirstArrival(makeInput({ weddingDate: null }));

    expect(view?.echo).toEqual([]);
    expect(view?.echo.some((line) => line.label === "지금")).toBe(false);
    expect(view?.echo.some((line) => line.label === "원하는 분위기")).toBe(false);

    const html = renderToStaticMarkup(<LoungeFirstArrival view={view!} />);
    expect(html).toBe("");
    expect(renderToStaticMarkup(<LoungeFirstArrivalEmptyNote view={view!} />)).toBe("");
  });

  it("모르는 분위기 값은 지어내지 않고 줄을 빼버린다", () => {
    const view = buildLoungeFirstArrival(
      makeInput({
        progress: progressOf({ __preferences: { weddingStyle: "unknown_style" } }),
      }),
    );

    expect(view?.echo.some((line) => line.label === "원하는 분위기")).toBe(false);
  });
});

describe("초대 카드", () => {
  it("아직 혼자면 설정으로 보낸다 — 코드 자체는 라운지에 띄우지 않는다", () => {
    const view = buildLoungeFirstArrival(makeInput({ partnerLinked: false }));
    const html = renderToStaticMarkup(<LoungeFirstArrival view={view!} />);

    expect(html).toContain("파트너를 부르면 같이 봐요");
    expect(html).toContain("설정 &gt; 커플 연결");
    expect(html).not.toMatch(/WH-[A-Z0-9]/);
  });

  it("이미 연결됐으면 초대 카드가 없다", () => {
    const view = buildLoungeFirstArrival(makeInput({ partnerLinked: true }));

    expect(view?.invite).toBeNull();
    const html = renderToStaticMarkup(<LoungeFirstArrival view={view!} />);
    expect(html).not.toContain("파트너를 부르면 같이 봐요");
  });
});

describe("빈 이유 한 줄", () => {
  it("왜 비어 있는지를 말한다", () => {
    const view = buildLoungeFirstArrival(makeInput());
    const html = renderToStaticMarkup(<LoungeFirstArrivalEmptyNote view={view!} />);

    expect(html).toContain("두 분이 확인한 것만 쌓여요");
  });
});

describe("목적지는 전부 실재하는 화면이다", () => {
  const webRoot = path.resolve(__dirname, "../../..");

  function pageFileFor(routePath: string): string | null {
    const segment = routePath.replace(/^\//, "");
    const candidates = [
      path.join(webRoot, "src/app/(app)", segment, "page.tsx"),
      path.join(webRoot, "src/app", segment, "page.tsx"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  it.each(Object.entries(DESTINATION_PATH))(
    "%s → %s 에 실제 페이지가 있다",
    (_destination, routePath) => {
      expect(pageFileFor(routePath)).not.toBeNull();
    },
  );

  it("초대 카드가 여는 설정 화면도 실재한다", () => {
    expect(pageFileFor(INVITE_PATH)).not.toBeNull();
  });

  it("`/wedding` 아래로 여는 목적지는 리라이트 목록에 들어 있다", () => {
    const weddingScoped = Object.entries(DESTINATION_PATH)
      .filter(([destination]) => destination !== "price")
      .map(([, routePath]) => routePath.replace(/^\//, ""));

    for (const segment of [...weddingScoped, INVITE_PATH.replace(/^\//, "")]) {
      expect(WEDDING_APP_ROUTES).toContain(segment);
    }
  });

  it("공시 가격은 `/wedding` 아래에 없으므로 감싸면 안 된다", () => {
    // 감싸면 `/wedding/price`가 되는데 리라이트 대상이 아니라 그대로 404다.
    expect(WEDDING_APP_ROUTES).not.toContain("price");

    const view = buildLoungeFirstArrival(
      makeInput({ progress: progressOf({ __stage: "venue_hunting" }) }),
    );
    expect(view?.nextStep.destination).toBe("price");

    const html = renderToStaticMarkup(<LoungeFirstArrival view={view!} />);
    expect(html).toContain('href="/price"');
    expect(html).not.toContain("/wedding/price");
  });
  it("온보딩에서 받은 총 예산은 첫 도착 화면을 없애지 않는다", () => {
    // 웹 온보딩은 결혼 정보 단계에서 총 예산을 직접 받는다. 그 값을 "커플이 만든
    // 데이터"로 세면 예산을 적어 넣은 사람 — 정상 경로로 가입한 대부분 — 에게
    // 이 화면이 아예 뜨지 않는다. 앱은 처음부터 total_budget을 세지 않았고,
    // 두 플랫폼이 같은 순간에 같은 화면을 보여야 한다.
    expect(
      buildLoungeFirstArrival(makeInput({ totalBudget: 30_000_000 })),
    ).not.toBeNull();

    // 반면 실제로 쓴 돈을 기록했다면 라운지에 볼 것이 생긴 것이다.
    expect(
      buildLoungeFirstArrival(
        makeInput({ totalBudget: 30_000_000, spentBudget: 500_000 }),
      ),
    ).toBeNull();
  });

});

describe("온보딩이 채워준 제안값만 있는 상태는 '아직 아무것도 안 한' 상태다", () => {
  /** 온보딩의 "저장하고 시작하기"가 실제로 보내는 모양. */
  function progressFromStageSuggestion(
    option: (typeof PREPARATION_STAGE_OPTIONS)[number],
    extra: Record<string, unknown> = {},
  ) {
    const recorded: Record<string, unknown> = { __stage: option.value };
    for (const [key, status] of Object.entries(option.suggested)) {
      recorded[key] = { category: key, status };
    }
    return progressOf({ ...recorded, ...extra });
  }

  it.each(PREPARATION_STAGE_OPTIONS.map((option) => [option.value, option] as const))(
    "%s: 제안값 그대로면 첫 도착 화면이 나온다",
    (_value, option) => {
      // 제안값은 사용자가 화면에서 **확인한 것**이지 라운지에서 **한 일**이 아니다.
      // 이걸 "만든 데이터"로 세면 just_started가 아닌 단계를 고른 사람 — 5개 중 4개 —
      // 이 첫 도착 화면을 한 번도 못 본다.
      expect(
        buildLoungeFirstArrival(
          makeInput({ progress: progressFromStageSuggestion(option) }),
        ),
      ).not.toBeNull();
    },
  );

  it.each(PREPARATION_STAGE_OPTIONS.map((option) => [option.value, option] as const))(
    "%s: 제안에 없던 항목을 손으로 남기면 물러난다",
    (_value, option) => {
      expect(
        buildLoungeFirstArrival(
          makeInput({
            progress: progressFromStageSuggestion(option, {
              ham: { category: "ham", status: "completed" },
            }),
          }),
        ),
      ).toBeNull();
    },
  );

  it.each(
    PREPARATION_STAGE_OPTIONS.filter(
      (option) => Object.keys(option.suggested).length > 0,
    ).map((option) => [option.value, option] as const),
  )("%s: 제안값 한 칸을 고쳐도 물러난다", (_value, option) => {
    const [firstKey, firstStatus] = Object.entries(option.suggested)[0]!;
    const flipped = firstStatus === "completed" ? "in_progress" : "completed";

    expect(
      buildLoungeFirstArrival(
        makeInput({
          progress: progressFromStageSuggestion(option, {
            [firstKey]: { category: firstKey, status: flipped },
          }),
        }),
      ),
    ).toBeNull();
  });

  it("제안값이 있어도 남긴 항목이 더 적으면 진짜 입력으로 본다", () => {
    // 사용자가 제안된 항목 하나를 도로 비워둔 것도 사람이 한 결정이다.
    //
    // 단계를 이름으로 박지 않는다. 2026-08-22에 `venue_booked` 의 제안이 둘에서 하나로
    // 줄면서(상견례 제거) "하나만 남김"이 곧 "제안 그대로"가 돼 이 검사의 전제가 무너졌다.
    // 제안이 둘 이상인 단계를 그때그때 고른다.
    const option = PREPARATION_STAGE_OPTIONS.find(
      (candidate) => Object.keys(candidate.suggested).length >= 2,
    )!;
    expect(option, "제안이 둘 이상인 단계가 없다 — 이 검사의 전제를 다시 정해야 한다").toBeTruthy();
    const [firstKey] = Object.keys(option.suggested);

    expect(
      buildLoungeFirstArrival(
        makeInput({
          progress: progressOf({
            __stage: option.value,
            [firstKey!]: {
              category: firstKey,
              status: option.suggested[firstKey as keyof typeof option.suggested],
            },
          }),
        }),
      ),
    ).toBeNull();
  });

  it("단계를 모르는 커플에게는 카테고리가 하나라도 있으면 물러난다", () => {
    // 예전 온보딩으로 가입해 단계가 없는 커플에게는 비교할 제안값 자체가 없다.
    expect(
      buildLoungeFirstArrival(
        makeInput({
          progress: progressOf({ venue: { category: "venue", status: "completed" } }),
        }),
      ),
    ).toBeNull();
  });
});
