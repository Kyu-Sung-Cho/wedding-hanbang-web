import {
  WEDDING_CODE_V06_AXES,
  type WeddingCodeV06Question,
  type WeddingCodeQuestionKey,
} from "./weddingCodeV06";

/**
 * 웨딩코드 v0.9 문항.
 *
 * ## v0.8 → v0.9 (2026-09-17) — 왜 판을 올렸나
 *
 * 팀원이 라이브 v0.8 을 끝까지 풀어보고 피드백을 줬다. 요지는 넷이다.
 *
 * 1. **동시에 고를 수 있는 선택지.** 「밀린 주에 굴러간 방식」의 네 답은 전부 방침이라
 *    한꺼번에 참일 수 있었고, 300만원 비싼 식장 앞에서 든 생각 세 개는 모두 「아쉬움」의
 *    정도 차이였다.
 * 2. **뻔한 정답.** 「양쪽에서 되는 날을 다 받아 겹치는 날을 찾았다」는 누구나 고를 답이었다.
 * 3. **처음 보는 사람이 모르는 상황.** 「포함이라고 적힌 게 진짜 포함인지」는 견적서를 본
 *    적 없는 사람에게 그림이 안 그려졌다. 「300만원이면 신혼여행 한 번」은 틀린 숫자였다.
 * 4. **AI 가 쓴 것 같은 말투.** 「그 시간에 내가 먼저 꺼낸 쪽은?」처럼 질문과 답이 문장으로
 *    이어지지 않고, 「~한 것은?」 「~한 방식은?」이 스무 번 되풀이됐다.
 *
 * 고치면 선택지의 **뜻**이 바뀐다. 같은 `v0.8-code` 로 문장만 바꾸면 이미 보낸 링크가
 * 상대가 고르지도 않은 문장을 인용하고, 연구 기여 답도 두 문구가 한 판으로 섞인다.
 * 그래서 판을 올렸고, v0.8 은 그 판으로 만든 링크를 열 때만 쓴다(`scene/config.ts`).
 *
 * ## 어떻게 썼나
 *
 * 관점이 다른 초안 세 벌(최소 수정 · 결혼 준비를 안 해본 사람 · 실제 커플 대화)을 쓰고,
 * 렌즈 셋(하나만 고를 수 있나·신호가 맞나 / 처음 보는 사람이 알아듣나·현실적인가 /
 * 사람 말투인가·뻔한 정답이 없나)으로 문항마다 골랐다. 합친 뒤 처음 보는 독자 셋
 * (준비를 안 해본 28살 · 식 6개월 전 32살 · AI 글에 예민한 34살)이 두 번 읽고, 걸린
 * 곳을 고쳤다.
 *
 * - **질문이 하나를 고르게 만든다**: 「보자마자」 「첫 카톡은」 「월요일 밤, 제일 먼저」
 *   「결국」 — 그 순간의 첫 행동이나 결과를 묻는다.
 * - **모든 선택지가 대가를 치른다**: 부모님 첫 식사와 우리 여행이 겹치면 수수료를
 *   내든, 식사를 미루든, 여행을 줄이든 무언가를 내준다.
 * - **장면이 문제를 품는다**: 「원본 파일 30만원 별도」, 「덜 와도 200명분은 내야 한단다」.
 * - **숫자가 서로 맞는다**: 1인 7만원 → 200명 1,400만원, 50명 350만원, 40명 약 300만원.
 * - 업계 말(스드메·예식장·폐백·상견례·양가)은 여전히 쓰지 않는다.
 *
 * 구조 규칙(한 문항 = 한 축, 좌 2 : 우 2, 네 가지 배치 패턴, 축마다 양쪽에 솔직한 답,
 * 희망형 어미 40% 이하)은 v0.8 과 같고 `__tests__/weddingCodeV09.test.ts` 가 강제한다.
 * 규칙이 왜 생겼는지는 `weddingCodeV08.ts` 머리 주석에 있다.
 *
 * ## 무엇을 주장하지 않는가
 *
 * 성격을 판정하지 않는다. 유형·점수·궁합·등급을 만들지 않는다. 구성개념 가중치는
 * 어느 차이를 먼저 보여줄지 고르는 내부 정렬과 아모라 도움 방식 **제안**에만 쓴다.
 */
export const WEDDING_CODE_V09_VERSION = "v0.9-code";
export const WEDDING_CODE_V09_AXES = WEDDING_CODE_V06_AXES;

