import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V30_OPTIONS, WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_SPENDING,
  WEDDING_CODE_V30_TASTES, WEDDING_CODE_V30_TOPICS, WEDDING_CODE_V30_VERSION,
  type V30Draft, type V30Rating, type V30Response,
} from "@/constants/weddingCodeV30";
import {
  buildV30Profile, buildV30ShareUrl, compareV30, createV30Draft, decodeV30, encodeV30,
  getV30PriorityOptions, hasV30Content, normalizeV30Draft, v30ChoiceLabels, v30ResponseLabel,
} from "@/lib/weddingCode/v30";

function withAnswers(answers: V30Draft["answers"]): V30Draft {
  return { ...createV30Draft(), answers };
}
function all(value: V30Response): V30Draft {
  return withAnswers(Object.fromEntries(WEDDING_CODE_V30_QUESTIONS.map((question) => [question.id, value])));
}
function changePart(code: string, index: number, value: string): string {
  const parts = code.split("_");
  parts[index] = value;
  return parts.join("_");
}

describe("웨딩코드 v3 원응답과 해석 계약", () => {
  it("여덟 주제에 다른 문장을 네 개씩 묻고, 같은 다섯 답을 쓴다", () => {
    expect(WEDDING_CODE_V30_QUESTIONS).toHaveLength(32);
    expect(new Set(WEDDING_CODE_V30_QUESTIONS.map((question) => question.id)).size).toBe(32);
    expect(new Set(WEDDING_CODE_V30_QUESTIONS.map((question) => question.statement)).size).toBe(32);
    for (const topic of WEDDING_CODE_V30_TOPICS) expect(WEDDING_CODE_V30_QUESTIONS.filter((question) => question.topic === topic.key)).toHaveLength(4);
    expect(WEDDING_CODE_V30_OPTIONS.map((option) => option.label)).toEqual(["전혀 그렇지 않아요", "그렇지 않은 편이에요", "어느 쪽도 아니에요", "그런 편이에요", "매우 그래요"]);
    expect(WEDDING_CODE_V30_TASTES.map((taste) => taste.key)).toEqual(["venue", "photo", "attire", "meal", "guests", "ceremony"]);
    expect(WEDDING_CODE_V30_TASTES.find((taste) => taste.key === "guests")?.options.find((option) => option.value === "under50")?.label).toBe("1~49명");
  });

  it("중간·미정·비해당·건너뜀·미노출을 원응답과 결과에서 구분한다", () => {
    const draft = withAnswers({ V1: 3, V2: "undecided", V3: "not_applicable", V4: "skipped" });
    const profile = buildV30Profile(draft);
    expect(profile.ratedCount).toBe(1);
    expect(profile.respondedCount).toBe(4);
    expect(profile.insights).toEqual([]);
    expect(profile.unresolved.find((item) => item.id === "V1")).toBeUndefined();
    const values = [3, "undecided", "not_applicable", "skipped", undefined] as const;
    expect(new Set(values.map(v30ResponseLabel)).size).toBe(5);
    expect(profile.topics[0].responses.map((item) => item.answer)).toEqual(values.slice(0, 4).map(v30ResponseLabel));
    expect(profile.unresolved.find((item) => item.id === "G1")?.answer).toBe("아직 보지 않은 문장이에요");
    expect(decodeV30(encodeV30(draft))).toEqual(draft);
  });

  it.each([1, 2, 3] as const)("전부 %i라도 반대 취향이나 유형을 만들지 않는다", (rating) => {
    const profile = buildV30Profile(all(rating));
    expect(profile.ratedCount).toBe(32);
    expect(profile.insights).toEqual([]);
    expect(profile.priorityLabels).toEqual([]);
    expect(profile.tastes.every((taste) => taste.labels[0] === "아직 보지 않은 질문이에요")).toBe(true);
    expect(profile.topics.flatMap((topic) => topic.responses).every((item) => item.answer === v30ResponseLabel(rating))).toBe(true);
  });

  it("둘 다 높게 답한 문장만 조합하고 모든 실제 근거를 표시한다", () => {
    for (const first of [1, 2, 3, 4, 5, "undecided", "not_applicable", "skipped", undefined] as const) {
      for (const second of [1, 2, 3, 4, 5, "undecided", "not_applicable", "skipped", undefined] as const) {
        const draft = createV30Draft();
        if (first !== undefined) draft.answers.T2 = first;
        if (second !== undefined) draft.answers.T3 = second;
        const insight = buildV30Profile(draft).insights.find((item) => item.id === "delegate-update");
        expect(Boolean(insight)).toBe(typeof first === "number" && first >= 4 && typeof second === "number" && second >= 4);
        if (insight) {
          expect(insight.evidence.map((item) => item.id)).toEqual(["T2", "T3"]);
          expect(insight.evidence.map((item) => item.answer)).toEqual([v30ResponseLabel(first), v30ResponseLabel(second)]);
          expect(insight.body).toContain("계약이나 추가 결제가 없는");
        }
      }
    }
  });

  it("전부 높음은 조합을 보여주지만 중요도 순위나 우선순위를 만들지 않는다", () => {
    const profile = buildV30Profile(all(5));
    expect(profile.insights.length).toBeGreaterThan(3);
    expect(profile.priorityLabels).toEqual([]);
    expect(profile.insights.every((insight) => insight.evidence.length >= 2 && insight.evidence.every((item) => item.answer === "매우 그래요"))).toBe(true);
    expect(JSON.stringify(profile)).not.toMatch(/궁합|확률|상위|유형|점수|절약형|균형형/);
  });

  it("사진 취향만으로 돈을 더 쓰겠다는 설명을 만들지 않는다", () => {
    const draft = withAnswers({ B1: 5, R1: 5, R2: 4 });
    draft.tastes.photo = { status: "answered", values: ["both_styles"] };
    expect(buildV30Profile(draft).insights.some((item) => item.id === "budget-explicit-spending")).toBe(false);
    draft.spending = { status: "no_preference" };
    expect(buildV30Profile(draft).insights.some((item) => item.id === "budget-explicit-spending")).toBe(false);
    draft.spending = { status: "answered", values: ["photo"] };
    const insight = buildV30Profile(draft).insights.find((item) => item.id === "budget-explicit-spending")!;
    expect(insight.body).toContain("사진·영상");
    expect(insight.body).toContain("이 질문에서는 실제 금액을 묻지 않았어요");
    expect(insight.body).not.toContain("아직 정하지 않았어요");
    expect(insight.evidence.map((item) => item.id)).toEqual(["B1", "spending"]);
  });

  it("직접 취향과 앞 문장이 다르면 두 답을 보존하고 확인을 제안한다", () => {
    const draft = withAnswers({ V2: 1 });
    draft.tastes.venue = { status: "answered", values: ["outdoor"] };
    const profile = buildV30Profile(draft);
    const insight = profile.insights.find((item) => item.id === "check-V2-venue")!;
    expect(insight.evidence).toEqual([
      { id: "V2", text: "야외에서 식을 올리고 싶다.", answer: "전혀 그렇지 않아요" },
      { id: "taste.venue", text: WEDDING_CODE_V30_TASTES[0].question, answer: "야외" },
    ]);
    expect(profile.tastes[0].labels).toEqual(["야외"]);
    expect(profile.topics[0].responses.find((item) => item.id === "V2")?.answer).toBe("전혀 그렇지 않아요");
    expect(decodeV30(encodeV30(draft))).toEqual(draft);
  });

  it("우선순위는 긍정한 문장과 직접 고른 취향만 후보이며 자동 선택하지 않는다", () => {
    const draft = withAnswers({ V1: 5, V2: 4, V3: 3, V4: 2, G1: "undecided" });
    draft.tastes.venue = { status: "answered", values: ["indoor"] };
    draft.tastes.photo = { status: "no_preference" };
    const options = getV30PriorityOptions(draft);
    expect(options.map((option) => option.value)).toEqual(["V1", "V2", "taste.venue"]);
    expect(options[2].label).toBe("장소: 실내");
    expect(buildV30Profile(draft).priorityLabels).toEqual([]);
    draft.priorities = { status: "answered", values: ["taste.venue", "V2"] };
    expect(buildV30Profile(draft).priorityLabels).toEqual(["장소: 실내", "야외에서 올리는 식"]);
  });

  it("이전 답을 바꾸면 더는 근거가 없는 우선순위만 지우며 원본을 바꾸지 않는다", () => {
    const draft = withAnswers({ V1: 3, V2: 4 });
    draft.tastes.venue = { status: "skipped" };
    draft.priorities = { status: "answered", values: ["V1", "V2", "taste.venue"] };
    draft.spending = { status: "undecided" };
    const normalized = normalizeV30Draft(draft);
    expect(normalized.priorities).toEqual({ status: "answered", values: ["V2"] });
    expect(draft.priorities.values).toEqual(["V1", "V2", "taste.venue"]);
    expect(normalized.spending).toEqual({ status: "undecided" });
    normalized.answers.V2 = 3;
    expect(normalizeV30Draft(normalized).priorities).toBeUndefined();
    expect(draft.answers.V2).toBe(4);
    expect(normalizeV30Draft({ ...draft, priorities: { status: "skipped" } }).priorities).toEqual({ status: "skipped" });
  });

  it.each(["undecided", "not_applicable", "skipped"] as const)("전부 %s면 결과를 지어내거나 공유 링크를 만들지 않는다", (status) => {
    const draft = all(status);
    for (const taste of WEDDING_CODE_V30_TASTES) draft.tastes[taste.key] = { status };
    draft.priorities = { status };
    draft.spending = { status };
    const profile = buildV30Profile(draft);
    expect(profile.respondedCount).toBe(40);
    expect(profile.ratedCount).toBe(0);
    expect(profile.hasContent).toBe(false);
    expect(profile.insights).toEqual([]);
    expect(profile.priorityLabels).toEqual([]);
    expect(decodeV30(encodeV30(draft))).toBeNull();
    expect(buildV30ShareUrl({ origin: "https://hanbang.ai", first: draft })).toBeNull();
  });

  it("어느 취향도 괜찮음은 미정과 다르고, 지출을 고르지 않음만으로 결과를 만들지 않는다", () => {
    const draft = createV30Draft();
    draft.tastes.venue = { status: "no_preference" };
    expect(hasV30Content(draft)).toBe(true);
    expect(decodeV30(encodeV30(draft))).toEqual(draft);
    draft.tastes.venue = { status: "no_match" };
    expect(hasV30Content(draft)).toBe(false);
    draft.spending = { status: "no_preference" };
    expect(hasV30Content(draft)).toBe(false);
    draft.spending = { status: "answered", values: ["meal"] };
    expect(hasV30Content(draft)).toBe(true);
  });
});

