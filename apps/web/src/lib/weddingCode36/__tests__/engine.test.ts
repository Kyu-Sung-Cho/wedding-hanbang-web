// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CRITERIA, DEFAULT_SHARE_IDS, FINGERPRINT, ITEM_BY_ID, ITEMS, NOTES, QUESTIONNAIRE_VERSION, SCALE,
} from "@/constants/weddingCode36";
import {
  createSubmission, criterionStats, evaluate, presentComparison, presentIndividual, validateSubmission,
  type Rating, type Submission,
} from "..";

const root = path.resolve(process.cwd(), "../..");
const source = path.join(root, "docs/wedding-code/results36-2026-10-15");
const localData = path.join(process.cwd(), "src/lib/weddingCode36/data");
const digest = (value: unknown): string => {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted) : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sorted(child)])) : item;
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
};
function random(seed: number) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x100000000; };
}
function aliases(): Submission[] {
  const output: Submission[] = [];
  for (const adjective of ["B", "M", "V", "G", "F"]) for (const animal of ["P", "J", "D", "S"]) {
    const submission = createSubmission(3, { comparison: true, shareAlias: true });
    for (const criterion of CRITERIA) if ([adjective, animal].includes(criterion.id)) for (const id of criterion.item_ids) submission.answers[id] = 5;
    output.push(submission);
  }
  return output;
}

