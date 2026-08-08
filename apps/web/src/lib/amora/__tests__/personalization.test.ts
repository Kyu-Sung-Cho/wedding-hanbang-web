import { describe, expect, it } from "vitest";

import {
  AMORA_QUICK_START_OPTIONS,
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  mergeAmoraPersonalization,
  parseAmoraPersonalizationProfile,
  parseAmoraPersonalizationRow,
} from "@/lib/amora/personalization";

describe("Amora personalization contract", () => {
  it("keeps quick-start choices explicit and limited to one preference field", () => {
    expect(AMORA_QUICK_START_OPTIONS).toHaveLength(4);
    for (const option of AMORA_QUICK_START_OPTIONS) {
      expect(Object.keys(option.changes)).toHaveLength(1);
      expect(option.message).not.toMatch(/성격|유형|궁합|진단/);
      expect(option.confirmation).toContain("앞으로");
    }
  });

  it("accepts only allowlisted partial changes", () => {
    expect(isAmoraPersonalizationChanges({
      decisionStart: "recommend_first",
    })).toBe(true);
    expect(isAmoraPersonalizationChanges({
      supportOrder: "listen_first",
      answerDetail: "brief",
      toneStyle: "warm",
    })).toBe(true);
    expect(isAmoraPersonalizationChanges({})).toBe(false);
    expect(isAmoraPersonalizationChanges({
      decisionStart: "personality_type",
    })).toBe(false);
    expect(isAmoraPersonalizationChanges({
      hiddenCompatibilityScore: 98,
    })).toBe(false);
    expect(isAmoraPersonalizationChanges({
      toneStyle: "banmal",
    })).toBe(false);
  });

  it("merges a confirmed change without inferring unrelated settings", () => {
    expect(
      mergeAmoraPersonalization(null, {
        decisionStart: "compare_first",
      }),
    ).toEqual({
      ...DEFAULT_AMORA_PERSONALIZATION,
      decisionStart: "compare_first",
    });
  });

  it("fails closed on malformed stored profiles", () => {
    const valid = {
      preferences: {
        ...DEFAULT_AMORA_PERSONALIZATION,
        supportOrder: "action_first",
        toneStyle: "friendly_honest",
      },
      revision: 1,
      confirmedAt: "2026-07-31T08:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
    };

    expect(parseAmoraPersonalizationProfile(valid)).toEqual(valid);
    expect(parseAmoraPersonalizationProfile({
      ...valid,
      preferences: {
        ...valid.preferences,
        familyOrder: "always_obey_family",
      },
    })).toBeNull();
    expect(parseAmoraPersonalizationProfile({
      ...valid,
      revision: 0,
    })).toBeNull();
    expect(parseAmoraPersonalizationProfile({
      ...valid,
      preferences: {
        ...valid.preferences,
        toneStyle: "expert_roleplay",
      },
    })).toBeNull();
  });

  it("parses only a valid database row and fails neutral on unknown values", () => {
    const row = {
      decision_start: "compare_first",
      answer_detail: "adaptive",
      support_order: "ask_each_time",
      work_mode: "hybrid",
      family_order: "case_by_case",
      tone_style: "calm_clear",
      revision: 2,
      confirmed_at: "2026-07-31T08:00:00.000Z",
      updated_at: "2026-07-31T09:00:00.000Z",
    };

    expect(parseAmoraPersonalizationRow(row)?.preferences).toEqual({
      decisionStart: "compare_first",
      answerDetail: "adaptive",
      supportOrder: "ask_each_time",
      workMode: "hybrid",
      familyOrder: "case_by_case",
      toneStyle: "calm_clear",
    });
    expect(parseAmoraPersonalizationRow({
      ...row,
      decision_start: "secret_personality_mode",
    })).toBeNull();
  });
});