describe("웨딩코드 v3 커플 비교", () => {
  it("공통 긍정·같이 낮음·중간·차이·비교 불가를 원문 기준으로 구분한다", () => {
    const result = compareV30(withAnswers({ V1: 4, V2: 1, V3: 3, V4: 3, G1: 1, G2: "not_applicable", G3: "skipped", H1: 5 }), withAnswers({ V1: 5, V2: 2, V3: 3, V4: 4, G1: 4, G2: 5, G3: "undecided", H1: 5 }));
    expect(result).toHaveLength(40);
    const kind = (id: string) => result.find((item) => item.id === id)?.kind;
    expect(kind("V1")).toBe("shared_wish");
    expect(kind("V2")).toBe("shared_distance");
    expect(kind("V3")).toBe("middle");
    expect(kind("V4")).toBe("middle");
    expect(kind("G1")).toBe("different");
    expect(kind("G2")).toBe("unavailable");
    expect(kind("G3")).toBe("unavailable");
    expect(kind("G4")).toBe("unavailable");
    expect(result.find((item) => item.id === "G3")).toMatchObject({ first: "지금 답하지 않을게요", second: "아직 모르겠어요" });
    expect(result.find((item) => item.id === "H1")?.followUp).toContain("서로 해줄 수 있는 방식과 여유");
  });

  it("중간 응답과 비해당을 공통 희망으로 만들지 않는다", () => {
    for (const status of [3, "undecided", "not_applicable", "skipped"] as const) expect(compareV30(all(status), all(status)).some((item) => item.kind === "shared_wish")).toBe(false);
  });

  it("겹치는 직접 선택은 완전 일치로 표시하지 않고 각자의 답을 모두 남긴다", () => {
    const first = createV30Draft();
    const second = createV30Draft();
    first.tastes.attire = { status: "answered", values: ["simple", "flowing"] };
    second.tastes.attire = { status: "answered", values: ["simple", "traditional"] };
    first.tastes.photo = { status: "answered", values: ["candid"] };
    second.tastes.photo = { status: "answered", values: ["candid"] };
    const result = compareV30(first, second);
    expect(result.find((item) => item.id === "taste.attire")).toMatchObject({ kind: "different", first: "깔끔하고 단순한 옷 · 하늘하늘한 옷", second: "깔끔하고 단순한 옷 · 한복 같은 전통 혼례복" });
    expect(result.find((item) => item.id === "taste.photo")?.kind).toBe("shared_wish");
  });

  it("같은 취향 주제를 우선순위로 골라도 실제 보기가 다르면 공통 희망이 아니다", () => {
    const first = createV30Draft();
    const second = createV30Draft();
    first.tastes.venue = { status: "answered", values: ["indoor"] };
    second.tastes.venue = { status: "answered", values: ["outdoor"] };
    first.priorities = { status: "answered", values: ["taste.venue"] };
    second.priorities = { status: "answered", values: ["taste.venue"] };
    expect(compareV30(first, second).find((item) => item.id === "priorities")).toMatchObject({ kind: "different", first: "장소: 실내", second: "장소: 야외" });
  });

  it("같은 보기를 다른 순서로 고른 우선순위는 차이로 만들지 않는다", () => {
    const first = createV30Draft();
    const second = createV30Draft();
    first.tastes.attire = { status: "answered", values: ["simple", "flowing"] };
    second.tastes.attire = { status: "answered", values: ["flowing", "simple"] };
    first.priorities = { status: "answered", values: ["taste.attire"] };
    second.priorities = { status: "answered", values: ["taste.attire"] };
    const result = compareV30(first, second);
    expect(result.find((item) => item.id === "taste.attire")?.kind).toBe("shared_wish");
    expect(result.find((item) => item.id === "priorities")?.kind).toBe("shared_wish");
    expect(result.find((item) => item.id === "priorities")?.first).not.toBe(result.find((item) => item.id === "priorities")?.second);
  });

  it("낮게 답하거나 비해당인 문장을 원하는 것으로 전제하지 않고 대화를 제안한다", () => {
    const first = withAnswers({ V1: 1, V2: "not_applicable", B2: 1 });
    const second = withAnswers({ V1: 2, V2: "not_applicable", B2: 5 });
    const result = compareV30(first, second);
    const flowers = result.find((item) => item.id === "V1")!;
    expect(flowers.kind).toBe("shared_distance");
    expect(flowers.followUp).toContain("두 사람 모두 가깝지 않다고 답했어요");
    expect(flowers.followUp).toContain("어느 정도면 좋을까요");
    expect(flowers.followUp).not.toContain("꼭 두고 싶은 곳");
    const outdoor = result.find((item) => item.id === "V2")!;
    expect(outdoor.kind).toBe("unavailable");
    expect(outdoor.followUp).toContain("지금 필요한지");
    expect(outdoor.followUp).not.toContain("마음에 드는 야외 공간");
    const spending = result.find((item) => item.id === "B2")!;
    expect(spending.kind).toBe("different");
    expect(spending.followUp).toContain("비용을 옮기고 싶은지");
    expect(spending.followUp).not.toContain("하나씩 골라");
  });

  it("고르지 않은 직접 취향·지출에는 원하는 것을 고르라는 후속 안내를 붙이지 않는다", () => {
    const first = createV30Draft();
    const second = createV30Draft();
    first.tastes.photo = { status: "not_applicable" };
    second.tastes.photo = { status: "skipped" };
    first.spending = { status: "no_preference" };
    second.spending = { status: "no_preference" };
    const result = compareV30(first, second);
    expect(result.find((item) => item.id === "taste.photo")?.followUp).toContain("지금 이야기하고 싶은 내용인지");
    expect(result.find((item) => item.id === "taste.photo")?.followUp).not.toContain("남기고 싶은 장면");
    expect(result.find((item) => item.id === "spending")?.followUp).not.toContain("줄여도 되는 항목");
    expect(result.find((item) => item.id === "spending")?.first).toBe("지금은 더 쓰고 싶은 곳이 없어요");
    expect(WEDDING_CODE_V30_SPENDING.find((option) => option.value === "venue")?.label).toBe("예식 장소·꾸미기");
  });

  it("차이가 큰 순서가 아니라 직접 지키고 싶다고 고른 차이를 먼저 보여준다", () => {
    const first = withAnswers({ V1: 5, H4: 4, D1: 4 });
    first.priorities = { status: "answered", values: ["H4", "D1"] };
    const second = withAnswers({ V1: 1, H4: 2, D1: 2 });
    const result = compareV30(first, second);
    expect(result.slice(0, 3).map((item) => item.id)).toEqual(["D1", "H4", "V1"]);
    expect(result[0].isPriority).toBe(true);
    expect(result[2].isPriority).toBe(false);
  });
});

