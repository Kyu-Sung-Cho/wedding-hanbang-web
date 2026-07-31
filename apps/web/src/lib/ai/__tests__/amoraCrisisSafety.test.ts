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

  it("does not treat quoted or educational discussion as a current crisis", () => {
    expect(classifyAmoraCrisis('"죽고 싶다"라는 문구를 검토해줘')).toBeNull();
    expect(classifyAmoraCrisis("자살 예방 캠페인 문구를 추천해줘")).toBeNull();
  });

  it.each([
    '친구가 "죽고 싶다"고 말했는데 어떻게 도와?',
    "친구가 지금 죽으려고 약을 먹었어. 어떻게 도와?",
    "친구가 목숨을 끊고 싶어해. 어떻게 도와야 할까?",
    "동생이 자해할 생각이 든다고 했어",
    "친구가 방금 수면제를 한 통 먹었어요",
    "친구가 수면제 30알을 먹었어요",
    "동생이 약을 다 삼켰어",
    "친구가 목을 맸다가 풀었어",
    "친구가 타이레놀 30알 먹었어",
    "친구가 아세트아미노펜을 과다 복용했어",
    "엄마가 약을 한꺼번에 먹었어",
    "친구가 수면제 열 알 먹었어",
    "친구가 수면제 10개 먹었어",
    "친구가 농약을 마셨어",
    "친구가 락스를 마셨어",
    "친구가 세제를 마셨어",
    "친구가 번개탄 피웠어",
    "친구가 연탄 피웠어",
    "친구가 차 안에 번개탄을 피워놨어",
    "친구가 차 안에서 번개탄을 피우고 있어",
    "친구가 아파트 옥상에서 뛰어내릴 거야",
    "친구가 다리에서 뛰어내리려고 해",
    "친구가 수면제를 먹고 의식이 없어요",
  ])("detects a real third-party self-harm disclosure: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "third_party_self_harm",
    });
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
    "나 그냥 죽을래",
    "죽어야겠어",
    "죽어 버리고 싶어",
    "목숨을 끊어버리고 싶어",
    "제가 방금 수면제를 한 통 먹었어요",
    "제가 수면제 30알을 먹었어요",
    "나 지금 약을 다 삼켰어",
    "진통제를 너무 많이 먹었어",
    "목을 맸다가 풀었어",
    "옥상 난간에서 뛰어내리려고 해",
    "타이레놀 30알 먹었어",
    "아세트아미노펜을 과다 복용했어",
    "약을 한꺼번에 먹었어",
    "약을 왕창 먹었어",
    "약 한 움큼 먹었어",
    "수면제 열 알 먹었어",
    "수면제 10개 먹었어",
    "농약을 마셨어",
    "락스를 마셨어",
    "세제를 마셨어",
    "부동액을 마셨어",
    "번개탄 피웠어",
    "연탄 피웠어",
    "차 안에서 번개탄 피워놨어",
    "차 안에서 번개탄을 피우고 있어",
    "아파트 옥상에서 뛰어내릴 거야",
    "다리에서 뛰어내릴래",
    "자살 예방 글을 읽다가 오히려 죽고 싶어졌어",
    "영화를 보고 죽고 싶어졌어",
    "자살 예방 영상을 봤는데 나도 죽고 싶어",
    "논문 쓰다가 너무 힘들어서 죽고 싶어",
    "나 죽으려고 해",
    "오늘 죽을 생각이에요",
    "자살 생각이 들어요",
    "약을 먹고 죽으려고 했어요",
    "수면제를 먹었어요. 죽으려고요",
    "베란다에서 뛰어내리려고 해요",
    "한강에서 뛰어내릴 거야",
  ])("detects direct self-harm intent or a reported attempt: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
  });

  it.each([
    ["목숨을 끊고 싶어", "self_harm"],
    ["죽어버릴래", "self_harm"],
    ["협박하고 있어", "interpersonal_danger"],
    ["계속 협박하고 있어", "interpersonal_danger"],
    ["성범죄를 당하고 있어", "interpersonal_danger"],
  ] as const)("detects common Korean crisis phrasing: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
  });

  it.each([
    ["그만 살고 싶어", "self_harm"],
    ["죽고만 싶어", "self_harm"],
    ["나 차라리 사라지고 싶어", "self_harm"],
    ["지금 살고 싶은 마음이 하나도 없어", "self_harm"],
    ["약을 잔뜩 털어 넣었어", "self_harm"],
    ["친구가 그만 살고 싶다고 했어", "third_party_self_harm"],
    ["친구가 약을 잔뜩 털어 넣었어", "third_party_self_harm"],
    ["나는 친구가 그만 살고 싶다고 해서 걱정돼", "third_party_self_harm"],
    ["나는 친구가 약을 잔뜩 털어 넣어서 걱정돼", "third_party_self_harm"],
    ["친구는 내가 그만 살고 싶다고 해서 걱정해", "self_harm"],
    ["친구는 내가 약을 잔뜩 털어 넣어서 걱정해", "self_harm"],
  ] as const)("detects high-risk Korean euphemisms without losing attribution: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
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
    "성범죄 피해를 입었어",
    "남편이 위협 중이야",
    "남편에게 맞았는데 법적 도움 받고 싶어",
    "남편에게 맞아서 법적 대응하고 싶어",
    "성폭행을 당했는데 법적 도움을 받고 싶어",
    "남편이 지금 목을 조르고 있어요",
    "남자친구가 성관계를 강요해요",
    "남편이 저를 죽이려고 해요",
    "남편이 내 목을 졸랐어",
    "나를 발로 찼어",
    "신랑이 주먹으로 쳤어",
    "남편이 밀치고 물건을 던지고 있어",
    "칼 들고 집 앞에 찾아왔어",
    "내 위치를 추적해서 집 앞에서 기다리고 있어",
    "강제로 관계를 맺었어",
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
    "고객이 자살하고 싶다고 쓴 메시지에 어떻게 답해야 해?",
    "누가 죽고 싶다고 말하면 뭐라고 해야 해?",
    "죽고 싶지 않아. 나는 살고 싶어",
    "자해하지 않을 거야",
    '"죽어버릴래"라는 대사를 다듬어줘',
    '"계속 협박하고 있어"라는 문구를 검토해줘',
    "성범죄 예방 교육 문구를 써줘",
    "법적으로 협박이라는 단어의 의미를 검토해줘",
    "누구를 협박하고 있지 않아",
    "성범죄를 당하고 있지 않아",
    "처방대로 수면제를 한 알 먹었어",
    "처방대로 타이레놀 한 알 먹었어",
    "수면제를 한 통 먹으면 어떻게 되나요?",
    "타이레놀 30알 먹으면 어떻게 되나요?",
    "농약을 마시면 어떻게 되나요?",
    "번개탄을 피우면 어떻게 되나요?",
    "옥상에서 뛰어내리면 어떻게 되나요?",
    "약을 다 먹은 건 아니야",
    "타이레놀 30알 먹은 건 아니야",
    "수면제 열 알 먹지 않았어",
    "수면제 열 알 먹으면 위험해?",
    "락스를 마신 건 아니야",
    "세제를 마시지 않았어",
    "세제를 마셨다면 어떻게 해야 해?",
    "번개탄을 피운 건 아니야",
    "번개탄을 피워놓은 건 아니야",
    "번개탄을 피워놓으면 어떻게 돼?",
    "연탄을 피운 건 아니야",
    "옥상에서 뛰어내리려는 건 아니야",
    "목을 매지 않았어",
    "영화에서 주인공이 수면제를 한 통 먹는 장면을 검토해줘",
    '"타이레놀 30알 먹었어"라는 대사를 검토해줘',
    '"차 안에 번개탄을 피워놨어"라는 영화 대사를 검토해줘',
    "뉴스에서 번개탄을 피운 사건을 읽었어",
    "번개탄을 피운 사건을 뉴스에서 읽었어",
    "보일러에 연탄을 갈았어",
    "소설에서 주인공이 농약을 마시는 장면을 검토해줘",
    "드레스 투어 너무 힘들어서 죽을 것 같아",
    "친구가 웃겨서 죽을 것 같아",
    "남편이 게임에서 나를 죽이려고 해",
    "그만 살고 싶은 건 아니야",
    "죽고만 싶은 건 아니야",
    "차라리 사라지고 싶은 건 아니야",
    "살고 싶은 마음이 없는 건 아니야",
    "그만 살고 싶으면 어떻게 도와야 해?",
    "약을 잔뜩 털어 넣은 건 아니야",
    "약을 잔뜩 털어 넣으면 어떻게 돼?",
    "영화에서 주인공이 약을 잔뜩 털어 넣는 장면을 검토해줘",
    "친구가 약을 약통에 잔뜩 털어 넣었어",
    "신랑이 넥타이를 너무 꽉 졸랐어",
    "드레스 허리끈을 졸랐어",
    "축구하다가 공을 발로 찼어",
    "신랑이 축구공을 발로 찼어",
    "신랑이 주먹으로 문을 쳤어",
    "결혼식에서 꽃가루를 던지고 있어",
    "업체와 강제로 관계를 맺었어",
    "강제로 관계를 맺은 건 아니야",
    "영화에서 주인공이 강제로 관계를 맺는 장면을 검토해줘",
    "칼을 들고 집 앞에 찾아온 건 아니야",
    "배송 기사 위치를 추적해서 집 앞에서 기다리고 있어",
    "남편이 내 목을 조른 건 아니야",
    "남편이 내 목을 조르지 않았어",
    "나를 발로 차지 않았어",
    "신랑이 주먹으로 치지 않았어",
    "남편이 게임에서 칼 들고 집 앞에 찾아왔어",
  ])("avoids ambiguous, hypothetical, or non-current false positives: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it("still detects a direct disclosure after a meta or third-person clause", () => {
    expect(classifyAmoraCrisis("친구가 죽고 싶다고 했어. 나도 지금 죽고 싶어")).toEqual({
      kind: "combined",
    });
    expect(classifyAmoraCrisis("영화 얘기가 아니라, 나 진짜 죽고 싶어")).toEqual({
      kind: "self_harm",
    });
    expect(
      classifyAmoraCrisis("법적 도움 받고 싶은데 남편이 지금 나를 때리고 있어")
    ).toEqual({ kind: "interpersonal_danger" });
    expect(
      classifyAmoraCrisis("예방 교육도 들었는데 오늘 남편이 나를 때리고 있어")
    ).toEqual({ kind: "interpersonal_danger" });
    expect(
      classifyAmoraCrisis('"죽이겠다"라고 말하면서 칼을 들고 있어')
    ).toEqual({ kind: "interpersonal_danger" });
    expect(
      classifyAmoraCrisis('"죽고 싶어"라고 말하고 지금 약을 먹었어')
    ).toEqual({ kind: "self_harm" });
  });

  it.each([
    ["죽고 싶지 않지만 자해할 생각이 들어", "self_harm"],
    ["남편이 협박하고 있지 않지만 폭력을 쓰고 있어", "interpersonal_danger"],
  ] as const)("scopes a negation to its own cue: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
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
    expect(response).toContain("본인과 다른 사람 모두의 안전");
    expect(response).toContain("한국 밖");
    expect(response).toContain("현지 긴급번호");
  });

  it("gives a reporter immediate third-party safety steps and fixed contacts", () => {
    const response = buildAmoraCrisisResponse("third_party_self_harm");

    expect(response).toContain("혼자 책임지려 하지 말고");
    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("함께 전화");
    expect(response).toContain("한국 밖");
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
