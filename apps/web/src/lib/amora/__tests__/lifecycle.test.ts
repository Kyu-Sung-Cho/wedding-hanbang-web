import { describe, expect, it } from "vitest";
import { CHECKLIST_AGREED_DATE } from "@hanbang/shared/utils";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { buildAmoraLifecyclePlan } from "../lifecycle";

describe("아모라 lifecycle 근거 경계", () => {
  it("legacy cost만으로 실제 지출과 예산 초과를 단정하지 않는다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-06-15",
      totalBudget: 50_000_000,
      progress: {
        venue: {
          status: "not_started",
          cost: 60_000_000,
        },
      },
      now: new Date("2026-06-15T03:00:00Z"),
    });

    expect(plan.spentBudget).toBe(0);
    expect(plan.guardrails.some((guardrail) => guardrail.id === "budget_over_limit")).toBe(false);
  });

  it("명시적으로 입력한 실제 지출이 예산을 넘으면 근거 범위를 함께 알린다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-06-15",
      totalBudget: 50_000_000,
      progress: {
        venue: {
          status: "in_progress",
          spent: 60_000_000,
        },
      },
      now: new Date("2026-06-15T03:00:00Z"),
    });

    const guardrail = plan.guardrails.find((item) => item.id === "budget_over_limit");
    expect(plan.spentBudget).toBe(60_000_000);
    expect(guardrail?.title).toBe("기록 지출 합계가 전체 예산보다 커요");
    expect(guardrail?.body).toContain("결제 완료 여부와는 별도");
    expect(guardrail?.title).not.toContain("이미");
  });

  it("서버 시간대와 무관하게 한국 날짜 기준으로 결혼식 당일을 판정한다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-06-16",
      totalBudget: 50_000_000,
      progress: {},
      // 2026-06-16 01:30 KST
      now: new Date("2026-06-15T16:30:00Z"),
    });

    expect(plan.dday).toBe(0);
    expect(plan.stage).toBe("wedding_day");
  });

  describe("기록이 없는 커플에게 지연을 단정하지 않는다", () => {
    // 온보딩에서 예식일을 받기로 하면서 생긴 새 비용이다. 예식이 10개월 안이면
    // 상견례(D-300)·예식장(D-270) 마감이 이미 지난 것으로 계산되는데, 방금
    // 가입한 커플에게 그건 "안 했다"가 아니라 "모른다"다.
    const soonWedding = {
      weddingDate: "2027-01-15",
      totalBudget: 0,
      now: new Date("2026-08-21T03:00:00Z"),
    };

    it("아무것도 기록하지 않았으면 마감 지연 경고를 만들지 않는다", () => {
      const plan = buildAmoraLifecyclePlan({ ...soonWedding, progress: {} });

      const overdue = plan.guardrails.filter(
        (guardrail) => guardrail.severity === "critical" && guardrail.categoryKey,
      );
      expect(overdue).toHaveLength(0);
    });

    it("대신 상황을 물어보는 안내 하나를 준다", () => {
      const plan = buildAmoraLifecyclePlan({ ...soonWedding, progress: {} });

      const asked = plan.guardrails.find((guardrail) => guardrail.id === "progress_unknown");
      expect(asked).toBeDefined();
      expect(asked?.severity).toBe("warning");
      // 지연을 사실로 말하지 않는다
      expect(asked?.body).toContain("알 수 없");
    });

    it("한 번이라도 기록했으면 지연을 정상적으로 알린다", () => {
      const plan = buildAmoraLifecyclePlan({
        ...soonWedding,
        progress: { venue: { status: "completed" } },
      });

      const overdue = plan.guardrails.filter(
        (guardrail) => guardrail.severity === "critical" && guardrail.categoryKey,
      );
      expect(overdue.length).toBeGreaterThan(0);
      expect(plan.guardrails.some((g) => g.id === "progress_unknown")).toBe(false);
    });

    it("항목 기록이 없는 분야는 예전처럼 분야 기본 시점으로 센다", () => {
      // 불변식: 아무것도 체크하지 않은 분야의 "지금 기준" 시점은 분야 `ddayDeadline`과 같다.
      const plan = buildAmoraLifecyclePlan({
        ...soonWedding,
        progress: { venue: { status: "completed" } },
      });
      const dday = plan.dday!;
      const overdue = plan.guardrails.filter(
        (guardrail) => guardrail.severity === "critical" && guardrail.categoryKey,
      );
      expect(overdue.length).toBeGreaterThan(0);
      for (const guardrail of overdue) {
        const template = CHECKLIST_MAP[guardrail.categoryKey!];
        expect(guardrail.dueLabel, guardrail.categoryKey).toBe(
          `${template.ddayDeadline - dday}일 지남`,
        );
      }
    });
  });

  describe("늦게 하는 항목만 남은 분야를 '지났어요'로 말하지 않는다", () => {
    // 사진 촬영 분야의 기본 확인 시점은 결혼식 150일 전이지만, 촬영 뒤 사진 고르기(90일 전)·
    // 앨범 받기(30일 전)·약속한 날에 받는 원본(날짜 모름)이 같은 분야에 있다. 분야 기준으로
    // 세던 때는 이른 일을 다 끝낸 커플도 D-120에 "기본 일정의 확인 시점보다 30일 지났어요"를
    // 위기(critical) 알림으로 받았다. 일정 화면의 임박 알림은 이미 항목 기준으로 센다.
    const now = new Date("2026-06-15T03:00:00Z");
    const studio = CHECKLIST_MAP.studio;

    /** 사진 촬영 분야만 남기고, 그 안에서 `isDone`이 참인 항목만 끝낸 기록. */
    function progressWithStudio(isDone: (item: { id: string; due?: unknown }) => boolean) {
      const progress: Record<string, unknown> = {};
      for (const category of CATEGORY_CHECKLISTS) {
        progress[category.key] = { status: "completed" };
      }
      progress.studio = {
        status: "in_progress",
        checklist: studio.items.map((item) => ({ id: item.id, label: item.label, done: isDone(item) })),
      };
      return progress;
    }
    const earlyItemsDone = progressWithStudio((item) => item.due === undefined);

    function studioGuardrails(weddingDate: string, progress: Record<string, unknown>) {
      const plan = buildAmoraLifecyclePlan({ weddingDate, totalBudget: 50_000_000, progress, now });
      return { plan, studio: plan.guardrails.filter((g) => g.categoryKey === "studio") };
    }

    it("표본이 전제를 만족한다 — 분야 시점보다 늦은 항목이 실제로 있다", () => {
      const lateDues = studio.items
        .map((item) => item.due)
        .filter((due): due is number => typeof due === "number");
      expect(studio.ddayDeadline).toBe(150);
      expect(Math.max(...lateDues)).toBe(90);
      expect(studio.items.some((item) => item.due === CHECKLIST_AGREED_DATE)).toBe(true);
    });

    it("D-120에 이른 일을 다 끝냈으면 지남 알림이 없다", () => {
      const { plan, studio: guardrails } = studioGuardrails("2026-10-13", earlyItemsDone);
      expect(plan.dday).toBe(120);
      // 남은 가장 이른 일은 90일 전 — 30일 남아 임박(21일) 창 밖이다.
      expect(guardrails).toEqual([]);
      expect(plan.guardrails.some((g) => g.body.includes("지났어요"))).toBe(false);
    });

    it("남은 항목의 시점이 21일 안이면 그 시점까지 남은 날로 알린다", () => {
      const { plan, studio: guardrails } = studioGuardrails("2026-09-23", earlyItemsDone);
      expect(plan.dday).toBe(100);
      expect(guardrails).toHaveLength(1);
      expect(guardrails[0].severity).toBe("warning");
      expect(guardrails[0].dueLabel).toBe("10일 남음");
    });

    it("남은 항목의 시점이 정말 지났으면 그 항목 기준 일수로 알린다", () => {
      const { plan, studio: guardrails } = studioGuardrails("2026-09-03", earlyItemsDone);
      expect(plan.dday).toBe(80);
      expect(guardrails).toHaveLength(1);
      expect(guardrails[0].severity).toBe("critical");
      expect(guardrails[0].dueLabel).toBe("10일 지남");
      expect(guardrails[0].body).toContain("10일 지났어요");
    });

    it("남은 일이 약속한 날에 하는 일뿐이면 날짜를 지어 내지 않는다", () => {
      const onlyAgreedDateLeft = progressWithStudio((item) => item.due !== CHECKLIST_AGREED_DATE);
      const { plan, studio: guardrails } = studioGuardrails("2026-07-05", onlyAgreedDateLeft);
      expect(plan.dday).toBe(20);
      expect(guardrails).toEqual([]);
    });
  });
});