describe("웨딩코드 v3 공유 경계", () => {
  it("다섯 단계·별도 상태·여섯 취향·끝쪽 취향 우선순위를 짧은 값으로 왕복한다", () => {
    const draft = createV30Draft();
    WEDDING_CODE_V30_QUESTIONS.forEach((question, index) => { draft.answers[question.id] = ((index % 5) + 1) as V30Rating; });
    draft.answers.F1 = "undecided";
    draft.answers.F2 = "not_applicable";
    draft.answers.F3 = "skipped";
    delete draft.answers.F4;
    for (const taste of WEDDING_CODE_V30_TASTES) draft.tastes[taste.key] = { status: "answered", values: [taste.options[0].value] };
    draft.priorities = { status: "answered", values: ["taste.venue", "taste.guests", "taste.ceremony"] };
    draft.spending = { status: "answered", values: ["photo", "meal"] };
    const code = encodeV30(draft);
    expect(code).toMatch(/^[a-z0-9_.-]+$/);
    expect(code.length).toBeLessThan(256);
    expect(decodeV30(code)).toEqual(draft);
  });

  it("모든 직접 선택 상태와 미노출을 서로 바꾸지 않는다", () => {
    for (const status of ["undecided", "not_applicable", "skipped", "no_preference", "no_match"] as const) {
      const draft = withAnswers({ V1: 3 });
      for (const taste of WEDDING_CODE_V30_TASTES) draft.tastes[taste.key] = { status };
      draft.priorities = { status };
      draft.spending = { status };
      expect(decodeV30(encodeV30(draft))).toEqual(draft);
    }
    expect(v30ChoiceLabels(undefined, WEDDING_CODE_V30_SPENDING)).not.toEqual(v30ChoiceLabels({ status: "skipped" }, WEDDING_CODE_V30_SPENDING));
  });

  it("버전·필드 수·길이·미등록 값·중복·선택 개수 위반을 거절한다", () => {
    const valid = encodeV30(all(4));
    const invalid = [
      null, undefined, "", valid.repeat(20), `${valid}_extra`, changePart(valid, 0, "2"),
      changePart(valid, 1, "4".repeat(31)), changePart(valid, 1, "0".repeat(32)), changePart(valid, 1, "p".repeat(32)),
      changePart(valid, 2, "-.-.-.-.-"), changePart(valid, 2, "czz.-.-.-.-.-"),
      changePart(valid, 2, "c0001.-.-.-.-.-"), changePart(valid, 2, "-.-.c0000.-.-.-"),
      changePart(valid, 3, "c000000"), changePart(valid, 3, "c00010203"), changePart(valid, 3, "czz"),
      changePart(valid, 4, "c000102"), changePart(valid, 4, "c0000"), `${valid}%00`,
    ];
    for (const code of invalid) expect(decodeV30(code)).toBeNull();
  });

  it("높게 답하지 않은 문장이나 미응답 취향을 우선순위로 주입할 수 없다", () => {
    const draft = withAnswers({ V1: 4 });
    draft.priorities = { status: "answered", values: ["V1"] };
    const valid = encodeV30(draft);
    expect(decodeV30(changePart(valid, 1, `3${"-".repeat(31)}`))).toBeNull();
    expect(decodeV30(changePart(valid, 3, "c0w"))).toBeNull();
  });

  it("임의의 숨은 필드나 잘못된 상태를 인코딩하지 않는다", () => {
    const valid = withAnswers({ V1: 4 });
    expect(() => encodeV30(Object.assign({}, valid, { note: "비공개 메모" }))).toThrow();
    const badVersion = withAnswers({ V1: 4 });
    Reflect.set(badVersion, "version", "v2.0-agreement");
    expect(() => encodeV30(badVersion)).toThrow();
    const badAnswer = withAnswers({ V1: 4 });
    Reflect.set(badAnswer.answers, "V1", 6);
    expect(() => encodeV30(badAnswer)).toThrow();
    const extraAnswer = withAnswers({ V1: 4 });
    Reflect.set(extraAnswer.answers, "injected", 5);
    expect(() => encodeV30(extraAnswer)).toThrow();
    const badChoice = withAnswers({ V1: 4 });
    badChoice.spending = { status: "answered", values: ["photo", "photo"] };
    expect(() => encodeV30(badChoice)).toThrow();
    badChoice.spending = { status: "answered", values: [] };
    expect(() => encodeV30(badChoice)).toThrow();
    badChoice.spending = Object.assign({ status: "skipped" as const }, { values: ["photo"] });
    expect(() => encodeV30(badChoice)).toThrow();
  });

  it("답은 fragment에만 담고, 빈 두 번째 답을 초대 링크로 조용히 바꾸지 않는다", () => {
    const first = withAnswers({ V1: 4 });
    const second = withAnswers({ V1: 1 });
    const share = buildV30ShareUrl({ origin: "https://hanbang.ai/", first, second });
    expect(share).not.toBeNull();
    const parsed = new URL(share!);
    expect(parsed.search).toBe("");
    expect(parsed.pathname).toBe("/wedding-code");
    const params = new URLSearchParams(parsed.hash.slice(1));
    expect(params.get("v")).toBe(WEDDING_CODE_V30_VERSION);
    expect(decodeV30(params.get("a"))).toEqual(first);
    expect(decodeV30(params.get("b"))).toEqual(second);
    expect(buildV30ShareUrl({ origin: "https://hanbang.ai", first, second: all("skipped") })).toBeNull();
    expect(buildV30ShareUrl({ origin: "https://hanbang.ai", first: createV30Draft() })).toBeNull();
    for (const origin of ["javascript:alert(1)", "https://user:password@hanbang.ai", "https://hanbang.ai/?answer=4", "https://hanbang.ai/#answer", "https://hanbang.ai/unexpected-path"]) expect(buildV30ShareUrl({ origin, first })).toBeNull();
  });
});
