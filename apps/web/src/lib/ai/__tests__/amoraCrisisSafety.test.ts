import { describe, expect, it } from "vitest";

import {
  buildAmoraCrisisResponse,
  classifyAmoraCrisis,
} from "@/lib/ai/amoraCrisisSafety";

describe("classifyAmoraCrisis", () => {
  it("detects a direct self-harm disclosure after Unicode and zero-width normalization", () => {
    expect(classifyAmoraCrisis("지금 죽\u200B고 싶어요")).toEqual({
      kind: "self_harm",
    });
    expect(classifyAmoraCrisis("지금 죽\u2066고 싶어요")).toEqual({
      kind: "self_harm",
    });
    expect(classifyAmoraCrisis("성\u034F폭행을 당했어")).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it("does not treat quoted, educational, or third-person discussion as the user's crisis", () => {
    expect(classifyAmoraCrisis('"죽고 싶다"라는 문구를 검토해줘')).toBeNull();
    expect(classifyAmoraCrisis('친구가 "죽고 싶다"고 말했는데 어떻게 도와?')).toBeNull();
    expect(classifyAmoraCrisis("자살 예방 캠페인 문구를 추천해줘")).toBeNull();
  });

  it.each([
    "살고 싶지 않아",
    "자살하고 싶어요",
    "자해할 생각이 들어",
    "지금 목숨을 끊을 거야",
    "극단적 선택을 하려고 해",
    "죽으려고 약을 먹었어",
    "방금 손목을 그었어",
    "그냥 죽어버릴 거야",
  ])("detects direct self-harm intent or a reported attempt: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
  });

  it.each([
    "지금 남자친구가 나를 때리고 있어",
    "방금 배우자에게 맞았어",
    "칼을 들고 죽이겠다고 협박해",
    "집에 감금됐어. 못 나가게 해",
    "스토킹 중이고 지금 집 앞에 있어",
    "성\u200B폭행을 당했어",
    "강제로 성관계를 요구하면서 위협하고 있어",
    "데이트폭력을 당하고 있어",
    "배우자가 폭력을 쓰고 있어",
    "상대가 나를 죽일 것 같아",
    "남편이 칼을 들고 있어. 살려줘",
    "상대가 나를 죽여버리겠다고 해",
  ])("detects a current violence, threat, or sexual-violence disclosure: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "interpersonal_danger" });
  });

  it.each([
    "가정폭력 상담 페이지 문구를 작성해줘",
    '"죽이겠다"는 협박 표현의 법적 의미가 뭐야?',
    "결혼식장 폭력 예방 정책을 검토해줘",
    "영화의 성폭행 장면에 대한 비평을 써줘",
  ])("does not classify meta discussion of violence as current danger: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "퀴즈 정답을 맞았어",
    "하나를 때리는 장면을 편집해줘",
    "내가 쓴 소설에서 주인공이 자살하고 싶어해",
    "친구가 자해할 생각이 든다고 했어",
    "고객이 자살하고 싶다고 쓴 메시지에 어떻게 답해야 해?",
    "누가 죽고 싶다고 말하면 뭐라고 해야 해?",
    "죽고 싶지 않아. 나는 살고 싶어",
    "자해하지 않을 거야",
  ])("avoids ambiguous or third-person false positives: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it("still detects a direct disclosure after a meta or third-person clause", () => {
    expect(classifyAmoraCrisis("친구가 죽고 싶다고 했어. 나도 지금 죽고 싶어")).toEqual({
      kind: "self_harm",
    });
    expect(classifyAmoraCrisis("영화 얘기가 아니라, 나 진짜 죽고 싶어")).toEqual({
      kind: "self_harm",
    });
  });

  it("keeps both safety paths when self-harm and interpersonal danger coexist", () => {
    expect(classifyAmoraCrisis("상대가 칼을 들고 협박해. 나도 죽고 싶어")).toEqual({
      kind: "combined",
    });
  });
});

describe("buildAmoraCrisisResponse", () => {
  it("uses fixed Korean self-harm contacts and an outside-Korea fallback", () => {
    const response = buildAmoraCrisisResponse("self_harm");

    expect(response).toContain("위기 상담기관이 아니");
    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toContain("24시간");
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("한국 밖");
    expect(response).toContain("현지 긴급번호");
  });

  it("uses fixed violence-support contacts without assuming the user is in Korea", () => {
    const response = buildAmoraCrisisResponse("interpersonal_danger");

    expect(response).toContain("위기 상담기관이 아니");
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toMatch(/여성긴급전화\s*1366/);
    expect(response).toContain("365일 24시간");
    expect(response).toContain("한국 밖");
    expect(response).toContain("현지 긴급번호");
  });

  it("includes both 109 and 1366 for a combined crisis", () => {
    const response = buildAmoraCrisisResponse("combined");

    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toMatch(/여성긴급전화\s*1366/);
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("한국 밖");
  });
});
