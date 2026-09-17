import {
  WEDDING_CODE_V06_AXES,
  type WeddingCodeV06Question,
  type WeddingCodeQuestionKey,
} from "./weddingCodeV06";

/**
 * 웨딩코드 v0.7 문항.
 *
 * ## v0.6 → v0.7에서 한 번 잃었던 것
 *
 * v0.6은 재미를 위해 설계됐다 — 「카톡으로 받은 스드메 견적서를 처음 열어본 밤」,
 * 「삼백이면 신혼여행 한 번인데」처럼 **실제로 든 생각**을 그대로 인용했다. 대신 결혼
 * 준비를 안 해본 사람은 못 읽는 업계 용어가 남아 있었다.
 *
 * 그래서 v0.7 초안은 전부 쉬운 말로 다시 썼는데, 그 과정에서 **64개 선택지 중 54개가
 * 「~하고 싶다」·「~면 좋겠다」로 끝났다(84%).** 전부 바르고 신중한 희망 사항이었다.
 * 이건 두 가지를 동시에 망친다.
 *
 * 1. **재미**: 나를 들키는 답이 없으면 캡처해서 보낼 문장이 안 생긴다. 열여섯 번
 *    「무엇을 먼저 확인하고 싶은가」를 묻는 건 퀴즈가 아니라 체크리스트다.
 * 2. **정확도**: 네 선택지가 전부 사회적으로 옳으면 사람들은 자기가 한 일이 아니라
 *    좋아 보이는 답을 고른다. 그 오염된 답이 그대로 아모라 설정 제안이 된다.
 *
 * ## v0.7의 규칙
 *
 * 1. **쉬운 말은 유지한다.** 업계 용어 없이, 금액·개수·시점을 문장 안에 직접 쓴다.
 * 2. **선택지는 희망이 아니라 기록이다.** 실제로 한 말, 속으로 든 생각, 그래서 한 행동.
 *    어미를 「했다·봤다·싶었다·말았다」로 섞어 리듬을 만든다.
 * 3. **문항마다 솔직한 답이 하나 이상**(`candid`). 단 **자책이 아니라 흔한 일**이어야
 *    한다. 「표를 다 보지는 못하고 믿고 맡긴다고 했다」는 고를 수 있지만, 같은 행동을
 *    「솔직히 다 보지도 않고 알아서 하라고 했다」로 쓰면 고르는 순간 잘못을 인정하는
 *    것이 된다. 그러면 사람들은 그 답을 피하고, 축이 그만큼 기운다.
 * 4. **한 문항 = 한 축, 좌 2 : 우 2.** 균등 무작위 응답이 정확히 50:50이 되어 축이
 *    구조적으로 기울지 않는다.
 * 5. 겪지 않은 장면은 「지금이라면 고를 답」을 고르게 하고, **우리와 안 맞는 장면은
 *    건너뛸 수 있다.** 부모님이 안 계시거나 결혼식을 안 하는 사람에게 억지로 답을
 *    고르게 하면 그건 불편할 뿐 아니라 없는 답을 지어내는 것이다.
 *
 * 위 규칙은 전부 `__tests__/weddingCodeV08.test.ts`가 기계로 강제한다. 카피는 손대면
 * 원래대로 밋밋해지기 때문에, 재미를 취향이 아니라 통과 조건으로 고정해 둔다.
 *
 * ## 무엇을 주장하지 않는가
 *
 * 성격을 판정하지 않는다. 유형·점수·궁합·등급을 만들지 않는다. 구성개념 가중치는
 * 어느 차이를 먼저 보여줄지 고르는 내부 정렬과 아모라 도움 방식 **제안**에만 쓴다.
 */
export const WEDDING_CODE_V08_VERSION = "v0.8-code";
export const WEDDING_CODE_V08_AXES = WEDDING_CODE_V06_AXES;