export const WEDDING_CODE_V09_QUESTIONS = [
  // ── 축 1. 정할 때 뭘 먼저 보나 ───────────────────────────
  {
    key: "A1",
    axis: "decisionCriteria",
    scene: "사진 촬영 견적서가 왔다. 총 250만원, 맨 아래엔 '원본 사진 파일 30만원 별도'",
    question: "견적서를 보자마자 어땠어요?",
    options: [
      { value: "A", label: "총액 250만원을 보고 멈칫했다", candid: true, weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "'별도'라고 적힌 줄이 더 있는지 끝까지 훑었다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "같이 온 예시 사진부터 한참 넘겨봤다", candid: true, weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "사진은 평생 남으니 금액은 나중에 보기로 했다", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },
  {
    key: "A2",
    axis: "decisionCriteria",
    scene: "둘 다 마음에 든 결혼식장이 정해둔 예산보다 300만원 비쌌다",
    question: "그날 밤 상대에게 보낸 첫 카톡은?",
    options: [
      { value: "A", label: "'300만원이면 하객 40명 밥값이야'라고 보냈다", candid: true, weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "'한 번뿐인 날인데 여기서 하자'고 했다", candid: true, weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "C", label: "300만원 차이가 어디서 나는지 물어보자고 썼다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "'여기 봐' 하고 그 홀 사진 한 장만 보냈다", weights: [{ construct: "aestheticMood", value: 2 }] },
    ],
  },
  {
    key: "A3",
    axis: "decisionCriteria",
    scene: "직원이 '요즘 다들 넣어요'라며 150만원짜리 결혼식 영상 촬영을 권했다",
    question: "듣자마자 나온 말은?",
    options: [
      { value: "A", label: "'10년 뒤에 이날을 다시 보고 싶어'라고 말했다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "B", label: "예시 영상이 예뻐서 그 자리에서 넣자고 했다", candid: true, weights: [{ construct: "aestheticMood", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "C", label: "'진짜요? 열 쌍 중에 몇 쌍이나 넣어요?'라고 되물었다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "사진으로 충분하면 150만원은 아끼자고 했다", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A4",
    axis: "decisionCriteria",
    scene: "사진이 마음에 쏙 드는 촬영 업체인데 후기가 3개뿐이고, 예약금은 내일까지다",
    question: "그날 밤, 뭐부터 했어요?",
    options: [
      { value: "A", label: "사진이 이 정도면 됐다 싶어 예약금부터 보냈다", candid: true, weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "B", label: "후기 쓴 사람들 계정을 찾아 진짜 고객인지 봤다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "사진 찍는 모습을 담은 영상을 보고 우리도 편하게 웃을 수 있을지 생각했다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "D", label: "예약금을 못 돌려받는 경우부터 찾아봤다", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A5",
    axis: "decisionCriteria",
    scene: "결혼식장 밥값이 1인당 7만원, 하객이 덜 와도 200명분은 내야 한단다",
    question: "그 말을 듣고 제일 먼저 든 생각은?",
    options: [
      { value: "A", label: "계산해 보니 밥값만 1,400만원이라 말문이 막혔다", candid: true, weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "계약서에도 정말 200명분이라고 적혀 있는지 궁금했다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "덜 오면 넓은 홀이 휑해 보이겠다는 생각이 들었다", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "하객 200명 앞에서 둘이 입장하는 걸 떠올리니 괜히 설렜다", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },
  // ── 축 2. 준비를 어떻게 나누나 ────────────────────────────
  {
    key: "B1",
    axis: "preparationMode",
    scene: "상대가 결혼식장 후보 10곳을 표로 정리해서 카톡으로 보냈다",
    question: "표를 받은 날, 내 답장은?",
    options: [
      { value: "A", label: "주말에 10곳을 같이 보면서 줄이자고 답했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "나도 3곳 골라 볼 테니 겹치는 데를 보자고 보냈다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "'후보는 네가 줄여줘, 가서 볼 날은 내가 잡을게'라고 썼다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "표를 다 못 읽고 '고르는 건 네가 맡아 줘'라고 했다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B2",
    axis: "preparationMode",
    scene: "이번 주 안에 결혼식장 계약도 하고 사진 촬영 업체도 정해야 한다",
    question: "월요일 밤, 제일 먼저 뭘 했어요?",
    options: [
      { value: "A", label: "촬영 업체는 네가, 계약은 내가 맡자고 했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "퇴근하자마자 둘이 새벽 1시까지 촬영 업체 사진을 넘겨봤다", candid: true, weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "시간 되는 내가 둘 다 맡겠다며 상담 예약부터 잡았다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "계약하러 같이 갈 날부터 맞추자며 달력을 열었다", weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B3",
    axis: "preparationMode",
    scene: "3주 동안 혼자 신혼여행지를 알아본 상대가 마지막 두 곳에서 못 고르고 있다",
    question: "고민하는 상대에게 내가 한 말은?",
    options: [
      { value: "A", label: "3주 본 네가 제일 잘 아니까 직접 고르라고 답했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "그럼 내가 한 곳 골라 예약까지 하겠다고 나섰다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "주말까지 미루고 두 곳만 놓고 같이 따져 보자고 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "'다른 후보도 다 보여줘' 했다가 밤이 다 갔다", candid: true, weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B4",
    axis: "preparationMode",
    scene: "신혼여행 비행기표 값이 매일 올라서 이번 주 안에 사야 한다",
    question: "결국 표는 어떻게 샀어요?",
    options: [
      { value: "A", label: "주말에 둘이 한 화면을 보며 처음부터 같이 골랐다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "여행을 더 잘 아는 상대에게 맡기고 나는 결과만 들었다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "각자 찾은 표를 카톡에 올려 놓고 같이 비교했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "내가 맡겠다고 하고 싼 표가 뜨자마자 결제했다", candid: true, weights: [{ construct: "roleOwnership", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
  {
    key: "B5",
    axis: "preparationMode",
    scene: "근무 중에 결혼식장에서 '임시로 잡아둔 날짜를 오늘 확정해 달라'는 전화가 왔다",
    question: "그 전화, 어떻게 했어요?",
    options: [
      { value: "A", label: "둘이 얘기해 봐야 한다며 답을 내일로 미뤘다", candid: true, weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "원래 보던 날짜라 그 자리에서 내가 확정했다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "잠깐 기다려 달라 하고 회의 중인 상대를 불러내 같이 정했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "결혼식장 일은 상대 담당이라 상대 번호를 알려드렸다", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  // ── 축 3. 누구까지 넣고 정하나 ────────────────────────────
  {
    key: "C1",
    axis: "coordinationScope",
    scene: "둘이 오늘 계약하려던 결혼식장을 보신 부모님이 주차가 좁다고 걱정하셨다",
    question: "그래서 계약은요?",
    options: [
      { value: "A", label: "우리한텐 다른 게 더 중요하다고 말씀드리고 그대로 계약했다", candid: true, weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "주차는 둘이서만 다시 알아보고 오늘 서명했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "계약을 미루고 부모님과 한 번 더 같이 가 봤다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "주차가 넓은 두 번째 후보로 그 자리에서 바꿨다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C2",
    axis: "coordinationScope",
    scene: "부모님은 결혼식 끝나고 한복 입고 어른께 절하는 순서를 원하시는데, 둘은 내키지 않는다",
    question: "그 자리에서 어떻게 대답했어요?",
    options: [
      { value: "A", label: "우리 결혼식이니 안 하겠다고 분명히 말씀드렸다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "서운해하실까 봐 대답 대신 웃고 넘어갔다", candid: true, weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "절하는 대신 우리가 원하는 다른 순서를 넣자고 말씀드렸다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "그렇게 원하시면 짧게라도 하겠다고 했다", candid: true, weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C3",
    axis: "coordinationScope",
    scene: "부모님이 부를 분들을 더하니 하객이 50명 늘었다. 밥값만 350만원이 더 든다",
    question: "이 50명, 다 모시기로 했어요?",
    options: [
      { value: "A", label: "부모님 명단은 그대로 두고 우리 예산을 다시 짰다", candid: true, weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "밥값은 부모님이 그분들 축의금으로 내시기로 하고 다 모셨다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "우리가 얼굴을 아는 분 위주로 명단을 다시 추렸다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "50명은 무리라고 부모님께 바로 말씀드렸다", candid: true, weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C4",
    axis: "coordinationScope",
    scene: "양쪽 부모님 첫 식사 자리가 3번 밀렸다. 두 집 다 되는 주말은 우리 여행 때뿐이다",
    question: "결국 어떻게 했어요?",
    options: [
      { value: "A", label: "취소 수수료를 내고 여행을 미뤄 그 주말에 식사를 잡았다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "식사를 한 달 뒤로 미루고 여행은 그대로 갔다", candid: true, weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "여행을 하루 줄여 식사 시간에 맞춰 돌아왔다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "여행은 가야 해서 식사를 평일 저녁으로 당겨 달라고 부탁드렸다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C5",
    axis: "coordinationScope",
    scene: "부모님이 결혼 비용에 1,000만원을 보태주시겠다고 먼저 말씀하셨다",
    question: "고맙다고 말씀드린 다음엔 뭐라고 했어요?",
    options: [
      { value: "A", label: "쓰는 곳은 저희가 정해서 말씀드리겠다고 했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "'그럼 두 분 손님도 넉넉히 모실게요'라고 했다", candid: true, weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "'마음만 받고 저희 돈으로 해볼게요'라고 사양했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "어디에 쓸지는 두 분 뜻을 따르겠다고 했다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  // ── 축 4. 힘들 때 뭐부터 하나 ────────────────────────────
  {
    key: "D1",
    axis: "supportOrder",
    scene: "하객 명단 정리가 버겁다고 했더니 상대가 바로 엑셀 양식을 보내왔다",
    question: "파일을 받고 뭐라고 답했어요?",
    options: [
      { value: "A", label: "고맙다고만 보내고 속으로는 조금 서운했다", candid: true, weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "'엑셀 말고 내 얘기 좀 들어줘'라고 보냈다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "좋다고 답하고 바로 파일을 열어 이름을 채웠다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "'이번 주엔 각자 회사 사람만 채우자'고 답했다", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
  {
    key: "D2",
    axis: "supportOrder",
    scene: "어젯밤에도 결혼 준비 얘기를 꺼내자 10분 만에 둘 다 말이 짧아졌다",
    question: "오늘 저녁엔 뭘로 시작했어요?",
    options: [
      { value: "A", label: "오늘은 청첩장 문구 하나만 정하자고 했다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "어제 서로 날이 서 있었다고 먼저 말을 꺼냈다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "인사만 하고 남은 일을 적은 메모부터 내밀었다", candid: true, weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "준비 얘기는 꺼내지 않고 산책만 하고 들어왔다", candid: true, weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D3",
    axis: "supportOrder",
    scene: "빽빽한 결혼식장 계약서를 한참 읽던 상대가 '뭐가 뭔지 모르겠다'고 했다",
    question: "옆에 앉아 있다가 뭘 했어요?",
    options: [
      { value: "A", label: "취소할 때 돌려받는 돈이 적힌 줄부터 같이 찾았다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "계약서를 받아 들고 중요한 줄에 밑줄을 쳐서 돌려줬다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "'오늘은 그만 보고 쉬자'며 계약서를 덮었다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "뭘 짚어야 할지 몰라 옆에서 등만 토닥였다", candid: true, weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D4",
    axis: "supportOrder",
    scene: "상담 중에 '오늘 계약하면 30만원 깎아 드려요'라는 말에 둘 다 흔들렸다",
    question: "그 자리에서 상대에게 어떻게 했어요?",
    options: [
      { value: "A", label: "오늘 안 정해도 괜찮다고 말해 줬다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "조건부터 적어 보자며 상담을 끊고 밖으로 나왔다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "'나 좀 흔들려, 너는?' 하고 작게 물었다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "'고민 그만하고 오늘 끝내자'고 했다", candid: true, weights: [{ construct: "executionSupport", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
  {
    key: "D5",
    axis: "supportOrder",
    scene: "밤 11시에 야근이 끝났는데, 상대가 전화로 내일까지 정할 게 있다고 했다",
    question: "그 늦은 전화에 뭐라고 했어요?",
    options: [
      { value: "A", label: "늦게까지 기다려줘서 고맙다는 말부터 했다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "뭘 정하면 되는지 딱 한 줄로 말해달라고 했다", candid: true, weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "나 오늘 너무 힘들었다고 털어놨다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "'내일 출근 전에 10분만 얘기하자'고 시간을 정했다", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV06Question[];

export const WEDDING_CODE_V09_NEXT_STEPS = {
  A1: "마음에 드는 예시 사진을 각자 3장씩 고른 뒤, 그렇게 찍으려면 추가 비용이 붙는지 견적서에서 같이 찾아보세요. 원본 사진 파일 30만원은 받아서 어디에 쓸지 서로 얘기해 본 뒤에 정하세요.",
  A2: "결혼식장에 최대 얼마까지 쓸지 둘이 먼저 숫자로 정해 두세요. 300만원을 더 쓴다면 어디서 아낄지, 왜 꼭 이 홀이어야 하는지 각자 한 줄씩 써서 같이 읽어 보세요.",
  A3: "결혼식 영상을 나중에 몇 번이나 볼 것 같은지 각자 말해 보세요. 넣는다면 몇 시간 찍는지, 몇 분짜리 영상을 언제 받는지, 취소하면 얼마를 돌려받는지 문자나 메일로 받아 두세요.",
  A4: "사진이 마음에 드는지, 촬영 날 우리가 편할지, 계약을 믿을 만한지 칸을 나눠 적어 보세요. 예약금을 돌려받는 조건은 문자나 메일로 받아 두고, 사진이 비슷한 업체 한 곳과 비교해 본 뒤에 정하세요.",
  A5: "올 것 같은 하객 수를 각자 적고, 그 인원일 때와 200명일 때 밥값이 얼마인지 둘 다 계산해 보세요. 그만큼만 앉았을 때 홀이 어떻게 보이는지 사진도 받아 본 뒤에 정하세요.",
  B1: "후보를 줄이기 전에 둘 다 꼭 따질 것 두 가지와 마지막에 누가 고를지부터 정해 보세요. 누가 줄이든 뺀 곳은 왜 뺐는지 한 줄씩 적어 두세요.",
  B2: "이번 주 할 일을 적고, 혼자 정해도 되는 일과 둘이 봐야 하는 일에 각각 표시해 보세요. 혼자 정한 일은 그날 밤 한 줄로 알려 주세요.",
  B3: "맡은 사람이 끝까지 못 고르면 누가 언제까지 고를지 둘이 미리 정해 두세요. 남은 두 곳을 두고는 각자 이것만은 양보 못 한다는 걸 하나씩 말해 보세요.",
  B4: "표를 사기 전에 둘이 넘지 않을 금액과 바꿀 수 없는 날짜를 먼저 적어 두세요. 그 안이면 누가 결제해도 되고, 벗어나면 서로 확인한 뒤에 결제하세요.",
  B5: "일하는 중에 업체 전화가 오면 혼자 바로 답해도 되는 일과 회의 중이어도 상대를 불러낼 일을 미리 나눠 보세요. 나머지는 저녁에 같이 정하고, 날짜처럼 급한 일은 몇 시까지 답하면 되는지 업체에 물어보세요.",
  C1: "부모님 걱정 가운데 주차 대수처럼 알아보면 답이 나오는 것과 취향 문제를 나눠 적어 보세요. 누가 알아볼지, 부모님과 같이 다시 가 볼지, 마지막엔 누가 정할지는 계약 전에 둘이 정해 두세요.",
  C2: "부모님께 이 순서가 왜 중요한지, 둘은 왜 내키지 않는지 한 문장씩 적어 보세요. 그다음 아예 뺄지, 짧게 할지, 다른 순서로 바꿀지 둘이 얘기해 보세요.",
  C3: "늘어난 밥값은 누가 내고 그분들 축의금은 누가 받을지부터 둘이 정해 보세요. 그다음 하객을 최대 몇 명까지 부를지 정하고, 그 안에서 우리 쪽과 부모님 쪽 인원을 나누세요.",
  C4: "여행을 미루거나 줄이면 우리가 손해 보는 것과, 식사를 또 미루거나 평일로 옮기면 부모님이 곤란해지는 것을 각각 적어 보세요. 이번 일을 둘이 정할지, 부모님께 여쭤보고 정할지도 같이 이야기하세요.",
  C5: "받을지 정하기 전에 이 돈을 어디에 쓸지, 거기에 부모님 뜻을 얼마나 따를지 둘이 먼저 적어 보세요. 부모님께는 한 사람이 맡아서 둘이 정한 그대로 말씀드리세요.",
  D1: "상대가 힘들다고 하면 방법부터 꺼내기 전에 '얘기 들어줄까, 같이 정리할까?' 하고 물어보세요. 상대가 고른 쪽부터 하면 돼요.",
  D2: "준비 얘기는 20분만 하기로 하고, 시작할 때 오늘 하루 어땠는지 한마디씩 해 보세요. 남은 시간엔 하나만 정하고, 못 끝낸 건 다음 날로 미뤄도 돼요.",
  D3: "계약서를 읽다 막히면 오늘 더 볼 힘이 있는지부터 서로 물어보세요. 더 본다면 한 사람은 읽고 한 사람은 궁금한 걸 적으세요. 모르는 문장은 업체에 문자나 메일로 물어보고, 답을 받기 전에는 서명하지 마세요.",
  D4: "할인 마감이 언제인지, 날짜를 바꾸면 할인도 사라지는지 직원에게 물어보세요. 30만원을 안 깎아 줘도 여기로 할지 각자 먼저 답해 보세요.",
  D5: "밤늦게 정할 일이 생기면 먼저 '지금 얘기할 힘 있어?'라고 물어보세요. 없다고 하면 내일 몇 시에 정할지만 잡고, 있으면 오늘 꼭 정할 것 하나만 고르세요.",
} as const satisfies Readonly<Record<WeddingCodeQuestionKey, string>>;
