import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assignCandidate5Form,
  CANDIDATE5_AXES,
  CANDIDATE5_DELETION_CONTRACT,
  CANDIDATE5_DIRECTIONS,
  CANDIDATE5_NEUTRAL_TOPICS,
  CANDIDATE5_RESEARCH_EXACT_VERSION,
  CANDIDATE5_RESEARCH_ITEMS,
  getCandidate5DirectionOrder,
  isCandidate5AxisAnalyzable,
  normalizeCandidate5Response,
  resolveCandidate5CoupleShareState,
  type Candidate5Form,
  type Candidate5ItemId,
  type Candidate5ResearchSubmission,
} from "../candidate5";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../../..");

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function directionResponses(
  itemIds: readonly Candidate5ItemId[]
): Candidate5ResearchSubmission["responses"] {
  return Object.fromEntries(itemIds.map((id) => [id, { kind: "direction", direction: -1 }])) as
    Candidate5ResearchSubmission["responses"];
}

describe("Candidate 5 research schema", () => {
  it("keeps the exact version, 4x4 single-axis structure, equal direction set, and M0 evidence", () => {
    expect(CANDIDATE5_RESEARCH_EXACT_VERSION).toBe("wedding-code-candidate5-research.2");
    expect(CANDIDATE5_RESEARCH_ITEMS).toHaveLength(16);
    expect(new Set(CANDIDATE5_RESEARCH_ITEMS.map((item) => item.id)).size).toBe(16);

    for (const axis of CANDIDATE5_AXES) {
      expect(CANDIDATE5_RESEARCH_ITEMS.filter((item) => item.axis === axis)).toHaveLength(4);
    }

    for (const item of CANDIDATE5_RESEARCH_ITEMS) {
      expect(item.options.map((option) => option.direction)).toEqual(CANDIDATE5_DIRECTIONS);
      expect(new Set(item.options.map((option) => option.direction)).size).toBe(4);
      expect(item.evidence.measurementGrade).toBe("M0");
      expect(item.evidence.sources.length).toBeGreaterThan(0);
      expect(["S0", "S1", "S2"]).toContain(item.evidence.scenarioGrade);
    }
  });

  it("keeps CI conditional and removes the known intensity/moral-answer wording", () => {
    for (const item of CANDIDATE5_RESEARCH_ITEMS) {
      expect(item.applicability).toBe(item.axis === "CI" ? "conditional-stakeholder" : "universal");
    }

    const allCopy = CANDIDATE5_RESEARCH_ITEMS.flatMap((item) => [
      item.prompt,
      ...item.options.map((option) => option.text),
    ]).join(" ");
    expect(allCopy).not.toContain("충분히");
    expect(allCopy).not.toContain("꼭 필요한");
    expect(allCopy).not.toContain("꼭 피해야");
    expect(allCopy).not.toContain("효도");
  });

  it("does not turn unknown, skipped, or CI module applicability into direction zero", () => {
    expect(normalizeCandidate5Response("A", "C5-DI1", { kind: "unknown" })).toEqual({ kind: "unknown" });
    expect(normalizeCandidate5Response("A", "C5-DI1", { kind: "skipped" })).toEqual({ kind: "skipped" });
    const ciIds = CANDIDATE5_RESEARCH_ITEMS.filter((item) => item.axis === "CI").map(
      (item) => item.id
    ) as Candidate5ItemId[];
    expect(isCandidate5AxisAnalyzable(directionResponses(ciIds), "CI", "not_applicable")).toBe(false);
    expect(isCandidate5AxisAnalyzable(directionResponses(ciIds), "CI", "unanswered")).toBe(false);
  });

  it("requires three actual direction responses and never counts escape states", () => {
    const diIds = CANDIDATE5_RESEARCH_ITEMS.filter((item) => item.axis === "DI").map(
      (item) => item.id
    ) as Candidate5ItemId[];

    expect(isCandidate5AxisAnalyzable(directionResponses(diIds.slice(0, 2)), "DI", "unanswered")).toBe(
      false
    );
    expect(isCandidate5AxisAnalyzable(directionResponses(diIds.slice(0, 3)), "DI", "unanswered")).toBe(
      true
    );
    expect(
      isCandidate5AxisAnalyzable(
        {
          [diIds[0]]: { kind: "direction", direction: -2 },
          [diIds[1]]: { kind: "unknown" },
          [diIds[2]]: { kind: "skipped" },
        },
        "DI",
        "unanswered"
      )
    ).toBe(false);
  });
});

