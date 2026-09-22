import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V31_AVOIDANCES, WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_SPENDING, WEDDING_CODE_V31_TASTES, WEDDING_CODE_V31_VERSION,
  type V31Choice, type V31Draft, type V31Rating, type V31Response,
} from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_TASTES } from "@/constants/weddingCodeV30";
import { createV30Draft, decodeV30, encodeV30 } from "../v30";
import { buildV31Profile, buildV31ShareUrl, compareV31, createV31Draft, decodeV31, encodeV31, getV31PriorityOptions, hasV31Content, normalizeV31Draft, v31ChoiceLabels, v31ResponseLabel } from "../v31";

function all(value: V31Response): V31Draft {
  const draft = createV31Draft();
  for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = value;
  return draft;
}
function answered(values: string[]): V31Choice { return { status: "answered", values }; }
function changePart(code: string, index: number, part: string) {
  const parts = code.split("_");
  parts[index] = part;
  return parts.join("_");
}
function row(first: V31Draft, second: V31Draft, id: string) {
  const found = compareV31(first, second).find((item) => item.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe("웨딩코드 v3.1 문항 의미와 개인 결과", () => {
  it("겹치던 일곱 동의 문장을 없애고 복합 식순 보기를 분리한다", () => {
    expect(WEDDING_CODE_V31_VERSION).toBe("v3.1-preferences");
    expect(WEDDING_CODE_V31_QUESTIONS).toHaveLength(25);
    expect(WEDDING_CODE_V31_OPTIONS.map((option) => option.value)).toEqual([1, 2, 3, 4, 5]);
    expect(WEDDING_CODE_V31_QUESTIONS.map((question) => question.id)).toEqual(["V1", "G1", "G2", "G3", "R3", "R4", "B1", "B2", "B3", "B4", "D1", "D2", "D3", "T1", "T2", "T3", "T4", "F1", "F2", "F3", "F4", "H1", "H2", "H3", "H4"]);
    const ceremony = WEDDING_CODE_V31_TASTES.find((taste) => taste.key === "ceremony")!;
    expect(ceremony.options.map((option) => option.value)).toEqual(["short", "our_story", "thanks", "participatory", "performance", "traditional"]);
    expect(ceremony.max).toBe(6);
    expect(ceremony.options.find((option) => option.value === "our_story")?.label).not.toContain("감사");
    expect(ceremony.options.find((option) => option.value === "participatory")?.label).not.toContain("공연");
    expect(WEDDING_CODE_V31_TASTES.find((taste) => taste.key === "attire")?.max).toBe(4);
    expect(WEDDING_CODE_V31_TASTES.find((taste) => taste.key === "venue")?.question).not.toContain("식사");
    expect(WEDDING_CODE_V31_TASTES.find((taste) => taste.key === "guests")?.options.map((option) => option.label)).toEqual(["둘만, 하객 없이", "1~49명", "50~99명", "100~199명", "200~299명", "300명 이상"]);
    expect(WEDDING_CODE_V31_SPENDING.some((option) => option.value === "beauty")).toBe(true);
  });

  it.each([1, 2, 3] as const)("전부 %i 응답을 반대 취향이나 숨은 유형으로 만들지 않는다", (rating) => {
    const profile = buildV31Profile(all(rating));
    expect(profile.ratedCount).toBe(25);
    expect(profile.insights).toEqual([]);
    expect(profile.priorityGuides).toEqual([]);
    expect(profile.priorityLabels).toEqual([]);
    expect(profile.topics.flatMap((topic) => topic.responses).every((item) => item.answer === v31ResponseLabel(rating))).toBe(true);
  });

  it("감사에서 설명이 비었던 응답에도 세 가지 우선순위별 구체적 행동을 준다", () => {
    const draft = createV31Draft();
    draft.answers = { V1: 2, G1: 5, G2: 2, G3: 5, R3: 2, R4: 5, B1: 5, B2: 2, B3: 2, B4: 5, D1: 2, D2: 5, D3: 5, T1: 2, T2: 2, T3: 5, T4: 5, F1: 2, F2: 5, F3: 5, F4: 5, H1: 2, H2: 2, H3: 5, H4: 5 };
    draft.tastes = { venue: answered(["indoor"]), photo: answered(["candid"]), attire: answered(["simple"]), meal: answered(["course"]), guests: answered(["under50"]), ceremony: answered(["short"]) };
    draft.avoidances = { status: "no_preference" };
    draft.priorities = answered(["B1", "G1", "H4"]);
    draft.spending = { status: "no_preference" };
    const profile = buildV31Profile(draft);
    expect(profile.respondedCount).toBe(34);
    expect(profile.priorityGuides.map((guide) => guide.id)).toEqual(["priority-B1", "priority-G1", "priority-H4"]);
    expect(profile.priorityGuides[0].nextStep).toContain("견적");
    expect(profile.priorityGuides[1].nextStep).toContain("명단");
    expect(profile.priorityGuides[2].nextStep).toContain("다시 이야기할 시점");
    for (const [index, id] of ["B1", "G1", "H4"].entries()) expect(profile.priorityGuides[index].evidence.map((item) => item.id)).toEqual([id, "priorities"]);
    expect(profile.insights.some((item) => item.id === "single-G1")).toBe(true);
    expect(profile.insights.some((item) => item.id === "direct-photo")).toBe(true);
    expect(profile.unresolved).toEqual([]);
    expect(decodeV31(encodeV31(draft))).toEqual(draft);
  });

  it.each(WEDDING_CODE_V31_QUESTIONS)("높은 단일 답 $id에도 그 문장에 근거한 설명과 다음 행동이 있다", (question) => {
    const draft = createV31Draft();
    draft.answers[question.id] = 4;
    const profile = buildV31Profile(draft);
    const insight = profile.insights.find((item) => item.id === `single-${question.id}`)!;
    expect(insight.evidence).toEqual([{ id: question.id, text: question.statement, answer: "그런 편이에요" }]);
    expect(insight.nextStep.length).toBeGreaterThan(10);
    draft.priorities = answered([question.id]);
    expect(buildV31Profile(draft).priorityGuides[0]).toMatchObject({ title: insight.title, nextStep: insight.nextStep });
  });

  it("두 높은 답이 모두 있을 때만 긍정 조합을 만들고 둘의 실제 근거를 보인다", () => {
    for (const first of [1, 2, 3, 4, 5, "undecided", "not_applicable", "skipped", undefined] as const) {
      for (const second of [1, 2, 3, 4, 5, "undecided", "not_applicable", "skipped", undefined] as const) {
        const draft = createV31Draft();
        if (first !== undefined) draft.answers.T2 = first;
        if (second !== undefined) draft.answers.T3 = second;
        const insight = buildV31Profile(draft).insights.find((item) => item.id === "delegate-update");
        expect(Boolean(insight)).toBe(typeof first === "number" && first >= 4 && typeof second === "number" && second >= 4);
        if (insight) expect(insight.evidence.map((item) => item.id)).toEqual(["T2", "T3"]);
      }
    }
  });

  it("꽃과 하객 참여의 원하는 정도를 확인하며 정당한 두 답을 충돌로 만들지 않는다", () => {
    const draft = createV31Draft();
    draft.answers.V1 = 5;
    draft.tastes.ceremony = answered(["participatory", "thanks"]);
    draft.avoidances = answered(["heavy_decoration", "stage_participation"]);
    const profile = buildV31Profile(draft);
    expect(profile.insights.find((item) => item.id === "flower-amount")?.evidence.map((item) => item.id)).toEqual(["V1", "avoidances"]);
    expect(profile.insights.find((item) => item.id === "participation-format")?.nextStep).toContain("참여 여부를 하객이 선택");
    expect(profile.insights.filter((item) => ["flower-amount", "participation-format"].includes(item.id)).map((item) => item.body).join(" ")).not.toMatch(/모순|충돌|틀린|수정해야/);
    expect(decodeV31(encodeV31(draft))).toEqual(draft);
  });

  it("우선순위에서 같은 사진·야외·짧은 식순을 동의 문장과 이중으로 제시하지 않는다", () => {
    const draft = all(5);
    draft.tastes.photo = answered(["candid"]);
    draft.tastes.venue = answered(["outdoor"]);
    draft.tastes.ceremony = answered(["short"]);
    draft.avoidances = answered(["long_photography"]);
    const options = getV31PriorityOptions(draft);
    expect(options.filter((option) => /사진/.test(option.label)).map((option) => option.value)).toEqual(["taste.photo", "avoid.long_photography"]);
    expect(options.filter((option) => /야외/.test(option.label)).map((option) => option.value)).toEqual(["taste.venue"]);
    expect(options.filter((option) => /짧게|짧은/.test(option.label)).map((option) => option.value)).toEqual(["taste.ceremony"]);
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
    expect(buildV31Profile(draft).priorityGuides).toEqual([]);
  });

  it("원답 수정 때 사라진 회피·문장·취향 근거의 우선순위를 지우고 원본을 보존한다", () => {
    const draft = createV31Draft();
    draft.answers.B1 = 5;
    draft.avoidances = answered(["crowded_space", "loud_music"]);
    draft.priorities = answered(["B1", "avoid.crowded_space", "taste.photo"]);
    const normalized = normalizeV31Draft(draft);
    expect(normalized.priorities).toEqual(answered(["B1", "avoid.crowded_space"]));
    normalized.avoidances = answered(["loud_music"]);
    expect(normalizeV31Draft(normalized).priorities).toEqual(answered(["B1"]));
    normalized.answers.B1 = 3;
    expect(normalizeV31Draft(normalized).priorities).toBeUndefined();
    expect(draft.priorities).toEqual(answered(["B1", "avoid.crowded_space", "taste.photo"]));
    expect(draft.avoidances).toEqual(answered(["crowded_space", "loud_music"]));
  });

  it.each(["undecided", "not_applicable", "skipped"] as const)("전부 %s이면 성향·우선순위·공유를 만들지 않는다", (status) => {
    const draft = all(status);
    for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status };
    draft.avoidances = { status };
    draft.priorities = { status };
    draft.spending = { status };
    const profile = buildV31Profile(draft);
    expect(profile.respondedCount).toBe(34);
    expect(profile.hasContent).toBe(false);
    expect(profile.insights).toEqual([]);
    expect(profile.priorityGuides).toEqual([]);
    expect(profile.unresolved).toHaveLength(34);
    expect(decodeV31(encodeV31(draft))).toBeNull();
    expect(buildV31ShareUrl({ origin: "https://hanbang.ai", first: draft })).toBeNull();
  });

  it("명시적인 없음·열린 선호는 모름과 구분하고 미정 목록에 넣지 않는다", () => {
    const draft = createV31Draft();
    draft.tastes.photo = { status: "no_preference" };
    draft.avoidances = { status: "no_preference" };
    draft.priorities = { status: "no_preference" };
    draft.spending = { status: "no_preference" };
    const profile = buildV31Profile(draft);
    expect(profile.unresolved.map((item) => item.id)).not.toEqual(expect.arrayContaining(["taste.photo", "avoidances", "priorities", "spending"]));
    for (const id of ["taste.photo", "avoidances", "priorities", "spending"]) expect(profile.unresolved.some((item) => item.id === id)).toBe(false);
    expect(profile.avoidanceLabels).toEqual(["따로 피하고 싶은 것은 없어요"]);
    expect(profile.spendingLabels).toEqual(["더 쓰고 싶은 곳은 지금 없어요"]);
    expect(v31ChoiceLabels(draft.priorities, getV31PriorityOptions(draft))).toEqual(["특히 지킬 것을 따로 고르지 않을게요"]);
    for (const field of ["avoidances", "spending"] as const) {
      const onlyNone = createV31Draft();
      onlyNone[field] = { status: "no_preference" };
      expect(hasV31Content(onlyNone)).toBe(true);
      expect(decodeV31(encodeV31(onlyNone))).toEqual(onlyNone);
    }
  });

  it("사진이나 꽃 선호에서 지출 희망을 추정하지 않는다", () => {
    const draft = all(5);
    draft.tastes.photo = answered(["both_styles"]);
    expect(buildV31Profile(draft).insights.some((item) => item.id === "budget-explicit-spending")).toBe(false);
    draft.spending = { status: "no_preference" };
    expect(buildV31Profile(draft).insights.some((item) => item.id === "budget-explicit-spending")).toBe(false);
    draft.spending = answered(["beauty"]);
    const insight = buildV31Profile(draft).insights.find((item) => item.id === "budget-explicit-spending")!;
    expect(insight.body).toContain("헤어·메이크업");
    expect(insight.body).toContain("실제 금액을 묻지 않았어요");
    expect(insight.evidence.map((item) => item.id)).toEqual(["B1", "spending"]);
  });
});

describe("웨딩코드 v3.1 커플 응답 의미", () => {
  it("같이 높은 답·같이 낮은 답·중간·차이·비교 불가를 구별한다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.answers = { V1: 4, G1: 1, G2: 3, G3: 1, R3: "skipped", R4: "not_applicable" };
    second.answers = { V1: 5, G1: 2, G2: 4, G3: 4, R3: "undecided", R4: 5 };
    const items = compareV31(first, second);
    expect(items).toHaveLength(34);
    expect(items.slice(0, 6).map((item) => item.kind)).toEqual(["shared_wish", "shared_distance", "middle", "different", "unavailable", "unavailable"]);
    expect(row(first, second, "G1").followUp).toContain("두 사람 모두 가깝지 않다고");
    expect(row(first, second, "G1").followUp).not.toContain("꼭 초대");
  });

  it.each(["undecided", "not_applicable", "skipped", "no_match"] as const)("%s를 열린 선호나 지출의 명시적인 없음과 섞지 않는다", (status) => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.tastes.photo = { status };
    second.tastes.photo = { status: "no_preference" };
    first.spending = { status };
    second.spending = answered(["meal"]);
    first.avoidances = { status };
    second.avoidances = answered(["loud_music"]);
    for (const id of ["taste.photo", "spending", "avoidances"]) expect(row(first, second, id).kind).toBe("unavailable");
  });

  it("지출 희망 없음과 구체적인 희망을 양방향 모두 비교하되 반대로 단정하지 않는다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.spending = answered(["photo", "meal"]);
    second.spending = { status: "no_preference" };
    for (const [a, b] of [[first, second], [second, first]]) {
      const item = row(a, b, "spending");
      expect(item.kind).toBe("different");
      expect(item.followUp).toContain("상대의 희망에 반대한다는 뜻은 아니에요");
      expect(item.followUp).toContain("전체 예산을 늘리기로 합의한 것도 아니에요");
    }
    first.spending = { status: "no_preference" };
    expect(row(first, second, "spending").kind).toBe("middle");
    expect(row(first, second, "spending").followUp).toContain("더 쓰고 싶은 곳이 없다고");
  });

  it("취향의 어느 쪽도 괜찮음은 양방향 모두 열린 선호이고 합의가 아니다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.tastes.venue = answered(["outdoor"]);
    second.tastes.venue = { status: "no_preference" };
    for (const [a, b] of [[first, second], [second, first]]) {
      const item = row(a, b, "taste.venue");
      expect(item.kind).toBe("open_preference");
      expect(item.followUp).toContain("같은 취향으로 합의한 것은 아니에요");
    }
    first.tastes.venue = { status: "no_preference" };
    expect(row(first, second, "taste.venue").kind).toBe("open_preference");
  });

  it("공통 회피는 원하는 대상으로 표시하지 않고 없음도 비교할 수 있다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.avoidances = answered(["loud_music", "crowded_space"]);
    second.avoidances = answered(["crowded_space", "loud_music"]);
    expect(row(first, second, "avoidances").kind).toBe("shared_avoidance");
    second.avoidances = { status: "no_preference" };
    expect(row(first, second, "avoidances").kind).toBe("different");
    expect(row(second, first, "avoidances").kind).toBe("different");
    first.avoidances = { status: "no_preference" };
    expect(row(first, second, "avoidances").kind).toBe("middle");
  });

  it("일부만 겹치는 옷·식순·지출·회피도 공통 보기를 놓치지 않는다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.tastes.attire = answered(["simple", "flowing"]);
    second.tastes.attire = answered(["flowing", "traditional"]);
    first.tastes.ceremony = answered(["thanks", "short"]);
    second.tastes.ceremony = answered(["thanks", "performance"]);
    first.spending = answered(["photo", "meal"]);
    second.spending = answered(["beauty", "meal"]);
    first.avoidances = answered(["loud_music", "crowded_space"]);
    second.avoidances = answered(["loud_music", "stage_participation"]);
    for (const [id, label] of [["taste.attire", "하늘하늘한 옷"], ["taste.ceremony", "가족이나 하객에게 감사 인사"], ["spending", "식사"], ["avoidances", "큰 음악 소리"]]) {
      expect(row(first, second, id)).toMatchObject({ kind: "different", sharedLabels: [label] });
    }
  });

  it("사진의 둘 다와 자연스러운 순간은 전체 일치는 아니지만 자연스러운 사진을 함께 원한다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.tastes.photo = answered(["both_styles"]);
    second.tastes.photo = answered(["candid"]);
    expect(row(first, second, "taste.photo")).toMatchObject({ kind: "different", sharedLabels: ["자연스러운 순간"] });
    expect(row(second, first, "taste.photo")).toMatchObject({ kind: "different", sharedLabels: ["자연스러운 순간"] });
    second.tastes.photo = answered(["directed"]);
    expect(row(first, second, "taste.photo").sharedLabels).toEqual(["준비한 포즈와 장면"]);
  });

  it("같은 주제를 우선순위로 골라도 실제 취향이 다르면 공통 기준으로 만들지 않는다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.tastes.venue = answered(["indoor"]);
    second.tastes.venue = answered(["outdoor"]);
    first.priorities = answered(["taste.venue"]);
    second.priorities = answered(["taste.venue"]);
    expect(row(first, second, "priorities").kind).toBe("different");
    first.tastes.attire = answered(["simple", "flowing"]);
    second.tastes.attire = answered(["flowing", "simple"]);
    first.priorities = answered(["taste.attire"]);
    second.priorities = answered(["taste.attire"]);
    expect(row(first, second, "priorities").kind).toBe("shared_wish");
  });

  it("직접 우선순위로 확인한 차이를 먼저 보여주고 크기나 심각도를 추정하지 않는다", () => {
    const first = createV31Draft();
    const second = createV31Draft();
    first.answers = { V1: 5, H4: 4 };
    second.answers = { V1: 1, H4: 2 };
    first.avoidances = answered(["crowded_space"]);
    second.avoidances = { status: "no_preference" };
    first.priorities = answered(["H4", "avoid.crowded_space"]);
    expect(compareV31(first, second).slice(0, 3).map((item) => item.id)).toEqual(["H4", "avoidances", "V1"]);
  });
});

