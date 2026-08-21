import { describe, expect, it } from "vitest";

import {
  buildNeutralPreparationPrefill,
  buildNeutralPreparationSpaceSubmission,
  isValidWeddingDateInput,
  parseNeutralPreparationSpaceCapability,
  resolveNeutralPreparationSpaceRedirect,
} from "./neutralPreparationSpace";

describe("web neutral preparation-space onboarding", () => {
  it("accepts only the server's exact enabled capability", () => {
    expect(parseNeutralPreparationSpaceCapability({
      neutralPreparationSpace: true,
    })).toBe(true);
    expect(parseNeutralPreparationSpaceCapability({
      neutralPreparationSpace: false,
    })).toBe(false);
    expect(parseNeutralPreparationSpaceCapability({
      neutralPreparationSpace: "true",
    })).toBe(false);
    expect(parseNeutralPreparationSpaceCapability(null)).toBe(false);
  });

  it("creates a roleless empty preparation space without hidden personal inputs", () => {
    expect(buildNeutralPreparationSpaceSubmission({
      coupleAction: "create",
      partnerInviteCode: "",
    })).toEqual({
      membershipMode: "neutral_preparation_space",
      coupleAction: "create",
      weddingDate: null,
      venue: null,
      totalBudget: null,
      progress: {},
    });
  });

  it("normalizes only a valid join code and never adds a compatibility role", () => {
    expect(buildNeutralPreparationSpaceSubmission({
      coupleAction: "join",
      partnerInviteCode: " wh-ab12cd ",
    })).toEqual({
      membershipMode: "neutral_preparation_space",
      coupleAction: "join",
      partnerInviteCode: "WH-AB12CD",
      weddingDate: null,
      venue: null,
      totalBudget: null,
      progress: {},
    });
    expect(() => buildNeutralPreparationSpaceSubmission({
      coupleAction: "join",
      partnerInviteCode: "invalid",
    })).toThrow("INVALID_NEUTRAL_PREPARATION_INVITE_CODE");
  });

  it("opens Amora by default while preserving an explicit safe destination", () => {
    expect(resolveNeutralPreparationSpaceRedirect({
      search: "",
      origin: "https://hanbang.ai",
    })).toBe("/wedding/chat?source=neutral_onboarding");
    expect(resolveNeutralPreparationSpaceRedirect({
      search: "?redirect=%2Fwedding%2Fbudget",
      origin: "https://hanbang.ai",
    })).toBe("/wedding/budget");
    expect(resolveNeutralPreparationSpaceRedirect({
      search: "?redirect=https%3A%2F%2Fevil.example",
      origin: "https://hanbang.ai",
    })).toBe("/wedding/chat?source=neutral_onboarding");
  });

  describe("예식일", () => {
    // 예식일만 받는 이유는 응답률(87%)이 아니라, 아모라가 대신 받아낼 수 없다는
    // 것이다 — 첫 인사는 저장 정보를 못 꺼내고, 도구 게이트는 "내년 5월 20일에
    // 결혼해" 같은 자족 확정문만 통과시킨다.
    it("실재하지 않는 날짜는 통과시키지 않는다", () => {
      expect(isValidWeddingDateInput("2027-05-20")).toBe(true);
      expect(isValidWeddingDateInput("2027-02-30")).toBe(false);
      expect(isValidWeddingDateInput("2027-13-01")).toBe(false);
      expect(isValidWeddingDateInput("27-05-20")).toBe(false);
      expect(isValidWeddingDateInput("")).toBe(false);
    });

    it("날짜가 이상해도 가입 자체를 막지는 않는다", () => {
      // 시작 버튼을 눌렀을 뿐인데 날짜 하나 때문에 막히면 안 된다.
      const body = buildNeutralPreparationSpaceSubmission({
        coupleAction: "create",
        partnerInviteCode: "",
        weddingDate: "2027-02-30",
      });
      expect(body.weddingDate).toBeNull();
      expect(body.membershipMode).toBe("neutral_preparation_space");
    });

    it("고른 날짜는 그대로 실어 보낸다", () => {
      expect(buildNeutralPreparationSpaceSubmission({
        coupleAction: "create",
        partnerInviteCode: "",
        weddingDate: "2027-05-20",
      }).weddingDate).toBe("2027-05-20");
    });
  });

  describe("관심사와 첫 대화 초안", () => {
    it("고른 관심사는 이미 서버가 받는 자리로 간다", () => {
      expect(buildNeutralPreparationSpaceSubmission({
        coupleAction: "create",
        partnerInviteCode: "",
        focusPriority: "housing",
      }).progress).toEqual({ __preferences: { priorities: ["housing"] } });
    });

    it("장소·예산은 여전히 묻지 않는다", () => {
      const body = buildNeutralPreparationSpaceSubmission({
        coupleAction: "create",
        partnerInviteCode: "",
        weddingDate: "2027-05-20",
        focusPriority: "venue",
      });
      expect(body.venue).toBeNull();
      expect(body.totalBudget).toBeNull();
    });

    it("초안에 날짜를 넣지 않는다 — 방금 저장한 값의 확인 카드가 또 뜬다", () => {
      const prefill = buildNeutralPreparationPrefill({
        weddingDate: "2027-05-20",
        focusPriority: "housing",
      });
      expect(prefill).not.toBeNull();
      expect(prefill).not.toContain("2027");
      expect(prefill).toContain("신혼집");
    });

    it("아무것도 안 고르고 날짜도 없으면 초안이 없다", () => {
      expect(buildNeutralPreparationPrefill({
        weddingDate: null,
        focusPriority: null,
      })).toBeNull();
    });

    it("초안은 리다이렉트에 붙되 명시적 목적지에는 붙지 않는다", () => {
      const withPrefill = resolveNeutralPreparationSpaceRedirect({
        search: "",
        origin: "https://hanbang.ai",
        prefill: "신혼집부터 볼래요",
      });
      expect(withPrefill).toContain("/wedding/chat");
      expect(withPrefill).toContain("prefill=");

      // 사용자가 직접 요청한 목적지는 대화하러 온 게 아니다
      const requested = resolveNeutralPreparationSpaceRedirect({
        search: "?redirect=%2Fwedding%2Fbudget",
        origin: "https://hanbang.ai",
        prefill: "신혼집부터 볼래요",
      });
      expect(requested).toBe("/wedding/budget");
    });
  });
});