describe("Candidate 5 deterministic counterbalanced forms", () => {
  const forms: readonly Candidate5Form[] = ["A", "B"];

  it("places every direction once in every visual position within each axis and form", () => {
    for (const form of forms) {
      for (const axis of CANDIDATE5_AXES) {
        const axisItems = CANDIDATE5_RESEARCH_ITEMS.filter((item) => item.axis === axis);
        for (let position = 0; position < 4; position += 1) {
          const directionsAtPosition = axisItems
            .map((item) => getCandidate5DirectionOrder(form, item.id)[position])
            .sort((left, right) => left - right);
          expect(directionsAtPosition, `${form}/${axis}/position-${position}`).toEqual([-2, -1, 1, 2]);
        }
      }
    }
  });

  it("makes Form B the reverse complement of Form A for every item", () => {
    for (const item of CANDIDATE5_RESEARCH_ITEMS) {
      expect(getCandidate5DirectionOrder("B", item.id)).toEqual(
        [...getCandidate5DirectionOrder("A", item.id)].reverse()
      );
    }
  });

  it("normalizes display positions back to canonical directions", () => {
    for (const form of forms) {
      for (const item of CANDIDATE5_RESEARCH_ITEMS) {
        getCandidate5DirectionOrder(form, item.id).forEach((direction, displayIndex) => {
          expect(
            normalizeCandidate5Response(form, item.id, {
              kind: "direction",
              displayIndex: displayIndex as 0 | 1 | 2 | 3,
            })
          ).toEqual({ kind: "direction", direction });
        });
      }
    }
  });

  it("assigns only from an opaque research ID and is stable", () => {
    const id = "research_01K0WEDDINGCODE";
    expect(assignCandidate5Form(id)).toBe(assignCandidate5Form(id));
    expect(["A", "B"]).toContain(assignCandidate5Form(id));
    expect(() => assignCandidate5Form("short")).toThrow("opaque random research ID");
    expect(() => assignCandidate5Form("user@example.com")).toThrow("opaque random research ID");
  });
});

describe("Candidate 5 privacy and couple-share policy", () => {
  const readyInput = {
    selectedTopicId: "compare-first" as const,
    senderConsent: true,
    recipientConsent: true,
    senderVersion: CANDIDATE5_RESEARCH_EXACT_VERSION,
    recipientVersion: CANDIDATE5_RESEARCH_EXACT_VERSION,
    revoked: false,
    deleted: false,
    expired: false,
  };

  it("has only user-selectable neutral topics and no money/family/vendor default", () => {
    expect(CANDIDATE5_NEUTRAL_TOPICS).toHaveLength(3);
    const topicCopy = CANDIDATE5_NEUTRAL_TOPICS.map((topic) => `${topic.id} ${topic.prompt}`).join(" ");
    expect(topicCopy).not.toMatch(/돈|예산|가족|하객|업체|견적|계약/);
  });

  it("requires topic selection and independent consent", () => {
    expect(resolveCandidate5CoupleShareState({ ...readyInput, selectedTopicId: null })).toBe(
      "topic-required"
    );
    expect(resolveCandidate5CoupleShareState({ ...readyInput, senderConsent: false })).toBe(
      "sender-consent-required"
    );
    expect(resolveCandidate5CoupleShareState({ ...readyInput, recipientConsent: false })).toBe(
      "recipient-consent-pending"
    );
    expect(resolveCandidate5CoupleShareState(readyInput)).toBe("ready-neutral-topic-only");
  });

  it("closes on mismatch, revoke, deletion, or expiry without answer-based fallback", () => {
    expect(
      resolveCandidate5CoupleShareState({ ...readyInput, recipientVersion: "different-version" })
    ).toBe("closed-version-mismatch");
    expect(resolveCandidate5CoupleShareState({ ...readyInput, revoked: true })).toBe("closed-revoked");
    expect(resolveCandidate5CoupleShareState({ ...readyInput, deleted: true })).toBe("closed-deleted");
    expect(resolveCandidate5CoupleShareState({ ...readyInput, expired: true })).toBe("closed-expired");
  });

  it("keeps the deletion contract high-entropy, hash-only, and restore fenced", () => {
    expect(CANDIDATE5_DELETION_CONTRACT.tokenEntropyBits).toBeGreaterThanOrEqual(256);
    expect(CANDIDATE5_DELETION_CONTRACT.rawTokenServerStorageAllowed).toBe(false);
    expect(CANDIDATE5_DELETION_CONTRACT.rawTokenBrowserStorageAllowed).toBe(false);
    expect(CANDIDATE5_DELETION_CONTRACT.storedVerifier).toBe("server-secret-keyed-hmac");
    expect(CANDIDATE5_DELETION_CONTRACT.tombstoneContainsAnswers).toBe(false);
    expect(CANDIDATE5_DELETION_CONTRACT.restoreRequiresTombstoneReplayBeforeNetwork).toBe(true);
  });
});