export const WEDDING_CODE_V08_QUESTIONS = [
  // ── 축 1. 정할 때 뭘 먼저 보나 ──────────────────────────────────
  {
    key: "A1",
    axis: "decisionCriteria",
    scene: "사진 촬영 업체가 보낸 총 250만원짜리 견적서를 처음 열어본 밤",
    question: "그 화면에서 제일 먼저 눈이 간 곳은?",
    options: [
      { value: "A", label: "맨 아래 총액부터 보고 숨을 한 번 골랐다", candid: true, weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "포함이라고 적힌 게 진짜 포함인지 하나씩 세어봤다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "금액은 제쳐두고 사진부터 한참 넘겨봤다", candid: true, weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "우리 결혼식이 어떤 하루일지 상상부터 했다", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },
  {
    key: "A2",
    axis: "decisionCriteria",
    scene: "둘 다 마음에 든 결혼식장이 정해둔 예산보다 300만원 비쌌다",
    question: "그날 밤 속으로 든 생각은?",
    options: [
      { value: "A", label: "300만원이면 신혼여행 한 번인데 싶었다", candid: true, weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "여기 아니면 두고두고 아쉬울 것 같았다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "C", label: "다른 데서 300만원을 줄일 수 있는지 계산했다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "그 홀에 서 있는 장면이 계속 떠올랐다", weights: [{ construct: "aestheticMood", value: 2 }] },
    ],
  },
  {
    key: "A3",
    axis: "decisionCriteria",
    scene: "결혼식 당일 영상을 남기려면 150만원이 더 붙는다고 들은 자리",
    question: "그때 실제로 나온 말은?",
    options: [
      { value: "A", label: "나중에 이 영상을 보고 싶어질 것 같았다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "B", label: "다들 한다는데 우리만 없으면 좀 그렇겠다 싶었다", candid: true, weights: [{ construct: "aestheticMood", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "C", label: "빼면 정확히 뭐가 없어지는지 물었다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "사진으로 충분하면 150만원을 아끼자고 말했다", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A4",
    axis: "decisionCriteria",
    scene: "사진은 마음에 드는데 이용 후기가 3개뿐인 촬영 업체를 찾았다",
    question: "후보에 남길지 정하면서 실제로 한 행동은?",
    options: [
      { value: "A", label: "후기가 적어도 사진이 좋으면 됐다고 봤다", candid: true, weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "B", label: "후기를 쓴 사람이 진짜 고객인지 찾아봤다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "질문에 성의껏 답해주는 걸 보고 마음이 놓였다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "D", label: "취소하면 얼마를 돌려받는지부터 확인했다", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A5",
    axis: "decisionCriteria",
    scene: "결혼식장에서 밥값이 1인당 7만원이고 최소 인원이 있다고 들었다",
    question: "그 설명을 듣고 머릿속에 먼저 온 건?",
    options: [
      { value: "A", label: "밥값만 더해도 예산이 넘어서 말이 막혔다", candid: true, weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "최소 인원과 추가 요금이 계약서에 있는지 봤다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "차려진 상 사진부터 찾아봤다", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "와주는 사람들이 잘 먹고 갔으면 했다", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },

  // ── 축 2. 준비를 어떻게 나누나 ──────────────────────────────────
  {
    key: "B1",
    axis: "preparationMode",
    scene: "한 사람이 결혼식장 후보 10곳을 표로 정리해서 보냈다",
    question: "그 표를 받고 한 답은?",
    options: [
      { value: "A", label: "10곳을 처음부터 같이 보자고 답했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "각자 고른 뒤 겹치는 곳을 보자고 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "정리한 사람이 3곳으로 줄여달라고 했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "표를 다 보지는 못하고 믿고 맡긴다고 했다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B2",
    axis: "preparationMode",
    scene: "사진 촬영·입을 옷·결혼식장 준비가 한꺼번에 밀린 주",
    question: "그래서 실제로 굴러간 방식은?",
    options: [
      { value: "A", label: "각자 한 분야씩 맡아 끝까지 책임지기로 했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "매주 앉아서 남은 일을 하나씩 정하기로 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "시간 나는 사람이 먼저 정하고 나중에 알려줬다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "중요한 결정은 늦어져도 같이 보기로 했다", weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B3",
    axis: "preparationMode",
    scene: "한 사람은 입을 옷을, 다른 한 사람은 결혼식장을 3주 동안 따로 알아봤다",
    question: "최종 결정 전에 두 사람이 정한 것은?",
    options: [
      { value: "A", label: "각자 맡은 데서 추천안을 정해 오기로 했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "맡은 사람 판단을 믿고 결과만 들었다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "두 분야 다 최종 후보는 같이 보기로 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "각자 알아본 걸 설명하다 시간이 다 갔다", candid: true, weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B4",
    axis: "preparationMode",
    scene: "둘이 모은 결혼식장 후보가 20곳이 되어 고르기 어려워졌다",
    question: "후보를 줄이면서 한 말은?",
    options: [
      { value: "A", label: "같이 기준을 정하고 한 번에 줄이자고 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "한 사람이 조건에 맞는 3곳만 남겨오기로 했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "각자 3곳씩 고른 뒤 겹치는 곳을 봤다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "고르는 게 힘들어서 정해달라고 했다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B5",
    axis: "preparationMode",
    scene: "결혼식장에서 평일 낮에 전화가 오는데 둘 다 회사에 있다",
    question: "그 연락은 어떻게 하고 있나?",
    options: [
      { value: "A", label: "둘 다 못 받아서 답이 며칠씩 밀렸다", candid: true, weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "한 사람이 연락 창구를 맡기로 했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "받은 사람이 그날 저녁에 내용을 공유했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "그 분야 담당이 정하고 결과만 알려줬다", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },

  // ── 축 3. 누구까지 넣고 정하나 ──────────────────────────────────
  {
    key: "C1",
    axis: "coordinationScope",
    scene: "둘이 고른 결혼식장을 부모님이 보시고 음식과 주차를 걱정하셨다",
    question: "그 자리에서 한 행동은?",
    options: [
      { value: "A", label: "이미 확인한 부분이라고 말씀드렸다", candid: true, weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "우리가 왜 여기를 골랐는지 이유를 설명했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "걱정하신 부분을 결혼식장에 다시 물어봤다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "하객이 불편하겠다 싶어 다른 곳도 다시 봤다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C2",
    axis: "coordinationScope",
    scene: "부모님은 결혼식 뒤 한복을 입고 어른들께 절하는 순서를 원하시고, 둘은 하고 싶지 않다",
    question: "그래서 먼저 한 일은?",
    options: [
      { value: "A", label: "우리 결혼식이니 안 하겠다고 먼저 말했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "부모님께 왜 중요한지부터 들어봤다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "안 하려는 이유를 정리해서 같이 설명했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "그렇게까지 원하시면 하자는 쪽으로 기울었다", candid: true, weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C3",
    axis: "coordinationScope",
    scene: "부모님이 부르고 싶어 하시는 사람을 더하면 예상 인원보다 50명이 늘어난다",
    question: "명단을 정하면서 실제로 한 선택은?",
    options: [
      { value: "A", label: "부모님 관계도 있으니 최대한 넣기로 했다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "꼭 필요하다고 하신 분들은 자리를 마련했다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "우리가 직접 아는 사람 위주로 정했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "감당할 수 있는 인원이 아니라고 말씀드렸다", candid: true, weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C4",
    axis: "coordinationScope",
    scene: "결혼을 앞두고 부모님들이 식당에서 처음 만날 날짜가 3번 바뀌었다",
    question: "네 번째 날짜를 정할 때 한 일은?",
    options: [
      { value: "A", label: "부모님들 되시는 날에 우리 일정을 맞췄다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "우리가 되는 날 두세 개를 먼저 정했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "양쪽에서 되는 날을 다 받아 겹치는 날을 찾았다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "더 바꾸기는 어렵다고 날짜를 정해 말씀드렸다", candid: true, weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C5",
    axis: "coordinationScope",
    scene: "부모님이 결혼식 비용을 보태주시겠다고 먼저 말씀하셨다",
    question: "그 말을 듣고 둘이 세운 기준은?",
    options: [
      { value: "A", label: "보태주셔도 결정은 우리가 하기로 했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "받는 만큼 의견도 따라온다고 생각했다", candid: true, weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "받을 금액과 쓸 곳을 우리가 먼저 정리했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "어디에 쓰면 좋을지 부모님 뜻을 여쭸다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },

  // ── 축 4. 힘들 때 뭐부터 하나 ──────────────────────────────────
  {
    key: "D1",
    axis: "supportOrder",
    scene: "결혼 준비가 힘들다고 말했는데 상대가 곧바로 해결 방법부터 말했다",
    question: "그때 속으로 바란 것은?",
    options: [
      { value: "A", label: "뭐가 제일 힘들었는지 물어봐 주길 바랐다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "더 말해도 안 통할 것 같아 그만뒀다", candid: true, weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "당장 줄일 일을 같이 골라주길 바랐다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "누가 뭘 맡을지 그 자리에서 정하고 싶었다", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
  {
    key: "D2",
    axis: "supportOrder",
    scene: "결혼 준비 이야기를 꺼내면 10분 안에 둘 다 지쳐서 대화가 멈춘다",
    question: "다시 이야기를 시작할 때 편했던 방식은?",
    options: [
      { value: "A", label: "오늘 정할 한 가지만 놓고 시작하기로 했다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "각자 힘든 점 하나씩만 말하기로 했다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "남은 일을 잘게 쪼개 하나만 끝내기로 했다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "결론 없이 서로 힘든 얘기만 하다 끝난 날도 있다", candid: true, weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D3",
    axis: "supportOrder",
    scene: "상대가 계약서를 한참 읽다가 어디부터 봐야 할지 모르겠다고 말했다",
    question: "내가 먼저 한 것은?",
    options: [
      { value: "A", label: "이해 안 되는 부분을 같이 찾아 읽었다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "중요한 내용만 뽑아서 표로 정리해줬다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "어디가 걱정되는지 먼저 물어봤다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "뭘 물어야 할지 몰라 옆에 있어 주기만 했다", candid: true, weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D4",
    axis: "supportOrder",
    scene: "오늘 계약하면 30만원을 깎아준다는 말에 둘 다 마음이 급해졌다",
    question: "그 자리에서 상대에게 한 것은?",
    options: [
      { value: "A", label: "오늘 안 정해도 괜찮다고 먼저 말해줬다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "밖에 나가서 조건을 종이에 적어봤다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "지금 기분이 어떤지 조용히 물어봤다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "깎아준다는 말에 그 자리에서 계약할 뻔했다", candid: true, weights: [{ construct: "executionSupport", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
  {
    key: "D5",
    axis: "supportOrder",
    scene: "야근하고 밤 11시에 결혼 준비 이야기가 시작됐다",
    question: "그 시간에 내가 먼저 꺼낸 쪽은?",
    options: [
      { value: "A", label: "오늘 많이 힘들었겠다고 말해줬다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "할 일만 정하고 대화를 짧게 끝냈다", candid: true, weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "결혼 준비 말고 회사 이야기를 먼저 들었다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "내일 할 일 하나를 정하고 마무리했다", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV06Question[];

export const WEDDING_CODE_V08_NEXT_STEPS = {
  A1: "각자 먼저 확인할 항목을 하나씩 고른 뒤, 최종 금액·받는 사진 수·보정 사진 수·앨범에 들어가는 사진 수·취소 조건을 견적서에서 같은 순서로 확인해 보세요.",
  A2: "둘이 넘지 않을 최대 금액을 먼저 정하고, 300만원을 더 쓸 경우 줄일 항목과 같은 조건의 다른 결혼식장 한 곳을 함께 비교해 보세요.",
  A3: "영상을 얼마나 다시 볼지 각자 말한 뒤, 촬영 시간·받는 영상 종류·편집 횟수·전달 날짜·취소 조건을 서면으로 확인해 보세요.",
  A4: "사진 취향과 계약 안전을 따로 확인하세요. 전체 작업 사례·실제 고객 후기·계약 취소 시 환불액을 보고 다른 업체 한 곳과 비교해 보세요.",
  A5: "예상 인원을 각자 숫자로 적어 겹치는 범위를 먼저 정하고, 그 인원으로 계산한 총액과 최소 인원 조건을 같이 확인해 보세요.",
  B1: "10곳을 모두 보내기 전에 누가 3곳으로 줄일지 정하고, 둘이 함께 볼 기준 두 가지와 최종 결정자를 미리 합의해 보세요.",
  B2: "남은 일을 적은 뒤 조사 담당·후보 정리 담당·최종 확인 담당을 나누고, 둘이 함께 결정할 일에는 따로 표시해 보세요.",
  B3: "각 담당자가 후보 두 개와 추천 이유를 준비하고, 다른 사람은 반대할 수 있는 기준을 하나씩 말한 뒤 최종 선택은 함께 확인해 보세요.",
  B4: "먼저 탈락 기준 세 가지를 함께 정한 뒤 각자 3곳을 고르세요. 겹치는 곳과 서로 꼭 남기고 싶은 한 곳만 다음 비교 대상으로 두면 됩니다.",
  B5: "평일 낮 연락을 받을 사람과 답을 미뤄도 되는 시간을 정하고, 금액과 계약이 걸린 연락만 둘이 함께 확인하기로 나눠 보세요.",
  C1: "둘이 포기하지 않을 조건과 부모님이 걱정한 음식·주차 조건을 나눠 적고, 결혼식장에 확인한 사실을 본 뒤 최종 결정 범위를 정해 보세요.",
  C2: "두 사람과 부모님에게 이 순서가 왜 중요한지 각각 들은 뒤, 생략·축소·대체 중 가능한 방법과 부모님께 설명할 사람을 정해 보세요.",
  C3: "전체 하객 수와 감당할 예산의 상한을 먼저 정하고, 두 사람이 초대할 인원과 각 부모님이 초대할 인원을 숫자로 나눈 뒤 꼭 필요한 명단부터 채워 보세요.",
  C4: "둘이 불가능한 날짜를 먼저 빼고 가능한 날짜 2~3개를 만든 뒤, 양쪽 부모님께 같은 날짜까지 답을 받아 겹치는 날로 정해 보세요.",
  C5: "보태주시는 금액과 그 돈이 들어갈 항목을 먼저 적은 뒤, 그 항목에서 의견을 어디까지 반영할지 부모님과 함께 확인해 보세요.",
  D1: "해결 방법을 말하기 전에 \"지금은 들어주는 것과 같이 해결하는 것 중 뭐가 필요해?\"라고 묻고, 답에 맞춰 5분만 먼저 들어보세요.",
  D2: "대화를 15분으로 정하고 각자 힘든 점 한 가지를 말한 뒤, 오늘 정할 일은 하나만 고르세요. 시간이 끝나면 남은 결정은 다음으로 넘겨도 됩니다.",
  D3: "먼저 어떤 조항이 걱정되는지 묻고 표시한 뒤, 이해되지 않는 내용은 업체에 서면으로 질문하세요. 답을 받기 전에는 계약 완료로 넘기지 마세요.",
  D4: "상담 자리에서 잠시 나온 뒤 총금액·추가 비용·취소 조건·할인 기한을 적으세요. 할인 없이도 계약할지 각자 답한 뒤 결정해 보세요.",
  D5: "지친 밤에는 대화 시간을 먼저 정하고, 오늘 서로 어땠는지 한 줄씩 말한 뒤 정할 일 하나만 고르세요. 남은 일은 다음으로 미뤄도 됩니다.",
} as const satisfies Readonly<Record<WeddingCodeQuestionKey, string>>;
