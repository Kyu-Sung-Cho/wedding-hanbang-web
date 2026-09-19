import {
  WEDDING_CODE_V06_AXES,
  type WeddingCodeV06Question,
  type WeddingCodeQuestionKey,
} from "./weddingCodeV06";

/**
 * 팀원 PDF와 문항별 교차 검수를 반영한 공개 장면 대화 도구.
 * 질문은 지금 나라면 고를 답이다. 실제 성격·궁합이나 행동을 판정하지 않는다.
 * 뜻이 바뀐 답이 옛 공유 링크에 섞이지 않게 v1.0 원문은 보존한다.
 * 상세 판단과 한계: docs/wedding-code/2026-09-19_v11_question_revision.md
 * 공개 판 추가는 연구 기여 수집 허용을 뜻하지 않는다.
 */
export const WEDDING_CODE_V11_VERSION = "v1.1-code";
export const WEDDING_CODE_V11_AXES = WEDDING_CODE_V06_AXES;

export const WEDDING_CODE_V11_QUESTIONS = [
  {
    key: "A1",
    axis: "decisionCriteria",
    scene: "촬영 업체가 보낸 견적서와 사진을 상대와 보고 있다. 견적서에는 ‘촬영 250만원, 원본 사진 파일 30만원 별도’라고 쓰여 있다.",
    question: "나라면 어떤 말을 먼저 할까요?",
    options: [
      { value: "A", label: "원본까지 받으면 280만원이네. 우리 예산이랑 맞나 보자", weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "원본 말고 따로 돈 내는 항목이 또 있는지 보자", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "이 사진 색감 좋다. 우리도 이런 느낌으로 찍고 싶어", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "나중에 둘이 꺼내 볼 사진인데, 어떤 순간을 남기면 좋을까?", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },
  {
    key: "A2",
    axis: "decisionCriteria",
    scene: "둘 다 마음에 든 결혼식장을 보고 왔다. 그런데 정해 둔 예산보다 300만원이 비싸다.",
    question: "나라면 집에 와서 어떤 카톡부터 보낼까요?",
    options: [
      { value: "A", label: "여기로 하면 우리 예산보다 300만원을 더 써야 하네", weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "아까 거기 있으니까 우리 진짜 결혼하는구나 싶더라", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "C", label: "견적에서 어떤 항목이 비싼지 자세히 물어보자", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "그 홀 천장 조명이 계속 생각나. 분위기가 참 좋았어", weights: [{ construct: "aestheticMood", value: 2 }] },
    ],
  },
  {
    key: "A3",
    axis: "decisionCriteria",
    scene: "사진 촬영은 하기로 했다. 직원이 결혼식 영상도 남길 수 있다며 예시를 보여준다. 영상은 150만원이 추가된다.",
    question: "나라면 상대에게 먼저 뭐라고 할까요?",
    options: [
      { value: "A", label: "나중에 사진뿐 아니라 우리 목소리도 다시 듣고 싶어", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "B", label: "영상 분위기가 좋다. 우리도 저런 느낌이면 좋겠어", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "C", label: "150만원에 몇 시간 찍고 어떤 영상을 주는지 물어보자", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "사진도 찍으니까 영상에 150만원을 더 쓸지는 계산해 보자", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A4",
    axis: "decisionCriteria",
    scene: "사진이 마음에 드는 촬영 업체를 찾았다. 후기는 3개뿐이고, 예약하려면 내일까지 답을 줘야 한다.",
    question: "나라면 오늘 밤 무엇부터 확인할까요?",
    options: [
      { value: "A", label: "여기서 찍은 다른 사진들도 내 마음에 드는지 본다", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "B", label: "약속한 날 사진을 잘 받았다는 후기가 있는지 찾아본다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "촬영할 때 어떻게 진행하는지 물어보고, 우리도 편할지 생각해 본다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "D", label: "예약을 취소하면 예약금을 얼마나 돌려받는지 물어본다", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A5",
    axis: "decisionCriteria",
    scene: "결혼식장 식사비는 한 사람에 7만원이고, 하객이 덜 와도 200명분은 내야 한다. 이 금액은 둘이 정한 예산 안에 든다.",
    question: "나라면 상담에서 무엇을 먼저 물어볼까요?",
    options: [
      { value: "A", label: "음료값까지 합치면 200명 기준으로 총 얼마예요?", weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "당일에 실제로 몇 명이 식사했는지는 어떻게 확인해요?", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "손님이 앉아 있는 홀 사진도 볼 수 있어요?", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "식이 끝나고 손님들과 인사 나눌 시간은 얼마나 있어요?", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },
  {
    key: "B1",
    axis: "preparationMode",
    scene: "상대가 둘이 원하는 조건에 맞는 결혼식장 10곳을 표로 보내왔다. 이번 주말에 가 볼 세 곳을 정하려고 한다.",
    question: "나라면 세 곳을 어떻게 추릴까요?",
    options: [
      { value: "A", label: "처음부터 둘이 표를 같이 보면서 한 곳씩 빼고 세 곳을 남긴다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "각자 세 곳을 골라 온 뒤, 겹치는 곳부터 같이 정한다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "표에서 내가 세 곳을 고르고, 방문 예약까지 맡는다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "정리한 상대에게 세 곳을 골라 달라고 하고, 방문할 날은 내가 잡는다", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B2",
    axis: "preparationMode",
    scene: "이번 주에 결혼식장과 촬영 업체 상담을 받아야 한다. 둘 다 시간을 낼 수 있고, 영상 통화로 참여해도 된다.",
    question: "나라면 두 상담을 어떻게 받을까요?",
    options: [
      { value: "A", label: "결혼식장 상담은 나 혼자, 촬영 상담은 상대 혼자 받는다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "두 상담 모두 처음부터 끝까지 같이 듣는다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "두 상담 모두 나 혼자 받고, 끝난 뒤 상대에게 내용을 전한다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "두 상담 모두 설명은 내가 듣고, 마지막 질문에는 상대도 함께한다", weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B3",
    axis: "preparationMode",
    scene: "상대가 알아본 신혼여행지 두 곳을 보여준다. 둘 다 예산에 맞고 마음에 든다. 이제 한 곳만 고르면 된다.",
    question: "나라면 마지막 한 곳은 어떻게 고를까요?",
    options: [
      { value: "A", label: "상대에게 더 가고 싶은 곳으로 골라 달라고 한다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "자료를 받아서 마지막 비교와 선택은 내가 맡는다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "처음부터 둘이 한 화면을 보며 조건을 하나씩 비교해서 정한다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "각자 한 곳을 골라 온 뒤, 고른 이유를 얘기하고 정한다", weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B4",
    axis: "preparationMode",
    scene: "둘이 정한 날짜와 예산에 맞는 비행기편이 몇 개 있다. 이 안에서는 한 사람이 골라 사도 괜찮다고 얘기했고, 이번 주 안에 사기로 했다.",
    question: "나라면 항공권을 어떻게 살까요?",
    options: [
      { value: "A", label: "둘이 한 화면을 보며 비교하고, 살 표를 같이 고른다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "표 비교와 구매는 상대에게 맡긴다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "각자 자기 폰으로 표를 찾아 카톡으로 비교하며 고른다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "내가 표를 찾아 사고, 결제한 내용을 상대에게 보낸다", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B5",
    axis: "preparationMode",
    scene: "둘 다 괜찮은 날짜가 두 개다. 누가 골라도 좋다고 얘기해 뒀는데, 식장에서 오늘 오후 6시까지 확정해 달란다. 상대와는 점심에 연락할 수 있다.",
    question: "나라면 마지막 확정은 어떻게 할까요?",
    options: [
      { value: "A", label: "문자로 상대 의견을 한 번 더 받고, 내가 확정 전화를 한다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "둘 다 괜찮던 날짜 중 내가 하나를 정해 확정하고 알린다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "점심에 둘이 통화해서 하나를 고른 뒤 확정한다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "마지막 날짜 선택과 확정 연락을 상대에게 맡긴다", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "C1",
    axis: "coordinationScope",
    scene: "둘이 고른 결혼식장을 보고 부모님이 주차를 걱정하신다. 다른 후보도 있다.",
    question: "계약 전에 먼저 뭘 하겠어요?",
    options: [
      { value: "A", label: "둘이 다시 가서 주차장을 살펴본다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "둘이 다른 후보와 주차 조건을 비교해 본다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "부모님과 함께 주차장을 보러 갈 날을 잡는다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "부모님께 다른 후보도 보여드리고 의견을 듣는다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C2",
    axis: "coordinationScope",
    scene: "부모님은 식이 끝난 뒤 한복 입고 절하길 바라신다. 둘은 내키지 않는다.",
    question: "부모님께 먼저 어떻게 말씀드리겠어요?",
    options: [
      { value: "A", label: "그 순서는 빼고 따로 인사드리고 싶어요", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "원하시면 짧게라도 넣을게요", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "절 대신 감사 영상을 보여드리려고요", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "대신 뭘 하면 좋을지 같이 골라 주세요", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C3",
    axis: "coordinationScope",
    scene: "부모님 쪽 손님은 30명으로 함께 정했다. 보내주신 명단에는 둘도 아는 40명이 있다.",
    question: "30명으로 줄일 때 어떻게 하겠어요?",
    options: [
      { value: "A", label: "부모님께 꼭 모실 30명을 골라 달라고 한다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "부모님과 명단을 보며 함께 30명을 추린다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "둘이 자주 뵌 분부터 남겨 30명을 추린다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "둘이 친척을 우선으로 30명을 고른다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C4",
    axis: "coordinationScope",
    scene: "양쪽 부모님과 처음 함께 식사할 날짜는 정했다. 이제 어디서 먹을지 정하려 한다.",
    question: "식당을 정할 때, 나라면 뭐부터 할까요?",
    options: [
      { value: "A", label: "부모님들께 어떤 음식을 드시고 싶은지 여쭤본다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "둘이 식당 몇 곳을 골라 메뉴와 위치를 부모님께 보내드린다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "부모님들께 가보고 싶으신 식당이 있는지 여쭤본다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "둘이 식당 한 곳을 골라 이곳으로 예약해도 괜찮을지 여쭤본다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C5",
    axis: "coordinationScope",
    scene: "부모님이 결혼 비용을 보태 주시며 어디에 쓸지 물으신다. 아직 쓸 곳은 정하지 않았다.",
    question: "고맙다고 한 뒤, 뭐라고 하겠어요?",
    options: [
      { value: "A", label: "쓸 곳은 저희 둘이 정해서 알려드릴게요", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "생각해 두신 데가 있으세요?", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "이 돈도 전체 예산에 넣고, 둘이 필요한 데 나눠 쓸게요", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "어디에 쓰면 좋을지 저희랑 같이 골라 주세요", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "D1",
    axis: "supportOrder",
    scene: "하객 명단 정리가 버겁다고 했더니 상대가 엑셀 양식을 보내왔다.",
    question: "파일을 받고 먼저 뭐라고 하겠어요?",
    options: [
      { value: "A", label: "왜 버거운지 잠깐 내 얘기 좀 들어줄래?", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "나만 준비하는 기분이라 좀 서운해", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "이 양식 같이 채우자. 누구부터 적을까?", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "각자 부를 사람부터 이번 주에 적자", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
  {
    key: "D2",
    axis: "supportOrder",
    scene: "어제 준비 얘기를 하다가 둘 다 말수가 줄었다. 오늘 다시 잠깐 얘기하기로 했다.",
    question: "오늘은 뭐부터 말하겠어요?",
    options: [
      { value: "A", label: "오늘은 정할 것 하나만 골라서 얘기하자", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "어제 얘기할 때 뭐가 답답했어?", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "오늘은 누가 어느 일을 맡을지 정하자", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "나는 어제 준비 얘기가 좀 부담됐어", weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D3",
    axis: "supportOrder",
    scene: "계약서를 읽던 상대가 '뭐가 뭔지 모르겠어'라고 한다. 서명은 나중에 해도 된다.",
    question: "옆에서 먼저 뭐라고 말하겠어요?",
    options: [
      { value: "A", label: "모르는 줄을 표시해서 담당자에게 물어보자", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "나랑 반씩 읽고 어려운 부분은 같이 보자", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "많이 지쳤어? 잠깐 쉬었다 봐도 괜찮아", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "계약 앞두니까 나도 좀 긴장돼", weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D4",
    axis: "supportOrder",
    scene: "오늘 계약하면 30만원 할인된다는 말에 둘 다 흔들린다. 잠깐 밖에서 얘기하기로 했다.",
    question: "밖으로 나와서 먼저 뭐라고 하겠어요?",
    options: [
      { value: "A", label: "할인 놓쳐도 괜찮으니 마음 급하게 먹지 말자", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "할인 기한이랑 추가 비용을 다시 물어보자", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "나도 할인 때문에 흔들려. 너는 어때?", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "할인 없어도 여기가 나은지 다른 곳과 비교하자", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
  {
    key: "D5",
    axis: "supportOrder",
    scene: "야근을 마친 밤 11시, 상대가 내일 점심까지 정할 게 있다고 전화한다.",
    question: "전화를 받고 먼저 뭐라고 하겠어요?",
    options: [
      { value: "A", label: "나 오늘 많이 지쳤어. 잠깐 내 얘기 들어줄래?", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "지금 어떤 걸 고르면 되는지 말해줄래?", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "너는 오늘 어땠어? 많이 힘들었어?", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "내일 아침 몇 시에 같이 정할까?", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV06Question[];

export const WEDDING_CODE_V11_NEXT_STEPS = {
  A1: "각자 남기고 싶은 사진을 한 장씩 골라 보세요. 그렇게 찍을 때 드는 총액과 원본 파일을 받는 비용을 같은 견적서에 적어 달라고 하면 비교하기 편해요.",
  A2: "각자 이 홀에서 좋았던 점을 하나씩 말해 보세요. 300만원 차이가 어떤 항목에서 나는지도 확인하고, 더 써도 괜찮은지 둘이 같은 금액을 보고 정해 보세요.",
  A3: "나중에 다시 보고 싶은 순간을 하나씩 말해 보세요. 영상을 넣고 싶다면 촬영 시간, 받는 영상, 추가금이 적힌 안내를 받아 같이 살펴보세요.",
  A4: "마음에 든 사진과 원하는 촬영 방식을 함께 이야기해 보세요. 예약 전에는 취소할 때 돌려받는 금액과 사진을 받는 날짜를 글로 확인해 두세요.",
  A5: "예상 하객 수로 좌석 배치와 최종 식사비를 함께 받아 보세요. 식사 인원을 확인하는 방법과, 식이 끝난 뒤 손님을 만날 시간도 같이 확인해 두세요.",
  B1: "둘 다 빼고 싶은 조건을 하나씩 말해 보세요. 세 곳으로 줄이는 사람과 방문 날짜를 잡는 사람을 정하고, 마지막 계약은 둘이 언제 같이 볼지도 잡아 두세요.",
  B2: "두 상담에서 꼭 물어볼 것을 각자 하나씩 적어 보세요. 혼자 상담을 받더라도 계약할지 결정하기 전에는 견적서와 받은 답을 같이 확인해 두세요.",
  B3: "두 곳에서 각자 꼭 지키고 싶은 조건을 하나씩 말해 보세요. 마지막 선택을 누가 할지와 언제까지 정할지도 함께 정해 두세요.",
  B4: "정해 둔 날짜와 예산 안에서 누가 표를 살지 얘기해 보세요. 환승이나 수하물 조건이 달라지면 구매 전에 다시 물어볼지도 맞춰 두세요.",
  B5: "업체에 답해야 할 시각부터 확인하세요. 둘이 이미 정한 범위에서는 누가 답해도 되는지, 새 조건이 나오면 언제 함께 확인할지 미리 얘기해 두세요.",
  C1: "주차가 몇 대까지 되는지, 주차장에서 홀까지 얼마나 걸리는지 확인해 보세요. 확인한 내용을 함께 본 뒤, 계약할 곳은 누가 마지막으로 정할지 둘이 이야기해 보세요.",
  C2: "부모님이 절하는 순서에서 꼭 바라는 게 무엇인지 들어 보세요. 둘이 내키지 않는 부분도 말한 뒤, 그대로 할지 짧게 할지 다른 인사로 바꿀지 함께 정해 보세요.",
  C3: "30명을 넘기지 않는 선에서 누가 최종 명단을 정할지 이야기해 보세요. 아직 정하지 않은 분께 먼저 청첩장이 가지 않도록, 확정한 명단을 부모님과 함께 확인해 보세요.",
  C4: "식당 후보를 누가 먼저 골라볼지 정해 보세요. 예약 전에는 못 드시는 음식과 이동하기 어려운 곳이 있는지 양쪽 부모님께 확인해 보세요.",
  C5: "돈을 쓰기 전에 부모님이 바라시는 용도가 있는지, 둘이 쓰고 싶은 곳과 같은지 확인해 보세요. 생각이 다르면 어디까지 함께 정할지 이야기한 뒤 사용하세요.",
  D1: "명단 때문에 버거웠던 이유를 한마디씩 말해 보세요. 그다음 각자 누구 이름을 채울지 나누고, 파일을 같이 볼 날을 정해 보세요.",
  D2: "어제 대화에서 말하지 못한 게 있는지 한마디씩 들어 보세요. 그다음 오늘 정할 일 하나와 대화를 마칠 시간을 둘이 정해 보세요.",
  D3: "더 읽을 힘이 있는지 먼저 확인해 보세요. 계속 본다면 모르는 문장을 표시해 업체에 물어보고, 설명을 이해한 뒤에 서명하세요.",
  D4: "할인을 빼고도 여기로 정하고 싶은지 각자 말해 보세요. 마음이 다르면 바로 계약하지 말고, 더 확인할 것과 다시 이야기할 시간을 정해 보세요.",
  D5: "지금 이야기할 힘이 있는지부터 서로 확인해 보세요. 아침으로 미룬다면 몇 시에 통화할지와 누가 필요한 자료를 챙길지만 정해 두세요.",
} as const satisfies Readonly<Record<WeddingCodeQuestionKey, string>>;
