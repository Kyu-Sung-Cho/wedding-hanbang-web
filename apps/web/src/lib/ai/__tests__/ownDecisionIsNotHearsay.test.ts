import { describe, expect, it } from "vitest";

import { selectAmoraPendingProposalTools } from "@/lib/ai/amoraToolPolicy";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

/**
 * 자기가 정한 걸 말했는데 아모라가 "남한테 들은 얘기" 로 분류해 아무것도 제안하지
 * 못했다.
 *
 * ## 라이브에서 있었던 일 (2026-08-26)
 *
 *     사용자: "내가 소네 스튜디오에서 9월 5일날 11시에 촬영하기로 했어
 *              가격은 276만원이고 대표님이 해주시는거야"
 *
 *     아모라: (받아 적고, 계약서 확인할 것을 알려주고, 9월 3일 일정과 겹친다고
 *              말한 뒤) "어느 날짜가 최종인지 먼저 정리해야 합니다."
 *
 * 저장 카드가 한 장도 안 나왔다. 원인은 UI 가 아니라 전언(hearsay) 가드였다:
 *
 *     HEARSAY_SOURCE 매치 = 「스튜디오에서」
 *     HEARSAY_ENDING 매치 = 「대」        ← 대표님의 첫 글자
 *
 * `HEARSAY_ENDING` 의 `대|래` 가 경계 없는 한 글자라 `대표님`·`대관료`·`대기실`
 * 안에서도 걸렸다. 걸리면 `selectAmoraPendingProposalTools` 가 **즉시 빈 배열**을
 * 반환하고, 그러면 카드 계약문이 프롬프트에 아예 안 실려 모델은 표식을 낼 방법이
 * 없다. 화면 탓이 아니라 문장 하나의 우연한 두 글자였다.
 *
 * ## 왜 이 검사가 이 모양인가
 *
 * 이 가드가 지키는 것은 "친구가 5천이래" 를 우리 결정으로 저장하지 않는 것이다.
 * 그래서 **넓히는 검사와 지키는 검사를 함께** 둔다 — 아래 두 describe 가 짝이다.
 * 한쪽만 보면 어휘를 넓히다 안전을 깨는 일이 실제로 이 저장소에서 있었다.
 *
 * 여기 쓰는 문장은 내가 지어낸 것이 아니라 **라이브 원문과, 그 원문에서 한 낱말만
 * 바꾼 것들**이다. 내가 고른 쉬운 예시로 재면 실제 경로를 안 밟는다.
 */

const LIVE =
  "내가 소네 스튜디오에서 9월 5일날 11시에 촬영하기로 했어 가격은 276만원이고 대표님이 해주시는거야";

/**
 * 라이브 턴과 같은 조건으로 부른다. `specialistType` 은 이 발화가 실제로 분류되는
 * 값(`general`)을 쓴다 — 조사에서 general/ceremony_coordinator/budget_optimizer
 * 세 경로 모두 같은 결과였다.
 */
const propose = (userText: string) =>
  selectAmoraPendingProposalTools({
    availableTools: WEDDING_TOOLS,
    userText,
    specialistType: "general",
  });

describe("측정기가 살아 있다", () => {
  it("도구 목록이 비어 있지 않다 — 비면 아래 검사가 전부 무의미하다", () => {
    expect(WEDDING_TOOLS.length).toBeGreaterThan(10);
  });

  it("전언은 실제로 막힌다 — 이 가드가 죽어 있으면 아래 통과는 뜻이 없다", () => {
    expect(propose("친구는 총예산 5천만원으로 했대")).toHaveLength(0);
  });
});

