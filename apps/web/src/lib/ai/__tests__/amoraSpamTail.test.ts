import { describe, expect, it } from "vitest";

import { stripAmoraSpamTail } from "@/lib/ai/amoraSpamTail";

/**
 * 2026-08-25 운영에서 아모라가 예산 요약 끝에 업소 광고 문구를 붙여 내보냈다.
 * 도구 결과에도 커플 데이터에도 없던 말이라 모델이 만든 꼬리 아티팩트다.
 *
 * 운영 답변 625건 중 1건(0.16%). 팀원들이 각자 수십 턴을 눌러보는 베타에서는
 * 누군가 한 번은 본다.
 */

// 운영 DB에서 그대로 가져온 실제 사고 문자열의 마지막 두 줄.
const REAL_INCIDENT = `- 아직 쓰임을 정하지 않은 금액: **2,690만 원**
- 기록된 지출: **0원**출장안마`;

describe("답변 꼬리에 붙는 스팸", () => {
  it("실제로 나갔던 그 문장을 잘라낸다", () => {
    const cleaned = stripAmoraSpamTail(REAL_INCIDENT);
    expect(cleaned).not.toContain("출장안마");
    expect(cleaned).toBe(`- 아직 쓰임을 정하지 않은 금액: **2,690만 원**
- 기록된 지출: **0원**`);
  });

  it.each([
    // '건마' 는 없다. '5건마다'·'사건마다' 같은 평범한 문장에 걸려서 뺐다
    // (아래 오탐 검사가 그 자리를 지킨다).
    "출장안마", "출장 안마", "출장마사지", "안마방", "립카페",
    "풀싸롱", "룸살롱", "성인용품", "비아그라", "시알리스",
    "토토사이트", "먹튀검증", "바카라사이트", "밤알바", "조건만남",
  ])("꼬리에 붙은 '%s' 를 잘라낸다", (term) => {
    const out = stripAmoraSpamTail(`예산은 6,200만 원이에요.${term}`);
    expect(out).toBe("예산은 6,200만 원이에요.");
  });

  it("뒤에 문장부호가 더 붙어 있어도 잘라낸다", () => {
    expect(stripAmoraSpamTail("확인해 보세요.출장안마 !!")).toBe("확인해 보세요.");
  });

  /**
   * 여기가 이 파일의 핵심이다.
   *
   * 처음 만든 검출기는 "굵게 닫힘 뒤에 공백 없이 붙은 한글" 이라는 구조
   * 규칙이었다. 운영 코퍼스 625건에서 오탐 0건이 나와 통과시킬 뻔했는데,
   * 아모라가 실제로 쓰는 문장 끝을 대보니 **7개 중 7개**를 잘라냈다.
   * 코퍼스에 그 형태가 1건뿐이라 0오탐이 나온 것이었다.
   */
  it.each([
    "현재 저장된 총예산은 **6,200만 원**이에요",
    "계약서에 포함 항목이 적혀 있는지 **꼭 확인**하세요",
    "지금 가장 중요한 건 **날짜**예요",
    "먼저 **결혼식장**부터",
    "남은 금액은 **2,690만 원**입니다",
    "예식은 **2027년 5월 15일**이고",
    "하객은 **200명**이라고",
  ])("정상 문장 '%s' 는 건드리지 않는다", (line) => {
    expect(stripAmoraSpamTail(line)).toBe(line);
  });

  it("문장 안에 자연스럽게 쓰인 말은 자르지 않는다", () => {
    // 꼬리 규칙이라 본문은 지나간다. 알고 남겨둔 한계다.
    const body = "신혼여행 호텔에서 마사지를 예약할 수 있는지 물어보세요.";
    expect(stripAmoraSpamTail(body)).toBe(body);
  });

  /**
   * 이 검사는 **문장 끝**에 둬야 뜻이 있다.
   *
   * 처음엔 같은 말을 문장 한가운데 넣어 뒀는데, 꼬리 규칙은 본문을 보지
   * 않으니 어휘 목록에 `마사지`·`카지노`를 집어넣어도 32개 테스트가 전부
   * 통과했다. 지키는 척만 하는 검사였다.
   *
   * 아래는 전부 그 말로 끝난다. 어휘가 넓어지면 여기서 죽는다.
   */
  it.each([
    "마카오에서 두 분이 가 볼 만한 곳은 카지노",
    "예식 전날 받아두면 좋은 건 마사지",
    "예산 항목으로 따로 잡을 수 있는 건 유흥비",
    "일정을 먼저 맞춰야 하는 쪽은 출장",
    "드레스 투어와 함께 잡으면 좋은 건 스파",
  ])("정당하게 쓰일 수 있는 말로 끝나면 건드리지 않는다: '%s'", (line) => {
    expect(stripAmoraSpamTail(line)).toBe(line);
  });

  /**
   * 아래 다섯은 적대적 검토가 첫 판을 부수며 찾아낸 것들이다.
   * 33개가 전부 초록이던 시점에 전부 실패하던 자리다.
   */
  it("다른 낱말의 일부는 자르지 않는다 — '드립카페'", () => {
    // 첫 판은 부분 문자열로 매치해 '드' 한 글자만 남겼다.
    const line = "근처에서 마시기 좋은 곳은 드립카페";
    expect(stripAmoraSpamTail(line)).toBe(line);
  });

  it.each([
    "확인은 5건마다 하세요",
    "사건마다 조건이 달라요",
    "물건마다 가격이 달라요",
  ])("숫자·한글 뒤의 짧은 어휘를 오탐하지 않는다: '%s'", (line) => {
    // '건마' 는 이 이유로 어휘 목록에서 아예 뺐다.
    expect(stripAmoraSpamTail(line)).toBe(line);
  });

  it("스팸 뒤에 전화번호가 붙어도 잘라낸다", () => {
    // 첫 판은 문장부호만 허용해서, **실제로 클릭을 유도하는 형태**가 살아남았다.
    expect(stripAmoraSpamTail("예산은 6,200만 원이에요.출장안마 010-1234-5678"))
      .toBe("예산은 6,200만 원이에요.");
  });

  it("스팸 뒤에 주소나 링크가 붙어도 잘라낸다", () => {
    expect(stripAmoraSpamTail("확인해 보세요.성인용품 서울강남 https://x.example"))
      .toBe("확인해 보세요.");
  });

  it("같은 어휘가 두 번 붙어도 하나도 남기지 않는다", () => {
    // 첫 판은 문자열 끝 앵커라 마지막 것만 잘라 하나가 살아남았다.
    expect(stripAmoraSpamTail("정리했어요.출장안마 출장안마")).toBe("정리했어요.");
  });

  it("본문 한가운데는 자르지 않는다", () => {
    // 뒤에 80자를 넘게 남으면 꼬리가 아니라 본문이다.
    const line = "출장안마 라는 말이 왜 검색어에 뜨는지는 저도 모르겠지만, 결혼 준비와는 관계가 없으니 예산 이야기로 돌아갈게요. 지금 배정된 금액부터 같이 볼까요?";
    expect(stripAmoraSpamTail(line)).toBe(line);
  });

  it("답변이 통째로 스팸이면 빈 답을 만들지 않는다", () => {
    expect(stripAmoraSpamTail("출장안마")).toBe("출장안마");
  });

  /**
   * **가드가 어느 자리에 걸려 있는지가 어휘보다 중요했다.**
   *
   * 첫 판은 모델 원문에 바로 걸었다. 그런데 아모라는 저장을 제안하는 턴에서
   * 답변 끝에 `[pending_action]`·`[suggestions]` 블록을 붙인다. 그러면 스팸은
   * 문자열 끝이 아니라 그 블록 **앞**에 놓여 규칙을 통째로 비껴간다 —
   * 하필 예산·일정 저장 제안 턴이 그 모양이고, 사고가 난 턴도 예산이었다.
   *
   * 그래서 지금은 표식을 다 걷어낸 뒤(`providerCleanText`)에 건다.
   * 아래는 그 순서를 흉내 내 확인한다.
   */
  it("표식이 뒤에 붙은 원문도 표식 제거 뒤에는 잘린다", () => {
    const raw = "예산은 6,200만 원이에요.출장안마";
    const withMarkers = raw
      + '[pending_action]{"tool":"update_budget","input":{"budget":62000000}}[/pending_action]'
      + "[suggestions]항목별로 나눠볼까요?[/suggestions]";

    // 원문에 그대로 걸면 아무것도 못 자른다 — 첫 판이 이랬다.
    expect(stripAmoraSpamTail(withMarkers)).toBe(withMarkers);

    // 운영 순서대로 표식을 먼저 걷어내면 잘린다.
    const afterMarkers = withMarkers
      .replace(/[pending_action][sS]*?[/pending_action]/g, "")
      .replace(/[suggestions][sS]*?[/suggestions]/g, "");
    expect(stripAmoraSpamTail(afterMarkers)).toBe("예산은 6,200만 원이에요.");
  });

  it("빈 값과 비문자열을 그대로 돌려준다", () => {
    expect(stripAmoraSpamTail("")).toBe("");
    expect(stripAmoraSpamTail(null as never)).toBe(null);
  });
});