describe("웨딩코드 v3.1 공유와 구판 경계", () => {
  it("최대 복수 선택과 회피·지출·우선순위를 256자 안에서 왕복한다", () => {
    const draft = createV31Draft();
    WEDDING_CODE_V31_QUESTIONS.forEach((question, index) => { draft.answers[question.id] = ((index % 5) + 1) as V31Rating; });
    draft.answers.F1 = "undecided";
    draft.answers.F2 = "not_applicable";
    draft.answers.F3 = "skipped";
    delete draft.answers.F4;
    for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = answered(taste.options.slice(0, taste.max).map((option) => option.value));
    draft.avoidances = answered(WEDDING_CODE_V31_AVOIDANCES.map((option) => option.value));
    draft.priorities = answered(["taste.ceremony", "avoid.loud_music", "taste.guests"]);
    draft.spending = answered(["beauty", "photo"]);
    const code = encodeV31(draft);
    expect(code).toMatch(/^31_[a-z0-9_.-]+$/);
    expect(code.length).toBeLessThan(256);
    expect(decodeV31(code)).toEqual(draft);
  });

  it.each(["undecided", "not_applicable", "skipped", "no_preference", "no_match"] as const)("직접 선택의 %s 상태를 누락이나 다른 답으로 바꾸지 않는다", (status) => {
    const draft = all(3);
    for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status };
    draft.avoidances = { status };
    draft.priorities = { status };
    draft.spending = { status };
    expect(decodeV31(encodeV31(draft))).toEqual(draft);
  });

  it("v3.0 링크의 32문장·복합 식순과 새 25문장·분리 식순을 섞지 않는다", () => {
    const old = createV30Draft();
    old.answers.V3 = 5;
    old.tastes.ceremony = answered(["our_story"]);
    expect(WEDDING_CODE_V30_QUESTIONS).toHaveLength(32);
    expect(WEDDING_CODE_V30_TASTES.find((taste) => taste.key === "ceremony")?.options.find((option) => option.value === "our_story")?.label).toBe("둘의 이야기와 감사 인사");
    expect(decodeV30(encodeV30(old))).toEqual(old);
    expect(decodeV31(encodeV30(old))).toBeNull();
    expect(decodeV30(encodeV31(all(5)))).toBeNull();
  });

  it("버전·길이·알 수 없는 값·반복·초과 선택·빈 응답을 거절한다", () => {
    const code = encodeV31(all(4));
    const invalid = [null, undefined, "", code.repeat(30), `${code}_extra`, `${code}%00`,
      changePart(code, 0, "3"), changePart(code, 1, "4".repeat(24)), changePart(code, 1, "0".repeat(25)), changePart(code, 1, "p".repeat(25)),
      changePart(code, 2, "-.-.-.-.-"), changePart(code, 2, "czz.-.-.-.-.-"), changePart(code, 2, "c0001.-.-.-.-.-"),
      changePart(code, 2, "-.-.c0000.-.-.-"), changePart(code, 3, "c0000"), changePart(code, 3, "c05"),
      changePart(code, 4, "c00010203"), changePart(code, 4, "czz"), changePart(code, 4, "c0000"),
      changePart(code, 5, "c000102"), changePart(code, 5, "c0600"), changePart(code, 5, "c0000")];
    for (const value of invalid) expect(decodeV31(value), String(value)).toBeNull();
  });

  it("알 수 없는 필드·삭제한 문항·불법 상태·응답 없는 우선순위를 인코딩하지 않는다", () => {
    const draft = all(4);
    expect(() => encodeV31(Object.assign({}, draft, { memo: "개인 메모" }))).toThrow();
    const removed = all(4);
    Reflect.set(removed.answers, "V2", 5);
    expect(() => encodeV31(removed)).toThrow();
    const malformed = all(4);
    Reflect.set(malformed.answers, "V1", 6);
    expect(() => encodeV31(malformed)).toThrow();
    const oldVersion = all(4);
    Reflect.set(oldVersion, "version", "v3.0-preferences");
    expect(() => encodeV31(oldVersion)).toThrow();
    for (const values of [["photo", "photo"], [], ["nonexistent"]]) {
      draft.spending = answered(values);
      expect(() => encodeV31(draft)).toThrow();
    }
    draft.spending = Object.assign({ status: "skipped" as const }, { values: ["photo"] });
    expect(() => encodeV31(draft)).toThrow();
    delete draft.spending;
    draft.priorities = answered(["avoid.loud_music"]);
    expect(() => encodeV31(draft)).toThrow();
    draft.priorities = answered(["taste.photo"]);
    expect(() => encodeV31(draft)).toThrow();
    draft.priorities = answered(["V1"]);
    draft.answers.V1 = 3;
    expect(() => encodeV31(draft)).toThrow();
  });

  it("codec에 우선순위 값이 유효해도 원응답에서 확인할 수 없으면 거절한다", () => {
    const draft = all(4);
    draft.priorities = answered(["V1"]);
    const code = encodeV31(draft);
    expect(decodeV31(changePart(code, 1, `3${"4".repeat(24)}`))).toBeNull();
    draft.priorities = answered(["avoid.loud_music"]);
    draft.avoidances = answered(["loud_music"]);
    expect(decodeV31(changePart(encodeV31(draft), 3, "-"))).toBeNull();
    draft.priorities = answered(["taste.ceremony"]);
    draft.tastes.ceremony = answered(["thanks"]);
    expect(decodeV31(changePart(encodeV31(draft), 2, "-.-.-.-.-.-"))).toBeNull();
  });

  it("응답은 URL fragment에만 넣고 잘못된 origin이나 빈 두 번째 응답은 거절한다", () => {
    const first = all(4);
    const second = all(2);
    const url = new URL(buildV31ShareUrl({ origin: "https://hanbang.ai/", first, second })!);
    expect(url.pathname).toBe("/wedding-code");
    expect(url.search).toBe("");
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("v")).toBe(WEDDING_CODE_V31_VERSION);
    expect(decodeV31(params.get("a"))).toEqual(first);
    expect(decodeV31(params.get("b"))).toEqual(second);
    expect(buildV31ShareUrl({ origin: "https://hanbang.ai", first, second: all("skipped") })).toBeNull();
    for (const origin of ["javascript:alert(1)", "https://user:password@example.com", "https://hanbang.ai/path", "https://hanbang.ai/?answers=1", "https://hanbang.ai/#answers"]) expect(buildV31ShareUrl({ origin, first })).toBeNull();
  });
});

