import { describe, expect, it } from "vitest";

import {
  auditAmoraPreparationCoverage,
} from "@hanbang/shared/amora-preparation-coverage";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

const CURRENT_CHECKLIST_TOPIC_KEYS = [
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
] as const;

const FULL_JOURNEY_AXIS_KEYS = [
  "foundation",
  "couple_and_family",
  "venue_and_guests",
  "photo_and_style",
  "ceremony_program",
  "vendors_and_money",
  "home_and_life",
  "travel_and_admin",
  "final_operations",
  "post_wedding",
] as const;

describe("Amora preparation coverage audit", () => {
  it("reports every current checklist topic while keeping unsupported journey work as explicit gaps", () => {
    const result = auditAmoraPreparationCoverage({
      checklistTopics: CATEGORY_CHECKLISTS,
    });

    expect(result.version).toBe(1);
    expect(result.scope).toBe("full_wedding_journey");
    expect(result.connectedChecklistTopics.map((topic) => topic.topicKey)).toEqual(
      CURRENT_CHECKLIST_TOPIC_KEYS,
    );
    expect(result.connectedChecklistTopics).toHaveLength(19);
    expect(result.connectedChecklistTopics.some((topic) => topic.topicKey === "reserve")).toBe(false);
    expect(result.axes.map((axis) => axis.axisKey)).toEqual(FULL_JOURNEY_AXIS_KEYS);
    expect(result.gaps.map((gap) => ({
      gapKey: gap.gapKey,
      disposition: gap.disposition,
      surfaceOwner: gap.surfaceOwner,
    }))).toEqual([
      {
        gapKey: "planning_foundation",
        disposition: "now",
        surfaceOwner: "onboarding_and_amora",
      },
      {
        gapKey: "guest_operations",
        disposition: "known_gap",
        surfaceOwner: "preparation_map",
      },
      {
        gapKey: "contract_record_safety",
        disposition: "known_gap",
        surfaceOwner: "preparation_topic",
      },
      {
        gapKey: "contract_transaction_execution",
        disposition: "parked",
        surfaceOwner: "none",
      },
      {
        gapKey: "marriage_admin",
        disposition: "known_gap",
        surfaceOwner: "preparation_map",
      },
      {
        gapKey: "wedding_day_operations",
        disposition: "known_gap",
        surfaceOwner: "preparation_map",
      },
      {
        gapKey: "post_wedding_closeout",
        disposition: "known_gap",
        surfaceOwner: "preparation_map",
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.isComplete).toBe(false);
  });

  it("reports duplicate checklist keys without duplicating the connected topic", () => {
    const result = auditAmoraPreparationCoverage({
      checklistTopics: [
        ...CATEGORY_CHECKLISTS,
        { ...CATEGORY_CHECKLISTS[0], label: "중복 부모님 첫 만남" },
      ],
    });

    expect(result.connectedChecklistTopics.map((topic) => topic.topicKey)).toEqual(
      CURRENT_CHECKLIST_TOPIC_KEYS,
    );
    expect(result.issues).toContainEqual({
      code: "duplicate_checklist_topic",
      topicKey: "meeting",
      inputIndex: CATEGORY_CHECKLISTS.length,
    });
  });

  it("reports a missing known checklist topic instead of silently shrinking coverage", () => {
    const result = auditAmoraPreparationCoverage({
      checklistTopics: CATEGORY_CHECKLISTS.filter((topic) => topic.key !== "venue"),
    });

    expect(result.connectedChecklistTopics.some((topic) => topic.topicKey === "venue")).toBe(false);
    expect(result.issues).toContainEqual({
      code: "missing_checklist_topic",
      topicKey: "venue",
    });
  });

  it("reports a newly introduced checklist topic until its journey mapping is reviewed", () => {
    const result = auditAmoraPreparationCoverage({
      checklistTopics: [
        ...CATEGORY_CHECKLISTS,
        { key: "guest_ops_v2", label: "하객 운영", items: [] },
      ],
    });

    expect(
      result.connectedChecklistTopics.some((topic) => topic.topicKey === "guest_ops_v2"),
    ).toBe(false);
    expect(result.issues).toContainEqual({
      code: "unmapped_checklist_topic",
      topicKey: "guest_ops_v2",
      inputIndex: CATEGORY_CHECKLISTS.length,
    });
  });

  it("reports malformed topic adapters without throwing or trusting prototype keys", () => {
    const malformedTopics = [
      null,
      { key: "" },
      { key: "meeting", label: "" },
      { key: "__proto__", label: "prototype key" },
    ] as unknown as readonly Readonly<{ key: string; label?: string }>[];

    expect(() => auditAmoraPreparationCoverage({ checklistTopics: malformedTopics })).not.toThrow();
    const result = auditAmoraPreparationCoverage({ checklistTopics: malformedTopics });

    expect(result.issues).toEqual(expect.arrayContaining([
      { code: "invalid_checklist_topic", inputIndex: 0 },
      { code: "invalid_checklist_topic", inputIndex: 1 },
      { code: "invalid_checklist_topic", inputIndex: 2 },
      { code: "unmapped_checklist_topic", topicKey: "__proto__", inputIndex: 3 },
    ]));
    expect(result.connectedChecklistTopics).toEqual([]);
  });

  it("derives every journey-axis status from actual connections and explicit gaps", () => {
    const current = auditAmoraPreparationCoverage({ checklistTopics: CATEGORY_CHECKLISTS });

    expect(Object.fromEntries(current.axes.map((axis) => [axis.axisKey, axis.status]))).toEqual({
      foundation: "gap",
      couple_and_family: "connected",
      venue_and_guests: "partial",
      photo_and_style: "connected",
      ceremony_program: "partial",
      vendors_and_money: "partial",
      home_and_life: "connected",
      travel_and_admin: "partial",
      final_operations: "partial",
      post_wedding: "partial",
    });

    const noAdapters = auditAmoraPreparationCoverage({ checklistTopics: [] });
    expect(noAdapters.axes).toHaveLength(FULL_JOURNEY_AXIS_KEYS.length);
    expect(noAdapters.axes.every((axis) => axis.status === "gap")).toBe(true);
  });
});
