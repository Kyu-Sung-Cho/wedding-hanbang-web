import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildCandidate6Journey,
  CANDIDATE6_BIPOLAR_DIRECTIONS,
  CANDIDATE6_ESCAPE_RESPONSES,
  CANDIDATE6_EVIDENCE_SOURCE_REGISTRY,
  CANDIDATE6_IMPACT_LEVELS,
  CANDIDATE6_INTERVIEW_ELIGIBILITY_SCREENER,
  CANDIDATE6_INTERVIEW_PANELS,
  CANDIDATE6_ITEM_EVIDENCE_LINKS,
  CANDIDATE6_ITEM_REVIEW_FLAGS,
  CANDIDATE6_NEUTRAL_CONVERSATION_CARDS,
  CANDIDATE6_RESEARCH_EXACT_VERSION,
  CANDIDATE6_RESEARCH_ITEMS,
  CANDIDATE6_RESEARCH_THEMES,
  CANDIDATE6_STAKEHOLDER_APPLICABILITY_CONTRACT,
  isCandidate6BipolarVisuallyReversed,
  normalizeCandidate6BipolarVisualChoice,
  planCandidate6InterviewAssignment,
  summarizeCandidate6InterviewTracking,
  type Candidate6InterviewTrackingRow,
} from "../candidate6";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../../..");
const TEST_ASSIGNMENT_IDENTITY = {
  assignmentId: "00000000-0000-4000-8000-000000000001",
  form: "A",
  rotationIndex: 0,
} as const;

let trackingAssignmentSequence = 100;

function readyAssignment(overrides: Partial<Parameters<
  typeof planCandidate6InterviewAssignment
>[0]> = {}) {
  trackingAssignmentSequence += 1;
  const assignment = planCandidate6InterviewAssignment({
    assignmentId: `00000000-0000-4000-8000-${String(trackingAssignmentSequence).padStart(12, "0")}`,
    form: "A",
    rotationIndex: 0,
    panel: "P2",
    eligibility: {
      recording: "eligible",
      "vendor-assisted": "eligible",
      "partner-collaboration": "eligible",
    },
    stakeholderApplicability: "not_applicable",
    supportPairOrder: "ES_FIRST",
    ...overrides,
  });
  if (assignment.status !== "ready") {
    throw new Error("Expected a ready Candidate 6 test assignment.");
  }
  return assignment;
}

function observeAssignmentRow(
  assignment: ReturnType<typeof readyAssignment>,
  requestedItemId: Candidate6InterviewTrackingRow["requestedItemId"],
  observation: Partial<Pick<
    Candidate6InterviewTrackingRow,
    "assigned" | "administered" | "eligibilityAtAssignment" | "responseDisposition"
  >>,
) {
  return assignment.trackingTemplate.map((row) =>
    row.requestedItemId === requestedItemId ? { ...row, ...observation } : row
  );
}