describe("36문항 실제 앱 계산과 기준 원문 일치", () => {
  it("copies the four reviewed data files without changing any source content", () => {
    for (const filename of ["bank.json", "design-contract.json", "type-cards.json", "couple-catalog.json"]) expect(readFileSync(path.join(localData, filename))).toEqual(readFileSync(path.join(source, filename)));
    expect(ITEMS).toHaveLength(36);
    expect(new Set(ITEMS.map(item => item.id)).size).toBe(36);
    expect(ITEMS.map(item => item.display_number)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    expect(SCALE.map(entry => entry.value)).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_SHARE_IDS).toHaveLength(27);
    expect(NOTES).toHaveLength(9);
    expect(DEFAULT_SHARE_IDS.some(id => id.startsWith("N"))).toBe(false);
    const bank = JSON.parse(readFileSync(path.join(source, "bank.json"), "utf8"));
    const form = { version: bank.version, instructions: bank.instructions, response_scale: bank.response_scale, missing_responses: bank.missing_responses, items: bank.items.map((item: { id: string; display_number: number; context: string; statement: string }) => ({ id: item.id, display_number: item.display_number, context: item.context, statement: item.statement })) };
    expect(digest(form)).toBe(FINGERPRINT);
    expect(QUESTIONNAIRE_VERSION).toBe("wcr36-r6-2026-10-15");
  });

  it.each([1, 2, 3, 4, 5])("keeps every actual answer and sensible fallback for all %i", value => {
    const result = presentIndividual(createSubmission(value));
    expect(Object.keys(result)[0]).toBe("name");
    expect(result.name).toBe("아직 미정인 수달");
    expect(result.name_kind).toBe("response_state_character");
    expect(result.answered_count).toBe(36);
    expect(result.profile).toHaveLength(9);
    expect(result.good_points.length).toBeGreaterThan(0);
    expect(result.cautions.length).toBeGreaterThan(0);
    for (const card of result.profile) {
      expect(card.mean).toBe(value);
      expect(card.state).toBe(value < 3 ? "L" : value === 3 ? "U" : "H");
      expect(card.evidence.map(evidence => evidence.value)).toEqual([value, value, value]);
    }
    expect(result.technical_code_in_primary_display).toBe(false);
    expect(result.human_validation_completed).toBe(false);
  });

  it("keeps the 25 uniform couple combinations truthful in both directions", () => {
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) {
      const pa = createSubmission(a, { comparison: true, shareAlias: true });
      const pb = createSubmission(b, { comparison: true, shareAlias: true });
      const result = presentComparison(pa, pb);
      const reversed = presentComparison(pb, pa);
      expect(result.names?.a.name).toBe("아직 미정인 수달");
      expect(result.body.core_cards).toHaveLength(9);
      expect(result.body.single_note_cards).toHaveLength(0);
      expect(result.body.compatibility_score).toBeNull();
      expect(result.body.joint_decision_confirmed).toBe(false);
      for (const card of result.body.core_cards) {
        expect(card.a_mean).toBe(a); expect(card.b_mean).toBe(b);
        expect(card.discussion_item_ids.length).toBe(Math.abs(a - b) >= 2 ? 3 : 0);
        expect(card.equal_answer_item_ids.length).toBe(a === b ? 3 : 0);
        for (const evidence of card.evidence) {
          expect(evidence.a).toBe(a); expect(evidence.b).toBe(b);
          expect(evidence.gap).toBe(Math.abs(a - b));
          expect(evidence.context).toBe(ITEM_BY_ID[evidence.item_id].context);
        }
        const reverse = reversed.body.core_cards.find(entry => entry.criterion === card.criterion)!;
        expect(reverse.a_mean).toBe(b); expect(reverse.b_mean).toBe(a);
      }
      if (a === b) expect(result.summary).toMatch(/理由|이유/);
    }
  });

  it("assigns all 20 supported names and keeps all 400 named couple combinations", () => {
    const submissions = aliases();
    const names = new Set(submissions.map(submission => presentIndividual(submission).name));
    expect(names.size).toBe(20);
    expect(names.has("아직 미정인 수달")).toBe(false);
    for (const a of submissions) for (const b of submissions) {
      const result = presentComparison(a, b);
      expect(result.names?.a.name).toBe(presentIndividual(a).name);
      expect(result.names?.b.name).toBe(presentIndividual(b).name);
      expect(result.body.core_cards).toHaveLength(9);
    }
  });

  it("exhausts all 216 three-scene response vectors including missing values", () => {
    const values: Rating[] = [null, 1, 2, 3, 4, 5];
    for (const a of values) for (const b of values) for (const c of values) {
      const vector = [a, b, c];
      const stats = criterionStats(vector);
      if (vector.some(value => value === null)) {
        expect(stats.state).toBe("M"); expect(stats.mean).toBeNull(); expect(stats.sum).toBeNull();
      } else {
        const numeric = vector as number[];
        expect(stats.state).toBe(numeric.every(value => value >= 4) ? "H" : numeric.every(value => value <= 2) ? "L" : numeric.some(value => value <= 2) && numeric.some(value => value >= 4) ? "X" : "U");
        expect(stats.mean).toBe(numeric.reduce((sum, value) => sum + value, 0) / 3);
      }
    }
  });

  it("does not turn missing answers into neutral values or inferred preferences", () => {
    const empty = presentIndividual(createSubmission());
    expect(empty.answered_count).toBe(0); expect(empty.profile).toEqual([]); expect(empty.notes).toEqual([]); expect(empty.good_points).toEqual([]);
    for (const item of ITEMS) {
      const a = createSubmission(3, { comparison: true }); const b = createSubmission(3, { comparison: true });
      a.answers[item.id] = null; a.missing_reasons[item.id] = "prefer_not_to_answer";
      const result = presentComparison(a, b);
      expect(JSON.stringify(result)).not.toContain("prefer_not_to_answer");
      if (!item.id.startsWith("N")) {
        expect(result.summary).toContain("답이 비어 있는 문항은 비교하지 않았어요");
        const card = result.body.core_cards.find(entry => entry.evidence.some(evidence => evidence.item_id === item.id))!;
        expect(card.status).toBe("missing"); expect(card.a_mean).toBeNull(); expect(card.b_mean).toBeNull();
      }
    }
  });

  it("requires mutual comparison, item and name permission independently", () => {
    const a = createSubmission(1, { comparison: true, shareAlias: true });
    const b = createSubmission(5, { comparison: true, shareAlias: true });
    for (const ac of [false, true]) for (const bc of [false, true]) for (const an of [false, true]) for (const bn of [false, true]) {
      a.allow_couple_comparison = ac; b.allow_couple_comparison = bc; a.share_alias = an; b.share_alias = bn;
      const result = presentComparison(a, b);
      expect(result.names !== null).toBe(ac && bc && an && bn);
      expect(result.body.core_cards.length).toBe(ac && bc ? 9 : 0);
      expect(result.body.shared_item_ids.length).toBe(ac && bc ? 27 : 0);
    }
    a.allow_couple_comparison = true; b.allow_couple_comparison = true;
    a.share_item_ids = ["B1", "B2", "N8"]; b.share_item_ids = ["B1", "N8", "N9"];
    a.share_alias = false; b.share_alias = false;
    const before = presentComparison(a, b);
    expect(before.body.shared_item_ids).toEqual(["B1", "N8"]);
    expect(before.body.core_cards[0].status).toBe("partial_shared_scope");
    expect(before.body.core_cards[0].a_mean).toBeNull();
    for (const item of ITEMS) if (!["B1", "N8"].includes(item.id)) { a.answers[item.id] = 5; b.answers[item.id] = 1; }
    expect(presentComparison(a, b)).toEqual(before);
    a.share_item_ids = []; b.share_item_ids = [];
    const noScope = presentComparison(a, b);
    expect(noScope.body.core_cards).toEqual([]); expect(noScope.body.single_note_cards).toEqual([]);
    expect(noScope.summary).toContain("함께 공유한 문항이 없어요");
  });

  it("never uses the nine single-scene notes to assign a type", () => {
    for (const initial of aliases()) {
      const before = evaluate(initial).alias;
      for (const note of NOTES) for (const value of [null, 1, 2, 3, 4, 5]) {
        const changed = structuredClone(initial); changed.answers[note.id] = value;
        expect(evaluate(changed).alias).toEqual(before);
      }
    }
  });

  it("withholds unsupported, tied, mixed and narrowly separated alias components", () => {
    const withRatings = (vectors: Record<string, Rating[]>) => {
      const submission = createSubmission(3);
      for (const [id, ratings] of Object.entries(vectors)) {
        const criterion = CRITERIA.find(entry => entry.id === id)!;
        criterion.item_ids.forEach((itemId, index) => { submission.answers[itemId] = ratings[index]; });
      }
      return evaluate(submission);
    };
    expect(withRatings({ B: [5, 5, 5], M: [5, 5, 5] }).alias.adjective.reason).toBe("top_tie");
    expect(withRatings({ B: [4, 4, 4], M: [4, 4, 3] }).alias.adjective.reason).toBe("small_gap");
    expect(withRatings({ B: [4, 4, 4], M: [4, 3, 3] }).alias.adjective.criterion).toBe("B");
    expect(withRatings({ B: [4, 4, 4], M: [5, 5, 3] }).alias.adjective.reason).toBe("top_not_repeated_support");
    expect(withRatings({ B: [5, 5, 5], M: [1, 3, 5] }).alias.adjective.reason).toBe("scene_variation_in_block");
    expect(withRatings({ B: [5, 5, 5], M: [null, 3, 3] }).alias.adjective.reason).toBe("missing_in_block");
    const allSupported = createSubmission(4);
    for (const id of CRITERIA[0].item_ids) allSupported.answers[id] = 5;
    expect(evaluate(allSupported).alias.adjective.reason).toBe("all_supported");
    expect(withRatings({}).alias.adjective.reason).toBe("no_repeated_support");
    // 함께 검토하기와 위임은 반대 축이 아니며 두 기준 모두 높은 동의일 수 있다.
    const both = withRatings({ J: [5, 5, 5], D: [5, 5, 5] });
    expect(both.profile.J.state).toBe("H"); expect(both.profile.D.state).toBe("H");
    expect(both.alias.animal.reason).toBe("top_tie");
  });

  it("validates the complete current input schema and safely returns canonical fields", () => {
    const valid = createSubmission(3);
    expect(validateSubmission({ ...valid, access_token: "private", consent: true })).toEqual(valid);
    for (const value of [null, [], true, "3", 3]) expect(() => validateSubmission(value)).toThrow("invalid_submission");
    for (const value of [false, true, "3", 0, 6, 3.1, NaN, Infinity, {}, []]) expect(() => validateSubmission({ ...valid, answers: { ...valid.answers, B1: value } })).toThrow("invalid_response");
    for (const form of ["wcr36-r5", "v0.5-candidate.9", null]) expect(() => validateSubmission({ ...valid, questionnaire_version: form })).toThrow("questionnaire_version_mismatch");
    expect(() => validateSubmission({ ...valid, questionnaire_fingerprint: "wrong" })).toThrow("questionnaire_fingerprint_mismatch");
    expect(() => validateSubmission({ ...valid, answers: { ...valid.answers, extra: 3 } })).toThrow("answer_item_ids_mismatch");
    const fewer = { ...valid.answers }; delete fewer.B1;
    expect(() => validateSubmission({ ...valid, answers: fewer })).toThrow("answer_item_ids_mismatch");
    for (const value of [null, true, {}, "B1", ["B1", "B1"], ["toString"], ["__proto__"], [1]]) expect(() => validateSubmission({ ...valid, share_item_ids: value })).toThrow("invalid_share_scope");
    for (const value of [null, 0, 1, "true", [], {}]) {
      expect(() => validateSubmission({ ...valid, share_alias: value })).toThrow("invalid_alias_consent");
      expect(() => validateSubmission({ ...valid, allow_couple_comparison: value })).toThrow("invalid_comparison_consent");
    }
    for (const value of [null, [], "unknown", true, {}, 1]) expect(() => validateSubmission({ ...valid, missing_reasons: { B1: value } })).toThrow("invalid_missing_reason");
    expect(() => validateSubmission({ ...valid, missing_reasons: [] })).toThrow("invalid_missing_reasons");
    const missing = createSubmission(); missing.missing_reasons.B1 = "prefer_not_to_answer";
    expect(validateSubmission(missing)).toEqual(missing);
  });

  it("matches the Python reference for 1,000 personal and 1,000 couple cases exactly", () => {
    const rng = random(20261015);
    const individual: Submission[] = [...aliases(), ...[1, 2, 3, 4, 5, null].map(value => createSubmission(value))];
    while (individual.length < 1000) {
      const index = individual.length;
      const submission = createSubmission(3, { comparison: index % 7 !== 0, shareAlias: index % 3 === 0, shareIds: ITEMS.filter(() => rng() > 0.2).map(item => item.id) });
      for (const item of ITEMS) {
        const value = Math.floor(rng() * 6);
        submission.answers[item.id] = value || null;
        if (!value && rng() > 0.5) submission.missing_reasons[item.id] = "prefer_not_to_answer";
      }
      if (index % 10 === 0) for (const id of DEFAULT_SHARE_IDS) { submission.answers[id] = 3; delete submission.missing_reasons[id]; }
      individual.push(submission);
    }
    const couples: { a: Submission; b: Submission }[] = [];
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) couples.push({ a: createSubmission(a, { comparison: true, shareAlias: true, shareIds: ITEMS.map(item => item.id) }), b: createSubmission(b, { comparison: true, shareAlias: true, shareIds: ITEMS.map(item => item.id) }) });
    const supported = aliases();
    for (const a of supported) for (const b of supported) couples.push({ a, b });
    while (couples.length < 1000) couples.push({ a: individual[Math.floor(rng() * individual.length)], b: individual[Math.floor(rng() * individual.length)] });
    const bundledPython = path.join(process.env.USERPROFILE ?? "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
    const python = process.env.WEDDING_CODE_PYTHON ?? (existsSync(bundledPython) ? bundledPython : process.platform === "win32" ? "python" : "python3");
    const oracle = spawnSync(python, ["-X", "utf8", path.join(process.cwd(), "src/lib/weddingCode36/__tests__/python_oracle.py")], { input: JSON.stringify({ individual, couples }), encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 90_000 });
    expect(oracle.error).toBeUndefined();
    expect(oracle.status, oracle.stderr).toBe(0);
    const expected = JSON.parse(oracle.stdout) as { individual: string[]; couples: string[] };
    expect(expected.individual).toHaveLength(1000); expect(expected.couples).toHaveLength(1000);
    for (let i = 0; i < individual.length; i++) expect(digest(presentIndividual(individual[i])), `personal ${i}`).toBe(expected.individual[i]);
    for (let i = 0; i < couples.length; i++) expect(digest(presentComparison(couples[i].a, couples[i].b)), `couple ${i}`).toBe(expected.couples[i]);
  }, 120_000);
});