describe("자기가 정한 일은 제안까지 간다", () => {
  it("라이브 원문에 제안 도구가 열린다 — 그날은 0개였다", () => {
    const tools = propose(LIVE);
    expect(tools.length, "여전히 0개다 — 카드 계약문이 프롬프트에 안 실린다")
      .toBeGreaterThan(0);
    expect(tools.map((t) => t.name)).toContain("add_schedule_event");
  });

  /**
   * **원문에서 한 곳만 바꾼다.** 처음엔 짧은 문장을 새로 지어 썼는데
   * ("스튜디오에서 대표님이 찍어주시기로 했어") 그건 0개가 나왔다 — 그런데
   * `대표님`→`사장님` 대조군도 똑같이 0개였다. 전언 때문이 아니라 **제안할
   * 내용(날짜·금액)이 없어서** 였다. 내가 지어낸 문장으로 재면 엉뚱한 것을 잰다.
   */
  it.each([
    ["대관료", LIVE.replace("대표님이 해주시는거야", "대관료도 포함이야")],
    ["대기실", LIVE.replace("대표님이 해주시는거야", "대기실도 따로 써")],
    ["플래너(래)", LIVE.replace("소네 스튜디오에서", "플래너 통해서")],
    ["는데", LIVE.replace("했어", "했는데")],
  ])("'%s' 가 들어가도 여전히 제안까지 간다", (_label, text) => {
    expect(propose(text).length, `막힌다: ${text}`).toBeGreaterThan(0);
  });

  it("측정기 대조: 제안 도구가 0개인 게 늘 전언 탓은 아니다", () => {
    // 이 둘은 전언 낱말을 빼도 0개다. 0개를 보면 전언부터 의심하기 전에
    // 대조군을 같은 방법으로 한 번 재야 한다.
    expect(propose("스튜디오에서 대표님이 찍어주시기로 했어")).toHaveLength(0);
    expect(propose("스튜디오에서 사장님이 찍어주시기로 했어")).toHaveLength(0);
  });
});

describe("남에게 들은 말은 그대로 막힌다", () => {
  it.each([
    ["~대", "친구는 총예산 5천만원으로 했대"],
    ["~대 + 마침표", "부모님이 상견례 날짜 정해서 알려주신대. 정해지면 그때 일정 넣을게"],
    ["~래", "블로그 보니까 평균 총예산이 6300만원이래"],
    ["~한대", "동생이 11월 15일에 결혼식 한대"],
    ["~하더라", "언니네 부부는 예산 8천만원 썼다고 하더라"],
    ["~던데", "웨딩홀 상담실장이 요즘 총예산 7천만원은 잡아야 한다던데"],
    ["~다고 하던데", "회사 선배가 작년에 총예산 4천만원 들었다고 하던데"],
    ["~다는데", "친구가 그 스튜디오 요즘 비싸다는데"],
    ["~정했대", "친구는 예식장 아펠가모로 정했대. 거기 어때?"],
  ])("%s 는 여전히 카드를 안 낸다", (_label, text) => {
    expect(propose(text), `전언이 새어 나간다: ${text}`).toHaveLength(0);
  });
});

describe("어미는 절 끝에 와야 한다", () => {
  it("단어 안의 대·래는 전언이 아니다", () => {
    // 이게 이 수정의 전부다. 예전 정규식은 이 둘을 구분하지 못했다.
    const hearsay = "친구가 그 스튜디오 별로래";
    const ownWord = "스튜디오에서 대표님이 해주신대서 계약했어";
    expect(propose(hearsay), "진짜 전언이 통과했다").toHaveLength(0);
    // `해주신대서` 는 `대` 뒤에 `서` 가 붙어 절 끝이 아니지만, 의미상으로는
    // 전언에 가깝다. 지금 규칙은 이걸 통과시킨다 — 알고 남기는 한계다.
    // 남에게 들은 값을 저장하는 최종 방어선은 이 정규식이 아니라 **사용자 확인**이다.
    expect(propose(ownWord).length).toBeGreaterThan(0);
  });

  it("존댓말 어미(대요·래요)도 잡는다", () => {
    expect(propose("친구가 거기 스튜디오 비싸대요")).toHaveLength(0);
    expect(propose("언니가 그 업체 별로래요")).toHaveLength(0);
  });
});