describe("Candidate 6.3 M0 research contract", () => {
  it("keeps a unique, non-score-eligible item pool grouped only by research themes", () => {
    expect(CANDIDATE6_RESEARCH_EXACT_VERSION).toBe("wedding-code-candidate6-research.3");
    expect(CANDIDATE6_RESEARCH_THEMES).toEqual(["DS", "JI", "OA", "CP", "ES", "AS", "SI"]);
    expect(CANDIDATE6_RESEARCH_ITEMS).toHaveLength(21);
    expect(new Set(CANDIDATE6_RESEARCH_ITEMS.map((item) => item.id)).size).toBe(21);

    const expectedCounts = { DS: 4, JI: 3, OA: 3, CP: 3, ES: 3, AS: 3, SI: 2 } as const;
    for (const [theme, count] of Object.entries(expectedCounts)) {
      expect(CANDIDATE6_RESEARCH_ITEMS.filter((item) => item.theme === theme)).toHaveLength(count);
    }

    for (const item of CANDIDATE6_RESEARCH_ITEMS) {
      expect(item.scoreEligible).toBe(false);
      expect(item.evidence.measurementGrade).toBe("M0");
      expect(item.evidence.disposition).toBe("COGNITIVE_INTERVIEW_REQUIRED");
      expect(item.evidence.sources.length).toBeGreaterThan(0);
      expect(item.evidence.alternativeExplanations.length).toBeGreaterThan(0);
      expect(item.premise.trim().length).toBeGreaterThan(15);
      expect(item.scenario.trim().length).toBeGreaterThan(10);
      for (const source of item.evidence.sources) {
        expect(CANDIDATE6_EVIDENCE_SOURCE_REGISTRY[source]).toBeDefined();
      }

      const evidenceLinks = CANDIDATE6_ITEM_EVIDENCE_LINKS[item.id];
      expect(new Set(evidenceLinks.map((link) => link.source))).toEqual(
        new Set(item.evidence.sources)
      );
      for (const link of evidenceLinks) {
        expect(link.locator.length).toBeGreaterThan(20);
        expect(link.supportedContextClaim.length).toBeGreaterThan(30);
        expect(link.measurementLimitation).toContain("does not validate");
      }
    }
  });

  it("links DS4 only to reproducible internal-map scenarios without claiming item validity", () => {
    const [link] = CANDIDATE6_ITEM_EVIDENCE_LINKS["C6-DS4"];

    expect(link.locator).toBe(
      "§2 experienceMeaning scenarios 6 and 11; aestheticMood scenarios 2 and 10"
    );
    expect(link.supportedContextClaim).toContain("design contexts plausible");
    expect(link.supportedContextClaim).toContain("does not establish");
    expect(link.supportedContextClaim).toContain("DS construct");
  });

  it("keeps contextual stakeholder tools after the core and preserves applicability meanings", () => {
    for (const item of CANDIDATE6_RESEARCH_ITEMS) {
      if (item.theme === "SI") {
        expect(item.module).toBe("contextual-stakeholder");
        expect(item.analysisRole).toBe("contextual-tool");
      } else {
        expect(item.module).toBe("core");
        expect(item.analysisRole).toBe("hypothesis-item");
      }
    }

    expect(buildCandidate6Journey("A", "not_applicable")).toHaveLength(19);
    expect(buildCandidate6Journey("B", "unsure")).toHaveLength(19);
    expect(buildCandidate6Journey("A", "applicable")).toHaveLength(21);
    expect(buildCandidate6Journey("B", "applicable")).toHaveLength(21);
    expect(buildCandidate6Journey("A", "not_applicable").some((item) => item.theme === "SI")).toBe(false);

    const applicable = buildCandidate6Journey("A", "applicable");
    expect(applicable.filter((item) => item.theme === "SI").map((item) => item.id)).toEqual([
      "C6-SI1",
      "C6-SI2",
    ]);
    expect(applicable.slice(-2).map((item) => item.id)).toEqual(["C6-SI1", "C6-SI2"]);
    expect(CANDIDATE6_STAKEHOLDER_APPLICABILITY_CONTRACT.unsure).toContain("never merge");
    expect(CANDIDATE6_STAKEHOLDER_APPLICABILITY_CONTRACT.not_applicable).toContain(
      "structural non-applicability"
    );
  });

  it("separates endpoint form from support-pair order and moves SI as one final block", () => {
    for (const supportOrder of ["ES_FIRST", "AS_FIRST"] as const) {
      for (const applicability of ["not_applicable", "unsure", "applicable"] as const) {
        expect(
          buildCandidate6Journey("A", applicability, supportOrder).map((item) => item.id)
        ).toEqual(buildCandidate6Journey("B", applicability, supportOrder).map((item) => item.id));
      }
    }

    const esFirst = buildCandidate6Journey("A", "applicable", "ES_FIRST");
    const asFirst = buildCandidate6Journey("A", "applicable", "AS_FIRST");
    expect(new Set(esFirst.map((item) => item.id))).toEqual(new Set(asFirst.map((item) => item.id)));
    for (const pair of [1, 2, 3] as const) {
      expect(esFirst.findIndex((item) => item.id === `C6-ES${pair}`)).toBeLessThan(
        esFirst.findIndex((item) => item.id === `C6-AS${pair}`)
      );
      expect(asFirst.findIndex((item) => item.id === `C6-AS${pair}`)).toBeLessThan(
        asFirst.findIndex((item) => item.id === `C6-ES${pair}`)
      );
    }
    expect(esFirst.slice(-2).map((item) => item.theme)).toEqual(["SI", "SI"]);
  });

  it("provides balanced 8-10 item cognitive-interview panels without using the full journey", () => {
    const eligibility = {
      recording: "eligible",
      "vendor-assisted": "eligible",
      "partner-collaboration": "eligible",
    } as const;
    const covered = new Set<string>();
    for (const panel of Object.keys(CANDIDATE6_INTERVIEW_PANELS) as Array<
      keyof typeof CANDIDATE6_INTERVIEW_PANELS
    >) {
      const withoutContext = planCandidate6InterviewAssignment({
        ...TEST_ASSIGNMENT_IDENTITY,
        panel,
        eligibility,
        stakeholderApplicability: "not_applicable",
        supportPairOrder: "ES_FIRST",
      });
      const withContext = planCandidate6InterviewAssignment({
        ...TEST_ASSIGNMENT_IDENTITY,
        panel,
        eligibility,
        stakeholderApplicability: "applicable",
        supportPairOrder: "AS_FIRST",
      });
      expect(withoutContext.status).toBe("ready");
      expect(withContext.status).toBe("ready");
      expect(withoutContext.items).toHaveLength(8);
      expect(withContext.items.length).toBeGreaterThanOrEqual(9);
      expect(withContext.items.length).toBeLessThanOrEqual(10);
      for (const item of withContext.items) covered.add(item.id);

      for (const pair of [1, 2, 3] as const) {
        const esIndex = withContext.items.findIndex((item) => item.id === `C6-ES${pair}`);
        const asIndex = withContext.items.findIndex((item) => item.id === `C6-AS${pair}`);
        if (esIndex >= 0 && asIndex >= 0) expect(asIndex).toBeLessThan(esIndex);
      }
    }
    expect(covered).toEqual(new Set(CANDIDATE6_RESEARCH_ITEMS.map((item) => item.id)));
    expect(Object.keys(CANDIDATE6_INTERVIEW_ELIGIBILITY_SCREENER)).toEqual([
      "recording",
      "vendor-assisted",
      "partner-collaboration",
    ]);
  });

  it("replaces ineligible recording and vendor items only with eligible same-theme items", () => {
    const assignment = planCandidate6InterviewAssignment({
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P2",
      eligibility: {
        recording: "not_applicable",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "not_applicable",
      supportPairOrder: "ES_FIRST",
    });

    expect(assignment.status).toBe("ready");
    expect(assignment).toMatchObject({
      panel: "P2",
      stakeholderApplicability: "not_applicable",
      eligibilitySnapshot: {
        recording: "not_applicable",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
    });
    expect(assignment.items).toHaveLength(8);
    expect(assignment.items.map((item) => item.id)).not.toContain("C6-DS2");
    expect(assignment.items.map((item) => item.id)).not.toContain("C6-DS3");
    expect(assignment.substitutions).toEqual([
      {
        originalItemId: "C6-DS2",
        replacementItemId: "C6-DS1",
        originalEligibility: "not_applicable",
        rule: "SAME_THEME_ELIGIBLE_NOT_ALREADY_ASSIGNED",
      },
      {
        originalItemId: "C6-DS3",
        replacementItemId: "C6-DS4",
        originalEligibility: "not_applicable",
        rule: "SAME_THEME_ELIGIBLE_NOT_ALREADY_ASSIGNED",
      },
    ]);
  });

  it("preserves a reproducible assignment identity and original-to-substitute lineage in every ledger row", () => {
    const assignment = planCandidate6InterviewAssignment({
      assignmentId: "00000000-0000-4000-8000-000000000002",
      form: "B",
      rotationIndex: 0,
      panel: "P2",
      eligibility: {
        recording: "not_applicable",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "applicable",
      supportPairOrder: "AS_FIRST",
    });

    expect(assignment.status).toBe("ready");
    expect(assignment.trackingTemplate).toHaveLength(assignment.items.length);
    expect(assignment.trackingTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "00000000-0000-4000-8000-000000000002",
          exactVersion: CANDIDATE6_RESEARCH_EXACT_VERSION,
          form: "B",
          supportPairOrder: "AS_FIRST",
          rotationIndex: 0,
          panel: "P2",
          stakeholderApplicability: "applicable",
          requestedItemId: "C6-DS2",
          itemId: "C6-DS1",
          replacementItemId: "C6-DS1",
          originalEligibility: "not_applicable",
        }),
        expect.objectContaining({
          assignmentId: "00000000-0000-4000-8000-000000000002",
          exactVersion: CANDIDATE6_RESEARCH_EXACT_VERSION,
          form: "B",
          supportPairOrder: "AS_FIRST",
          rotationIndex: 0,
          requestedItemId: "C6-SI2",
          itemId: "C6-SI2",
          replacementItemId: null,
          originalEligibility: "eligible",
        }),
      ])
    );
  });

  it("rotates eligible same-theme substitutes reproducibly instead of favoring declaration order", () => {
    const request = {
      form: "A",
      panel: "P2",
      eligibility: {
        recording: "not_applicable",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "not_applicable",
      supportPairOrder: "ES_FIRST",
    } as const;
    const first = planCandidate6InterviewAssignment({
      ...request,
      assignmentId: "00000000-0000-4000-8000-000000000010",
      rotationIndex: 0,
    });
    const firstRepeat = planCandidate6InterviewAssignment({
      ...request,
      assignmentId: "00000000-0000-4000-8000-000000000011",
      rotationIndex: 0,
    });
    const second = planCandidate6InterviewAssignment({
      ...request,
      assignmentId: "00000000-0000-4000-8000-000000000012",
      rotationIndex: 1,
    });

    expect(first.substitutions.map((entry) => entry.replacementItemId)).toEqual([
      "C6-DS1",
      "C6-DS4",
    ]);
    expect(firstRepeat.substitutions.map((entry) => entry.replacementItemId)).toEqual([
      "C6-DS1",
      "C6-DS4",
    ]);
    expect(second.substitutions.map((entry) => entry.replacementItemId)).toEqual([
      "C6-DS4",
      "C6-DS1",
    ]);
  });

  it("rejects assignment identities that cannot be reproduced safely", () => {
    const request = {
      form: "A",
      rotationIndex: 0,
      panel: "P1",
      eligibility: {
        recording: "eligible",
        "vendor-assisted": "eligible",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "not_applicable",
      supportPairOrder: "ES_FIRST",
    } as const;

    expect(() =>
      planCandidate6InterviewAssignment({ ...request, assignmentId: "  " })
    ).toThrow("assignmentId");
    for (const assignmentId of [
      "ab",
      "a".repeat(81),
      "c6-control\nline",
      "웨딩코드-r1-001",
      "c6 id with spaces",
    ]) {
      expect(() => planCandidate6InterviewAssignment({ ...request, assignmentId })).toThrow(
        "assignmentId"
      );
    }
    expect(() =>
      planCandidate6InterviewAssignment({
        ...request,
        assignmentId: "00000000-0000-4000-8000-000000000013",
        rotationIndex: -1,
      })
    ).toThrow("rotationIndex");
  });

  it("rejects every invalid runtime enum instead of silently changing assignment semantics", () => {
    const request = {
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P1",
      eligibility: {
        recording: "eligible",
        "vendor-assisted": "eligible",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "not_applicable",
      supportPairOrder: "ES_FIRST",
    } as const;

    expect(() => planCandidate6InterviewAssignment({ ...request, form: "C" } as never))
      .toThrow("form");
    expect(() => planCandidate6InterviewAssignment({
      ...request,
      supportPairOrder: "BROKEN",
    } as never)).toThrow("supportPairOrder");
    expect(() => planCandidate6InterviewAssignment({
      ...request,
      stakeholderApplicability: "BROKEN",
    } as never)).toThrow("stakeholderApplicability");
    expect(() => planCandidate6InterviewAssignment({ ...request, panel: "P9" } as never))
      .toThrow("panel");
    expect(() => planCandidate6InterviewAssignment({
      ...request,
      eligibility: { ...request.eligibility, recording: "BROKEN" },
    } as never)).toThrow("eligibility.recording");
  });

  it("keeps not-applicable and unsure stakeholder assignments distinct in the ledger", () => {
    const base = {
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P1",
      eligibility: {
        recording: "eligible",
        "vendor-assisted": "eligible",
        "partner-collaboration": "eligible",
      },
      supportPairOrder: "ES_FIRST",
    } as const;
    const notApplicable = planCandidate6InterviewAssignment({
      ...base,
      stakeholderApplicability: "not_applicable",
    });
    const unsure = planCandidate6InterviewAssignment({
      ...base,
      stakeholderApplicability: "unsure",
    });

    expect(notApplicable.items.map((item) => item.id)).toEqual(
      unsure.items.map((item) => item.id),
    );
    expect(notApplicable.stakeholderApplicability).toBe("not_applicable");
    expect(unsure.stakeholderApplicability).toBe("unsure");
    expect(notApplicable.trackingTemplate.every((row) =>
      row.stakeholderApplicability === "not_applicable"
    )).toBe(true);
    expect(unsure.trackingTemplate.every((row) =>
      row.stakeholderApplicability === "unsure"
    )).toBe(true);
  });

  it("blocks R1 assignment when partner-collaboration eligibility is unresolved", () => {
    const assignment = planCandidate6InterviewAssignment({
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P1",
      eligibility: {
        recording: "eligible",
        "vendor-assisted": "eligible",
        "partner-collaboration": "unsure",
      },
      stakeholderApplicability: "applicable",
      supportPairOrder: "ES_FIRST",
    });

    expect(assignment.status).toBe("incompatible");
    expect(assignment.items).toEqual([]);
    expect(assignment.unresolved).toHaveLength(6);
    expect(new Set(assignment.unresolved.map((item) => item.eligibility))).toEqual(
      new Set(["unsure"])
    );
    expect(
      assignment.unresolved.every((item) => item.reason === "NO_ELIGIBLE_SAME_THEME_SUBSTITUTE")
    ).toBe(true);
  });

  it("summarizes assigned, administered, eligible, and non-applicable counts per item", () => {
    const answered = readyAssignment();
    const laterNotApplicable = readyAssignment();
    const substituted = readyAssignment({
      eligibility: {
        recording: "unsure",
        "vendor-assisted": "eligible",
        "partner-collaboration": "eligible",
      },
      rotationIndex: 1,
    });
    const rows = [
      ...observeAssignmentRow(answered, "C6-DS2", {
        administered: true,
        responseDisposition: "answered",
      }),
      ...observeAssignmentRow(laterNotApplicable, "C6-DS2", {
        administered: true,
        responseDisposition: "not_applicable",
      }),
      ...substituted.trackingTemplate,
    ];
    const counts = summarizeCandidate6InterviewTracking(
      rows,
      [answered, laterNotApplicable, substituted],
    );

    expect(counts["C6-DS2"]).toEqual({
      requested: 3,
      requestedEligible: 2,
      requestedNotApplicable: 0,
      requestedUnsure: 1,
      assigned: 2,
      administered: 2,
      eligible: 2,
      notApplicable: 1,
    });
  });

  it("counts assignment eligibility independently from a later non-applicable response", () => {
    const assignment = readyAssignment();
    const counts = summarizeCandidate6InterviewTracking(
      observeAssignmentRow(assignment, "C6-DS2", {
        administered: true,
        responseDisposition: "not_applicable",
      }),
      [assignment],
    );

    expect(counts["C6-DS2"].eligible).toBe(1);
    expect(counts["C6-DS2"].notApplicable).toBe(1);
  });

  it("counts unresolved original requests separately from eligible substitutions", () => {
    const assignment = planCandidate6InterviewAssignment({
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P2",
      eligibility: {
        recording: "not_applicable",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "not_applicable",
      supportPairOrder: "ES_FIRST",
    });
    expect(assignment.status).toBe("ready");
    if (assignment.status !== "ready") throw new Error("Expected a ready assignment.");
    const substitution = assignment.substitutions[0];
    if (!substitution) throw new Error("Expected a same-theme substitution fixture.");
    const replacementRow = assignment.trackingTemplate.find(
      (row) => row.requestedItemId === substitution.originalItemId,
    );
    expect(replacementRow).toBeDefined();

    const counts = summarizeCandidate6InterviewTracking(
      assignment.trackingTemplate,
      [assignment],
    );

    expect(counts[substitution.originalItemId].requested).toBe(1);
    expect(counts[substitution.originalItemId].requestedNotApplicable).toBe(1);
    expect(counts[substitution.replacementItemId].assigned).toBe(1);
    expect(counts[substitution.replacementItemId].eligible).toBe(1);
  });

  it("rejects duplicate, mixed-version, mixed-metadata, and invalid-lineage ledger rows", () => {
    const assignment = planCandidate6InterviewAssignment({
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P2",
      eligibility: {
        recording: "not_applicable",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "applicable",
      supportPairOrder: "ES_FIRST",
    });
    expect(assignment.status).toBe("ready");
    if (assignment.status !== "ready") throw new Error("Expected a ready assignment.");
    const [first, second] = assignment.trackingTemplate;

    expect(() => summarizeCandidate6InterviewTracking([first, first], [assignment]))
      .toThrow("Duplicate Candidate 6 tracking row");
    expect(() => summarizeCandidate6InterviewTracking([{
      ...first,
      exactVersion: "wedding-code-candidate6-research.2",
    } as unknown as Candidate6InterviewTrackingRow], [assignment])).toThrow("unsupported exactVersion");
    expect(() => summarizeCandidate6InterviewTracking([
      first,
      { ...second, form: "B" },
    ], [assignment])).toThrow("mixes incompatible metadata");
    expect(() => summarizeCandidate6InterviewTracking([{
      ...first,
      replacementItemId: "C6-JI1",
    } as Candidate6InterviewTrackingRow], [assignment])).toThrow("replacement lineage");
  });

  it("rejects an incomplete ledger even when every supplied row is individually valid", () => {
    const assignment = readyAssignment();

    expect(() => summarizeCandidate6InterviewTracking(
      [assignment.trackingTemplate[0]],
      [assignment],
    )).toThrow(`Candidate 6 assignment ${assignment.assignmentId} has an incomplete tracking ledger`);
  });

  it("rejects tracking rows that claim administration without assignment", () => {
    const assignment = readyAssignment();
    expect(() =>
      summarizeCandidate6InterviewTracking([
        {
          ...assignment.trackingTemplate[0],
          assigned: false,
          administered: true,
          eligibilityAtAssignment: "eligible",
          responseDisposition: "answered",
        },
      ], [assignment])
    ).toThrow("cannot be administered before assignment");
  });

  it("keeps administration and response disposition synchronized", () => {
    const assignment = readyAssignment();
    expect(() =>
      summarizeCandidate6InterviewTracking([
        {
          ...assignment.trackingTemplate[0],
          assigned: true,
          administered: true,
          eligibilityAtAssignment: "eligible",
          responseDisposition: "not_administered",
        },
      ], [assignment])
    ).toThrow("needs a response disposition after administration");

    expect(() =>
      summarizeCandidate6InterviewTracking([
        {
          ...assignment.trackingTemplate[0],
          assigned: true,
          administered: false,
          eligibilityAtAssignment: "eligible",
          responseDisposition: "answered",
        },
      ], [assignment])
    ).toThrow("cannot have a response before administration");
  });

  it("emits an assigned tracking template only for a ready interview plan", () => {
    const assignment = planCandidate6InterviewAssignment({
      ...TEST_ASSIGNMENT_IDENTITY,
      panel: "P3",
      eligibility: {
        recording: "eligible",
        "vendor-assisted": "not_applicable",
        "partner-collaboration": "eligible",
      },
      stakeholderApplicability: "applicable",
      supportPairOrder: "AS_FIRST",
    });

    expect(assignment.status).toBe("ready");
    expect(assignment.trackingTemplate.map((row) => row.itemId)).toEqual(
      assignment.items.map((item) => item.id)
    );
    for (const row of assignment.trackingTemplate) {
      expect(row).toMatchObject({
        assignmentId: TEST_ASSIGNMENT_IDENTITY.assignmentId,
        exactVersion: CANDIDATE6_RESEARCH_EXACT_VERSION,
        form: TEST_ASSIGNMENT_IDENTITY.form,
        supportPairOrder: "AS_FIRST",
        rotationIndex: TEST_ASSIGNMENT_IDENTITY.rotationIndex,
        assigned: true,
        administered: false,
        eligibilityAtAssignment: "eligible",
        responseDisposition: "not_administered",
      });
    }
  });

  it("uses balanced named categories and keeps four non-ordinal escape meanings distinct", () => {
    expect(CANDIDATE6_BIPOLAR_DIRECTIONS).toEqual([-2, -1, 0, 1, 2]);
    expect(CANDIDATE6_IMPACT_LEVELS).toEqual([
      "strongly_hinders",
      "slightly_hinders",
      "neutral_impact",
      "slightly_helps",
      "strongly_helps",
    ]);
    expect(CANDIDATE6_ESCAPE_RESPONSES.map((response) => response.value)).toEqual([
      "depends",
      "not_applicable",
      "no_experience",
      "skip",
    ]);
  });

  it("keeps theme and response-mode contracts explicit", () => {
    for (const item of CANDIDATE6_RESEARCH_ITEMS) {
      if (item.theme === "DS" || item.theme === "SI") {
        expect(item.responseMode).toBe("bipolar-order");
      } else {
        expect(item.responseMode).toBe("balanced-impact");
      }
    }
  });

  it("keeps all DS endpoints grammatically symmetric while flagging unresolved facet alignment", () => {
    const decisionItems = CANDIDATE6_RESEARCH_ITEMS.filter((item) => item.theme === "DS");
    for (const item of decisionItems) {
      expect(item.responseMode).toBe("bipolar-order");
      if (item.responseMode !== "bipolar-order") continue;
      expect(item.prompt).toBe("처음 꺼낼 이야기는 어느 쪽에 더 가까울까요?");
      expect(item.leftAnchor).toMatch(/어떻게 다른지 먼저 이야기하기$/);
      expect(item.rightAnchor).toMatch(/어떻게 다른지 먼저 이야기하기$/);
      expect(`${item.leftAnchor} ${item.rightAnchor}`).not.toContain("다시");
    }
    expect(CANDIDATE6_ITEM_REVIEW_FLAGS["C6-DS3"]).toBe("DS_FACET_ALIGNMENT_REVIEW");
    expect(CANDIDATE6_ITEM_REVIEW_FLAGS["C6-CP3"]).toContain("BEFORE_QUANTITATIVE_PILOT");
    expect(CANDIDATE6_ITEM_REVIEW_FLAGS["C6-ES1"]).toContain("ALTERNATIVE_INTERPRETATION");
  });

  it("pairs ES and AS on byte-identical premises and scenarios", () => {
    for (const pairId of ["support-a", "support-b", "support-c"] as const) {
      const pair = CANDIDATE6_RESEARCH_ITEMS.filter(
        (item) => "scenarioPairId" in item && item.scenarioPairId === pairId
      );
      expect(pair.map((item) => item.theme).sort()).toEqual(["AS", "ES"]);
      expect(new Set(pair.map((item) => item.premise)).size).toBe(1);
      expect(new Set(pair.map((item) => item.scenario)).size).toBe(1);
    }
  });

  it("blocks fixed-format and urgency wording that previously contaminated responses", () => {
    const source = readFileSync(path.join(here, "../candidate6.ts"), "utf8");
    expect(source).not.toMatch(/15분|20분|세 줄|두 개까지만|지금 꼭 필요/);
    expect(source).not.toMatch(/scenarioGrade:\s*"S2"/);
  });

  it("makes Form B only the visual endpoint complement of Form A", () => {
    const bipolarItems = CANDIDATE6_RESEARCH_ITEMS.filter(
      (item) => item.responseMode === "bipolar-order"
    );
    expect(bipolarItems).toHaveLength(6);

    for (const item of bipolarItems) {
      expect(isCandidate6BipolarVisuallyReversed("B", item.id)).toBe(
        !isCandidate6BipolarVisuallyReversed("A", item.id)
      );
      for (const direction of CANDIDATE6_BIPOLAR_DIRECTIONS) {
        const formA = normalizeCandidate6BipolarVisualChoice("A", item.id, direction);
        const formB = normalizeCandidate6BipolarVisualChoice("B", item.id, direction);
        expect(formA.kind).toBe("bipolar");
        expect(formB.kind).toBe("bipolar");
        if (formA.kind === "bipolar" && formB.kind === "bipolar") {
          expect(formA.direction).toBe(formB.direction * -1);
        }
      }
    }
  });

  it("keeps the final reward user-selected, neutral, and free of sensitive defaults", () => {
    expect(CANDIDATE6_NEUTRAL_CONVERSATION_CARDS).toHaveLength(3);
    const copy = CANDIDATE6_NEUTRAL_CONVERSATION_CARDS.map(
      (card) => `${card.title} ${card.prompt} ${card.action}`
    ).join(" ");
    expect(copy).not.toMatch(/궁합|점수|퍼센트|정확도|희귀|가족|하객|업체|견적|계약/);
  });

  it("has no exported scoring, typing, overlap, confidence, or imputation implementation", () => {
    const source = readFileSync(path.join(here, "../candidate6.ts"), "utf8");
    expect(source).not.toMatch(/export\s+function\s+(?:score|calculate|classify|infer|impute)/i);
    expect(source).not.toMatch(/export\s+(?:const|type|interface)\s+.*(?:Score|Type|Overlap|Confidence)/);
  });
});

describe("Candidate 6.3 documentation authority and source traceability", () => {
  it("describes the KCA June 2025 source as a provider survey, not a consumer sample", () => {
    const source = CANDIDATE6_EVIDENCE_SOURCE_REGISTRY["SRC-KCA-WEDDING-PRICE-2025-06"];

    expect(source.population).toContain("515");
    expect(source.population).toContain("14 regions");
    expect(source.population).toContain("wedding-service providers");
    expect(source.population).toContain("not a consumer-respondent sample");
  });

  it("keeps the exact version, every item, and every citation ID in authoritative docs", () => {
    const contract = readFileSync(
      path.join(repoRoot, "docs/wedding-code/58_candidate6_product_research_contract_2026-07-17.md"),
      "utf8"
    );
    const matrix = readFileSync(
      path.join(repoRoot, "docs/wedding-code/59_candidate6_item_evidence_matrix_2026-07-17.md"),
      "utf8"
    );
    const execution = readFileSync(
      path.join(repoRoot, "docs/wedding-code/60_candidate6_validation_execution_kit_2026-07-17.md"),
      "utf8"
    );
    const roadmap = readFileSync(
      path.join(repoRoot, "docs/wedding-code/61_candidate6_productization_roadmap_2026-07-18.md"),
      "utf8"
    );
    const researchReadme = readFileSync(path.join(here, "../README.md"), "utf8");

    expect(contract).toContain(CANDIDATE6_RESEARCH_EXACT_VERSION);
    expect(matrix).toContain(CANDIDATE6_RESEARCH_EXACT_VERSION);
    expect(execution).toContain(CANDIDATE6_RESEARCH_EXACT_VERSION);
    expect(contract).toContain("public 안내-only");
    expect(contract).toContain("API `410 Gone`");
    expect(execution).toContain("현재 로컬 프로토타입에서는 아무것도 수집하지 않는다");

    for (const item of CANDIDATE6_RESEARCH_ITEMS) {
      const row = matrix.split("\n").find((line) => line.startsWith(`| \`${item.id}\``));
      expect(row, `${item.id} evidence row`).toBeDefined();
      expect(row, `${item.id} remains M0`).toContain("`M0`");
      expect(row, `${item.id} theme`).toContain(`\`${item.theme}\``);
      for (const source of item.evidence.sources) expect(row).toContain(source);
    }

    for (const [sourceId, source] of Object.entries(CANDIDATE6_EVIDENCE_SOURCE_REGISTRY)) {
      expect(matrix).toContain(sourceId);
      expect(matrix).toContain(source.uri);
      expect(source.supportedClaim.length).toBeGreaterThan(20);
      expect(source.notSupportedClaim.length).toBeGreaterThan(20);
      expect(source.population.length).toBeGreaterThan(20);
      expect(source.context.length).toBeGreaterThan(20);
    }

    expect(matrix.match(/^\| `C6-[A-Z]{2}\d` /gm)).toHaveLength(21);
    expect(matrix).toContain("적용 population/context");
    expect(matrix).toContain("14개 지역 결혼서비스업체 515개");
    expect(matrix).toContain("소비자 응답자 표본이 아님");
    expect(matrix).toContain("`experienceMeaning` 6,11 / `aestheticMood` 2,10");
    expect(execution).toContain("P1/P2/P3");
    expect(execution).toContain("ES_FIRST");
    expect(execution).toContain("AS_FIRST");
    expect(execution).toContain("SAME_THEME_ELIGIBLE_NOT_ALREADY_ASSIGNED");
    expect(execution).toContain("eligibilityAtAssignment");
    expect(execution).toContain("responseDisposition");
    expect(execution).toContain("substantive-response 분석 분모에서는");
    expect(execution).toContain("eligible count에는 유지");
    expect(execution).not.toContain("structural missing, eligible N에서 제외");
    expect(contract).toContain("eligibilityAtAssignment");
    for (const field of ["assigned", "administered", "eligible", "not_applicable"]) {
      expect(execution).toContain(field);
    }
    expect(roadmap).toContain("적격성 screener");
    expect(researchReadme).toMatch(/eligibility\s+screener/);
  });
});