describe("Candidate 5 documentation and isolation fences", () => {
  it("keeps the typed item copy synchronized with the authoritative spec and M0 matrix", () => {
    const spec = readFileSync(
      path.join(repoRoot, "docs/wedding-code/56_candidate5_research_spec_2026-07-17.md"),
      "utf8"
    );
    const matrix = readFileSync(
      path.join(repoRoot, "docs/wedding-code/57_candidate5_item_evidence_matrix_2026-07-17.md"),
      "utf8"
    );

    expect(spec).toContain(CANDIDATE5_RESEARCH_EXACT_VERSION);
    for (const item of CANDIDATE5_RESEARCH_ITEMS) {
      expect(spec, `${item.id} prompt`).toContain(item.prompt);
      for (const option of item.options) {
        expect(spec, `${item.id}/${option.direction}`).toContain(option.text);
      }
      const matrixLine = matrix.split("\n").find((line) => line.startsWith(`| \`${item.id}\``));
      expect(matrixLine, `${item.id} evidence row`).toBeDefined();
      expect(matrixLine, `${item.id} must remain M0`).toContain("`M0`");
    }
  });

  it("blocks Candidate 4 and I/O imports from research code", () => {
    const researchRoot = path.resolve(here, "..");
    const sourceFiles = collectSourceFiles(researchRoot).filter((file) => !file.includes(`${path.sep}__tests__`));
    const forbidden = [
      /from\s+["'][^"']*weddingCodeV05/,
      /from\s+["'][^"']*weddingCodeForm/,
      /from\s+["'][^"']*weddingCodeResult/,
      /from\s+["'][^"']*(?:\/|\.\.)(?:score|report|coupleReport|answers|shareCard|validate)["']/,
      /\bfetch\s*\(/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bindexedDB\b/,
      /\bsupabase\b/i,
      /\bposthog\b/i,
    ];

    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(source, `${path.relative(repoRoot, file)} violates ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("blocks every non-research source file from importing the dormant Candidate 5 module", () => {
    const srcRoot = path.join(repoRoot, "apps/web/src");
    const researchRoot = path.join(srcRoot, "lib/weddingCode/research");
    const outsideFiles = collectSourceFiles(srcRoot).filter(
      (file) => !path.resolve(file).startsWith(path.resolve(researchRoot))
    );

    for (const file of outsideFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(repoRoot, file)).not.toMatch(
        /(?:weddingCode\/research|research\/candidate5)/
      );
    }
  });

  it("keeps Candidate 4 implementation files visibly retired", () => {
    const legacyFiles = [
      "apps/web/src/constants/weddingCodeV05.ts",
      "apps/web/src/constants/weddingCodeForm.ts",
      "apps/web/src/constants/weddingCodeResult.ts",
      "apps/web/src/lib/weddingCode/score.ts",
      "apps/web/src/lib/weddingCode/report.ts",
      "apps/web/src/lib/weddingCode/coupleReport.ts",
      "apps/web/src/lib/weddingCode/answers.ts",
      "apps/web/src/lib/weddingCode/shareCard.ts",
      "apps/web/src/lib/weddingCode/validate.ts",
      "apps/web/src/app/wedding-code/WeddingCodeClient.tsx",
      "apps/web/src/app/wedding-code/result/ResultClient.tsx",
    ];

    for (const relativePath of legacyFiles) {
      expect(readFileSync(path.join(repoRoot, relativePath), "utf8"), relativePath).toContain(
        "CANDIDATE4_RETIRED"
      );
    }
  });
});
