import { describe, expect, it } from "vitest";

import {
  selectAmoraPendingProposalTools,
  type AmoraProposalContinuityAnchor,
} from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import {
  matchedSpecialistByKeyword,
  routeSpecialist,
} from "@/lib/ai/stage-router";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import type { StageTag } from "@/types/moat.types";

/**
 * 짧은 답이 **앞 요청이 자기 턴에서 받았던 확인 카드 도구**를 이어받는가.
 *
 * 2026-09-17 라이브 재현(세 단계 모두 같았다):
 *
 *   사용자: U1 (아래) — 배분표를 짜 달라는 요청      → 예산 카드 도구 4개
 *   아모라: (배분표)
 *   사용자: "응, 이대로 실제 예산에 반영해줘."        → 같은 4개
 *   아모라: "… 적용할까요?"                          ← 글로만 되물음
 *   사용자: "응 적용해줘"                            → **0개**
 *
 * 라우트는 연속성이 증명된 턴에서 U1 과 답을 이어 붙여 선택기에 넘기는데, 전문분야는
 * 답만 보고 정한다. 답에는 키워드가 없어 관문 해제가 꺼지고, 이어 붙인 문장의 가드가
 * **U1 자신의 "알려줘"** 에 걸렸다. 카드 계약이 빠지자 아모라는 기능이 없다며 직접
 * 입력하라고 답했다.
 *
 * 입력은 라우트가 만드는 모양 그대로다 — 답의 라우팅은 답만으로, 닻의 라우팅은
 * 앞 요청만으로 계산한다.
 *
 * ## 2026-09-18: 관문을 뒤집었다
 *
 * 처음 판(803831b6)은 "무르는 말이 아니면 이어받는다" 였고, 거절 어형을 열거해
 * 막았다. 재검사에서 그 구조가 양쪽으로 틀린 것이 숫자로 나왔다 — 아래 `MATRIX`
 * 주석에 전/후 표가 있다. 지금은 **실행해 달라거나 값을 고쳐 달라는 말일 때만**
 * 이어받는다. 그래서 이 파일의 기대값 두 개가 바뀌었다: 맨 승낙 "응" 은 더 이상
 * 이어받지 않고(`ACKNOWLEDGING` 쪽으로 옮겼다), 상태 이야기("안 됐어")도 이어받지
 * 않는다. D1 라이브 재현의 답("응 적용해줘"·"네 반영해줘"·"좋아, 이대로 적용해줘"·
 * 정정 "아니 4천으로 해줘")은 그대로 열린다 — 그것이 이 파일이 지키는 것이다.
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const STAGES: readonly StageTag[] = ["planning_0", "preparation_1", "execution_2"];
const BUDGET_CARD_TOOLS = [
  "update_budget",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
] as const;

const U1 =
  "우리 조건 다시 정리할게. 총예산 3,500만원, 신혼집·가전·가구는 예산에서 제외하고, 하객은 90명 정도야. 이 기준으로 항목별 예산 배분을 표로 짜주고, 왜 그렇게 나눴는지도 알려줘.";

/** 자기 턴에서 키워드로 배분 경로에 들어가 예산 카드 도구를 받는 계획 요청. */
const PLANNING_ANCHORS = [
  U1,
  "총예산 5천만원 기준으로 항목별 예산 배분 추천해줘",
  "하객 150명이면 식대 예산 얼마로 잡는 게 좋을까",
  "식대 예산 얼마 정도가 적당한지 알려줘",
] as const;

/**
 * 앞 요청을 그대로 잇는 실행 부탁·정정.
 *
 * 2026-09-18: 맨 승낙 "응" 이 이 목록에서 빠졌다. 관문이 "무르는 말이 아니면
 * 이어받는다" 에서 "실행해 달라거나 값을 고쳐 달라는 말일 때만 이어받는다" 로
 * 뒤집혔고, 맨 승낙은 그 조건이 아니다 — 아래 `ACKNOWLEDGING_REPLIES` 주석에 왜
 * 그렇게 갈랐는지 적었다. D1 라이브 재현의 답("응 적용해줘")은 그대로 여기 있다.
 */
const CONTINUING_REPLIES = [
  "응 적용해줘",
  "네 반영해줘",
  "이대로 적용해줘",
  "좋아, 이대로 적용해줘",
  "그렇게 해줘",
  "아니 4천으로 해줘",
  "아니 식대는 1200만원으로 해줘",
] as const;

/** 답 자신이 무르는 말 — 앞 요청의 카드 도구를 이어받지 않는다. */
const CLOSING_REPLIES = [
  "응 농담이야",
  "아니 아직 정하지 않았어",
  "음 고민 중이야",
  "응 근데 추천해줘",
  "응 ㅋㅋ",
] as const;

/**
 * 실행 부탁 **어형인데 우리 결정이 아닌** 답.
 *
 * 관문의 첫 줄(`isNotOurDecision`)이 이것을 진다. 농담·남에게 보낼 문자·이미 무른
 * 말은 "이대로 적용해줘"·"4천으로 해줘" 를 그대로 품고 있어서, 그 줄이 없으면
 * 양성 관문이 곧바로 열린다.
 */
const NOT_OUR_DECISION_REPLIES = [
  "농담이야 이대로 적용해줘",
  "장난이야 4천으로 해줘",
  "엄마한테 보낼 문자야 4천으로 해줘",
  "아까 말한 거 없던 일로 해줘",
] as const;

/**
 * 앞 요청을 **거절하는** 답 (2026-09-18 검토).
 *
 * 위 `CLOSING_REPLIES` 는 값이 덜 정해졌거나 우리 말이 아닌 경우였다. 그냥 "하지
 * 마" 라고 거절한 답은 그 셋 중 어디에도 없어서, 앞 요청의 카드 도구를 그대로
 * 이어받았다 — 누르지 않으면 아무것도 저장되지 않지만, 거절한 답에 카드를 내미는
 * 것 자체가 틀렸다. `없던 일로 해줘` 만 `RETRACTION` 에 걸려 이미 닫혀 있었다.
 */
const REFUSING_REPLIES = [
  // 검토가 적어 온 다섯 문장.
  "아니 됐어",
  "아니 하지 마",
  "나중에 할래",
  "취소해줘",
  "안 할래",
  // 같은 말의 다른 모양.
  "됐어",
  "하지 마",
  "아냐 됐어",
  "아니요 괜찮아요",
  "아니 지금은 안 할래",
  "안 해도 돼",
  "필요 없어",
  "관둬",
  "관둘래",
  "그만",
  "그만하자",
  "아니 취소",
  "취소할래",
  "아니 그냥 놔둬",
  "반영하지 마",
  "저장하지 마",
  "적용하지 말아줘",
  "지금은 하지 말아줘",
  "일단 하지 마",
  "다시 생각해볼게",
  "좀 더 생각해볼게",
  "나중에 하자",
  // 항목을 말하지만 거절이다. "새 값을 말하면 정정" 예외를 넣었다가 이 줄 때문에 뺐다 —
  // 무엇을 미루는지 적은 거절이 정정으로 읽혔다.
  "드레스는 나중에 할래",
  // 이 갈래는 `RETRACTION` 이 이미 닫고 있었다. 회귀 여부를 같이 본다.
  "없던 일로 해줘",
] as const;

/**
 * 거절인데 **자기 문장이 금액을 품어** 이어 붙인 문장만으로 예산 경로가 열리는 답.
 *
 * "300만원" 이 키워드로 배분 경로를 열어 `pendingProposalToolNames` 의 관문 해제가
 * 켜지므로, 이 턴은 닻이 없어도 예산 카드 도구가 나온다 — 803831b6 이전과 같은 경로다.
 * 여기서 고정하는 것은 **닻이 아무것도 더하지 않는다**는 것이다.
 */
const REFUSING_REPLIES_WITH_OWN_VALUE = ["300만원은 필요 없어"] as const;

/**
 * 거절처럼 생겼지만 **새 값을 주는** 답 — 정정이라 계속 이어받는다.
 *
 * "아니" 와 "하지 마" 만 보면 아래 문장들도 거절로 읽힌다. 금액·날짜·항목 이름이
 * 있으면 무엇으로 바꾸라는 말이므로 거절로 보지 않는다.
 */
const CORRECTING_REPLIES = [
  "아니 3천으로 바꿔줘",
  "아니 10월 18일로 해줘",
  "아니 다음 주 화요일로 옮겨줘",
  "아니 그건 하지 말고 식대는 1200만원으로 올려줘",
  "아니 드레스는 하지 말고 스튜디오로 해줘",
  // 무엇을 취소하라는 말은 정당한 변경 요청이다(`pendingProposalToolNames` 주석).
  "드레스 투어 일정 취소해줘",
  "예약 취소해줘",
] as const;

/**
 * 거절 낱말을 품었지만 거절도 아닌 말 — **상태 이야기**다.
 *
 * 2026-09-18 관문을 뒤집으면서 이 묶음의 기대값이 바뀌었다. 거절 목록을 쓰던 동안
 * 이 문장들은 "오탐이면 D1 이 되살아난다" 는 이유로 **이어받아야** 했다. 지금은
 * 관문이 "실행해 달라거나 값을 고쳐 달라는 말인가" 만 보므로, 상태 보고는 어느
 * 쪽도 아니라 **이어받지 않는다** — 그리고 그것이 맞다. "안 됐어" 는 앞 제안을
 * 적용해 달라는 말이 아니다.
 *
 * 오탐 걱정 자체가 없어졌다는 것이 요점이다: 거절 목록이 없으니 `됐어` 를 넓게
 * 잡아 "잘 됐어" 를 거절로 읽는 실수가 성립하지 않는다. 이 묶음은 이제 그
 * **구조**를 고정한다 — 닫혀 있고, 닫힌 답은 이어 붙인 문장이 스스로 받는 것만 받는다.
 */
const STATUS_REPORT_REPLIES = [
  "잘 됐어",
  "거의 다 됐어",
  "안 됐어",
  "그만큼이면 충분해",
  // 사양이 아니라 되묻는 말 — "그건 괜찮아?" 는 그 항목이 괜찮은지 묻는 것이다.
  "그건 괜찮아?",
] as const;

/** 금액·날짜를 스스로 품은 직접 변경 요청. 이어 붙인 문장만으로도 도구가 나온다. */
const DIRECT_CHANGE_ANCHORS = [
  "결혼식장 예산 1800만원으로 다시 바꿔줘",
  "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
] as const;

/** 자기 턴에서도 카드 도구가 없던 앞 요청 — 이어받을 것이 없다. */
const NO_OFFER_ANCHORS = [
  // 남에게 들은 말.
  "친구는 드레스에 300만원 썼대",
  // 키워드 없이 단계 기본값으로 떨어진 상담 질문(dd2f127b 계약).
  "드레스 투어 언제 하는 게 좋을까",
] as const;

/**
 * 2026-09-18 재검사 행렬 — 답의 종류마다 닻이 무엇을 더하는가.
 *
 * 거절 목록을 쓰던 판(803831b6)은 여는 쪽에서 틀렸다. 같은 선택기로 같은 입력을 재서
 * (어형마다 앞 요청 2개 × 단계 3개 = 6칸) 남긴 숫자 — 닻이 **더한** 칸/도구/어형:
 *
 *   버킷          어형   칸     전               후
 *   거절·보류      60    360    48 / 192 / 16    0 / 0 / 0
 *   인정·감사      28    168    84 / 336 / 28    0 / 0 / 0
 *   물음           12     72     9 /  36 /  3    0 / 0 / 0
 *   상태 이야기     5     30    15 /  60 /  5    0 / 0 / 0
 *   실행 부탁      28    168    81 / 324 / 27   81 / 324 / 27
 *   정정          14     84    30 / 120 / 10   30 / 120 / 10
 *
 * "전" 에서 이어받던 거절은 "지금은 넘어가자"·"굳이 안 해도 될 것 같아"·"내일 다시
 * 얘기하자"·"취소 부탁해" 처럼 어느 거절 목록에도 안 걸리는 말들이었고, 인정·감사는
 * **28가지 전부** 예산 카드 도구 4개를 받았다("감사합니다" 포함).
 *
 * 실행·정정 버킷은 칸 수가 전후로 같다(81·30). 그 두 버킷에서 **더해지지 않은 칸**은
 * 이어 붙인 문장이 이미 같은 도구를 주고 있던 칸이므로, 늘어난 칸 수가 아니라
 * "닻이 자기 턴에 받았던 것을 답도 받는가"로 잰다 — 두 버킷 252칸 전부 참이다.
 */
const MATRIX = [
  {
    bucket: "거절·보류",
    inherits: false,
    replies: [
      "아니 됐어", "아니 하지 마", "나중에 할래", "취소해줘", "안 할래",
      "됐어", "하지 마", "아냐 됐어", "아니요 괜찮아요", "아니 지금은 안 할래",
      "안 해도 돼", "필요 없어", "관둬", "관둘래", "그만",
      "그만하자", "아니 취소", "취소할래", "아니 그냥 놔둬", "반영하지 마",
      "저장하지 마", "적용하지 말아줘", "지금은 하지 말아줘", "일단 하지 마", "다시 생각해볼게",
      "좀 더 생각해볼게", "나중에 하자", "드레스는 나중에 할래", "없던 일로 해줘", "아니야",
      "아뇨", "아니 그건 아니야", "지금은 아니야", "아직은 하지 마", "보류",
      "일단 보류할게", "보류해줘", "조금 더 고민해볼게", "신랑이랑 상의하고 결정할게",
      "부모님께 여쭤보고 결정할게", "그냥 둬", "그대로 둬", "저장 안 해도 돼",
      "굳이 안 해도 될 것 같아", "지금은 넘어가자", "다음에 하자", "내일 다시 얘기하자",
      "아직 결정 못 했어", "좀 있다가 할게", "이건 취소할게", "아니 됐고", "아니 그만하자",
      "안 넣어도 돼", "취소 부탁해", "하지 말아줘", "그냥 놔두자", "아니 이건 빼줘",
      "예산은 그대로 둘래", "아직 안 정했어", "됐고 다른 얘기하자",
    ],
  },
  {
    // 맨 승낙("응"·"네"·"오케이")을 인정과 같이 둔다. 문장만으로는 둘을 가를 수 없고,
    // 닻은 아모라가 무엇을 되물었는지 모른다 — "적용할까요?" 였는지 "일정도 잡아
    // 드릴까요?" 였는지. `classifyAmoraTypedCardAcceptance` 도 같은 이유로 맨 승낙을
    // 카드 승낙으로 올리지 않는다(그 파일 리뷰 [3]). 대신 실행 동사가 한 마디라도
    // 붙으면("응 적용해줘"·"응 넣어줘") 아래 버킷에서 열린다.
    bucket: "인정·감사",
    inherits: false,
    replies: [
      "감사합니다", "고마워", "고맙습니다", "알겠어", "응 알겠어",
      "네 알겠습니다", "알겠어요", "오케이", "응", "네",
      "그래", "좋아", "맞아", "응 고마워", "고마워요",
      "아 그렇구나", "그렇구나", "잘 알겠어", "응 그렇네", "확인했어",
      "좋네", "잘 됐네", "넵", "ㅇㅋ", "응응",
      "감사해요", "잘 봤어", "오 좋다",
    ],
  },
  {
    bucket: "실행 부탁",
    inherits: true,
    replies: [
      "응 적용해줘", "네 반영해줘", "그래 저장해줘", "좋아 등록해줘", "맞아 그렇게 해줘",
      "이대로 반영해줘", "이대로 적용해줘", "그렇게 해줘", "응 넣어줘", "응 바꿔줘",
      "좋아, 이대로 적용해줘", "네 그렇게 해줘", "응 그대로 저장해줘", "응 적용 부탁해",
      "응 그렇게 적용해", "네 저장해주세요", "이대로 진행해줘", "그대로 반영해줘",
      "응 등록해줘", "오케이 적용해줘", "ㅇㅋ 반영해줘", "응 적용해줘 ㅎㅎ",
      "그래 그렇게 해줘", "응 반영 부탁해", "넵 적용해주세요", "좋아 저장해줘",
      // 승낙어 문법 밖의 말이 섞여 있어도 앞 제안을 가리키며 실행을 부탁한다.
      // 첫 문장은 D1 라이브 대화의 가운데 발화 그대로다.
      "응, 이대로 실제 예산에 반영해줘.", "이대로 그냥 반영해줘",
    ],
  },
  {
    bucket: "정정",
    inherits: true,
    replies: [
      "아니 4천으로 해줘", "드레스는 300으로 해줘", "아니 3천으로 바꿔줘",
      "아니 10월 18일로 해줘", "아니 다음 주 화요일로 옮겨줘", "아니 식대는 1200만원으로 해줘",
      "아니 그건 하지 말고 식대는 1200만원으로 올려줘", "아니 드레스는 하지 말고 스튜디오로 해줘",
      "드레스 투어 일정 취소해줘", "예약 취소해줘", "스튜디오는 400만원으로 잡아줘",
      "총예산은 4500만원으로 바꿔줘",
      // 값 대신 **항목 이름**만 말하는 정정. `한복` 은 예산 항목 목록에만, `메모` 는
      // 할 일 어휘에만 있어서, 어느 어휘를 빼면 닫히는지 이 두 줄이 가른다.
      "한복은 취소해줘", "메모는 취소해줘",
    ],
  },
  {
    // 제안에 대한 물음은 승낙이 아니다. 이 버킷은 라우트에서는 애초에 닻이 붙지도
    // 않는다(`hasClarificationAnswerShape` 가 물음표를 내친다) — 관문 자체도 닫혀
    // 있는지 여기서 따로 잰다. 두 겹 중 하나가 느슨해져도 드러난다.
    bucket: "물음",
    inherits: false,
    replies: [
      "이거 적용하면 총예산 넘어?", "이대로 적용하면 어떻게 돼?", "적용하면 뭐가 바뀌어?",
      "이거 적용해도 괜찮아?", "4천으로 하면 어때?", "그렇게 하면 예산 초과야?",
      "이대로 하면 될까?", "적용은 어디서 확인해?", "지금 적용하는 게 나을까?",
      "이대로 가면 예비비가 남아?", "반영하면 상대방한테도 보여?", "이 배분 왜 이렇게 나눈 거야?",
    ],
  },
] as const;

/**
 * 관문의 **남은 경계**. 스스로 대상을 말하면서 무언가를 시키는 보류다.
 *
 * "일정은 나중에 잡아줘"·"드레스는 다음에 정해줘" 는 형태가 부탁(`대상 + 변경 동사 +
 * 어미`)이라 이어받는다. 닫으려면 "나중에"·"다음에" 를 열거하는 거절 목록이 다시
 * 필요한데, 그 구조가 두 번 실패한 것이다. 열려 있어도 카드는 누르기 전에 아무것도
 * 저장하지 않으므로 열어 두고, **어느 쪽인지 여기 적어 둔다** — 나중에 이 줄이
 * 조용히 바뀌지 않게.
 *
 * 반대로 대상을 말하지 않는 "그건 빼줘"·"예산은 그대로 놔둬" 는 닫힌다.
 */
const KNOWN_BOUNDARY_REPLIES = {
  inherits: ["일정은 나중에 잡아줘", "드레스는 다음에 정해줘"],
  closed: ["그건 빼줘", "예산은 그대로 놔둬"],
} as const;

/** 행렬을 재는 앞 요청 — 키워드로 배분 경로에 들어간 계획 요청과 직접 변경 요청. */
const MATRIX_ANCHORS = [U1, DIRECT_CHANGE_ANCHORS[0]] as const;

function anchorFor(prior: string, reply: string, stage: StageTag): AmoraProposalContinuityAnchor {
  return {
    priorUserText: prior,
    priorSpecialistType: routeSpecialist(prior, stage),
    priorSpecialistMatchedByKeyword: matchedSpecialistByKeyword(prior),
    replyText: reply,
  };
}

/** 라우트의 후속 턴 호출. `withAnchor=false` 는 이 수리 전과 같은 입력이다. */
function offeredOnFollowUp(
  prior: string,
  reply: string,
  stage: StageTag,
  withAnchor = true,
): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText: `${prior}\n${reply}`,
    specialistType: routeSpecialist(reply, stage),
    specialistMatchedByKeyword: matchedSpecialistByKeyword(reply),
    attachmentKind: "none",
    ...(withAnchor ? { continuityAnchor: anchorFor(prior, reply, stage) } : {}),
  }).map((tool) => tool.name);
}

/** 앞 요청이 자기 턴에서 받았던 제안 도구. */
function offeredOnOwnTurn(prior: string, stage: StageTag): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText: prior,
    specialistType: routeSpecialist(prior, stage),
    specialistMatchedByKeyword: matchedSpecialistByKeyword(prior),
    attachmentKind: "none",
  }).map((tool) => tool.name);
}

describe("짧은 답은 앞 요청이 받았던 확인 카드 도구를 이어받는다", () => {
  it.each(STAGES)("라이브 재현: U1 뒤의 \"응 적용해줘\" 가 예산 카드 도구를 받는다 (%s)", (stage) => {
    const reply = "응 적용해줘";
    // 라우트가 답만으로 고른 라우팅 — 세 단계 모두 키워드 일치가 없다.
    expect(matchedSpecialistByKeyword(reply)).toBe(false);
    expect(routeSpecialist(reply, stage)).toBe({
      planning_0: "sangkyeonrye_advisor",
      preparation_1: "budget_optimizer",
      execution_2: "ceremony_coordinator",
    }[stage as "planning_0" | "preparation_1" | "execution_2"]);
    // 닻의 라우팅은 U1 자신의 것이다.
    expect(routeSpecialist(U1, stage)).toBe("budget_optimizer");
    expect(matchedSpecialistByKeyword(U1)).toBe(true);

    // 닻이 없으면 이 수리 전과 같다 — 이어 붙인 문장의 가드가 U1 의 "알려줘" 에 걸린다.
    expect(offeredOnFollowUp(U1, reply, stage, false)).toEqual([]);
    expect([...offeredOnFollowUp(U1, reply, stage)].sort()).toEqual([...BUDGET_CARD_TOOLS].sort());
  });

  describe.each(PLANNING_ANCHORS)("앞 요청: %s", (prior) => {
    it.each(STAGES)("자기 턴에서 예산 카드 도구를 받는다 (%s)", (stage) => {
      expect(offeredOnOwnTurn(prior, stage)).toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
    });

    it.each(CONTINUING_REPLIES)("잇는 답 \"%s\" 는 그 도구를 받는다", (reply) => {
      for (const stage of STAGES) {
        const offered = offeredOnFollowUp(prior, reply, stage);
        expect(offered, stage).toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
        expect(offered, stage).toEqual(expect.arrayContaining(offeredOnOwnTurn(prior, stage)));
      }
    });
  });

  it.each(CLOSING_REPLIES)("무르는 답 \"%s\" 는 U1 뒤에서도 카드 도구를 받지 않는다", (reply) => {
    for (const stage of STAGES) {
      expect(offeredOnFollowUp(U1, reply, stage), stage).toEqual([]);
      expect(offeredOnFollowUp(U1, reply, stage, false), stage).toEqual([]);
    }
  });

  describe.each(NO_OFFER_ANCHORS)("자기 턴에도 카드가 없던 앞 요청: %s", (prior) => {
    it.each(STAGES)("자기 턴의 제안 도구가 없다 (%s)", (stage) => {
      expect(offeredOnOwnTurn(prior, stage)).toEqual([]);
    });

    it.each([...CONTINUING_REPLIES, ...CLOSING_REPLIES])("답 \"%s\" 뒤에서 새로 열리는 것이 없다", (reply) => {
      for (const stage of STAGES) {
        expect(offeredOnFollowUp(prior, reply, stage), stage)
          .toEqual(offeredOnFollowUp(prior, reply, stage, false));
      }
    });

    // 금액을 스스로 담은 정정("식대는 1200만원으로 해줘")은 답 자체가 변경 요청이라 오늘도
    // 열린다. 그 외의 답은 앞 요청 없이 아무것도 가리키지 않는다.
    it.each([...CONTINUING_REPLIES.filter((reply) => reply !== "아니 식대는 1200만원으로 해줘"), ...CLOSING_REPLIES])(
      "답 \"%s\" 는 카드 도구를 받지 않는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(prior, reply, stage), stage).toEqual([]);
        }
      },
    );
  });

  it.each(["응 농담이야", "음 고민 중이야", "응 근데 추천해줘"])(
    "직접 변경 요청 뒤에서도 무르는 답 \"%s\" 는 오늘처럼 닫혀 있다",
    (reply) => {
      const prior = DIRECT_CHANGE_ANCHORS[0];
      for (const stage of STAGES) {
        expect(offeredOnOwnTurn(prior, stage).length, stage).toBeGreaterThan(0);
        expect(offeredOnFollowUp(prior, reply, stage), stage).toEqual([]);
        expect(offeredOnFollowUp(prior, reply, stage, false), stage).toEqual([]);
      }
    },
  );

  describe("거절한 답은 앞 요청의 카드 도구를 이어받지 않는다", () => {
    it.each(REFUSING_REPLIES)("거절 \"%s\" 는 U1 뒤에서 카드 도구를 받지 않는다", (reply) => {
      for (const stage of STAGES) {
        expect(offeredOnFollowUp(U1, reply, stage), stage).toEqual([]);
      }
    });

    // 계획 요청 뒤가 아니라 **직접 변경 요청** 뒤의 거절이다. 이어 붙인 문장 자신이
    // 금액·날짜를 품고 있어 그 경로로는 오늘도 도구가 나온다(이 수리 전과 같다).
    // 여기서 고정하는 것은 **닻이 아무것도 더하지 않는다**는 것뿐이다.
    it.each([...REFUSING_REPLIES, ...REFUSING_REPLIES_WITH_OWN_VALUE])(
      "거절 \"%s\" 뒤에서 닻은 아무것도 더하지 않는다",
      (reply) => {
        for (const prior of [...PLANNING_ANCHORS, ...DIRECT_CHANGE_ANCHORS]) {
          for (const stage of STAGES) {
            const label = `${prior} / ${stage}`;
            expect(offeredOnFollowUp(prior, reply, stage), label)
              .toEqual(offeredOnFollowUp(prior, reply, stage, false));
          }
        }
      },
    );

    it.each(CORRECTING_REPLIES)("값을 주는 정정 \"%s\" 는 계속 이어받는다", (reply) => {
      for (const prior of PLANNING_ANCHORS) {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(prior, reply, stage), `${prior} / ${stage}`)
            .toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
        }
      }
    });

    it.each(STATUS_REPORT_REPLIES)(
      "상태 이야기 \"%s\" 뒤에서 닻은 아무것도 더하지 않는다",
      (reply) => {
        for (const prior of [...PLANNING_ANCHORS, ...DIRECT_CHANGE_ANCHORS]) {
          for (const stage of STAGES) {
            const label = `${prior} / ${stage}`;
            expect(offeredOnFollowUp(prior, reply, stage), label)
              .toEqual(offeredOnFollowUp(prior, reply, stage, false));
          }
        }
      },
    );
  });

  it.each(NOT_OUR_DECISION_REPLIES)(
    "우리 말이 아닌 \"%s\" 는 부탁 어형이어도 닻을 이어받지 않는다",
    (reply) => {
      for (const prior of [...PLANNING_ANCHORS, ...DIRECT_CHANGE_ANCHORS]) {
        for (const stage of STAGES) {
          const label = `${prior} / ${stage}`;
          expect(offeredOnFollowUp(prior, reply, stage), label)
            .toEqual(offeredOnFollowUp(prior, reply, stage, false));
        }
      }
    },
  );

  describe.each(MATRIX)("행렬: $bucket ($inherits 이어받음)", ({ inherits, replies }) => {
    it.each(replies)("\"%s\"", (reply) => {
      for (const prior of MATRIX_ANCHORS) {
        for (const stage of STAGES) {
          const label = `${prior} / ${stage}`;
          const before = offeredOnFollowUp(prior, reply, stage, false);
          const after = offeredOnFollowUp(prior, reply, stage);
          if (inherits) {
            // 닻이 자기 턴에 받았던 것을 답도 받는다. 이어 붙인 문장이 이미 같은 도구를
            // 주고 있던 칸도 있으므로 "더 늘었는가" 가 아니라 이것을 잰다.
            expect(after, label).toEqual(expect.arrayContaining(offeredOnOwnTurn(prior, stage)));
          } else {
            expect(after, label).toEqual(before);
          }
        }
      }
    });
  });

  describe("남은 경계: 대상을 말하며 시키는 보류", () => {
    it.each(KNOWN_BOUNDARY_REPLIES.inherits)("\"%s\" 는 (알면서) 이어받는다", (reply) => {
      for (const stage of STAGES) {
        expect(offeredOnFollowUp(U1, reply, stage), stage)
          .toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
      }
    });

    it.each(KNOWN_BOUNDARY_REPLIES.closed)("대상이 없는 \"%s\" 는 닫혀 있다", (reply) => {
      for (const stage of STAGES) {
        expect(offeredOnFollowUp(U1, reply, stage), stage)
          .toEqual(offeredOnFollowUp(U1, reply, stage, false));
      }
    });
  });

  it("더해지는 것은 앞 요청이 이미 받았던 것뿐이고, 오늘 받던 것은 줄지 않는다", () => {
    const anchors = [
      ...PLANNING_ANCHORS,
      ...NO_OFFER_ANCHORS,
      ...DIRECT_CHANGE_ANCHORS,
      "드레스 예산을 450만 원으로 늘리면 남은 예산이 어떻게 돼?",
    ];
    const replies = [
      ...CONTINUING_REPLIES,
      ...CLOSING_REPLIES,
      ...REFUSING_REPLIES,
      ...REFUSING_REPLIES_WITH_OWN_VALUE,
      ...CORRECTING_REPLIES,
      ...STATUS_REPORT_REPLIES,
      ...MATRIX.flatMap((bucket) => [...bucket.replies]),
      "사진 촬영만",
      "2026년으로 넣어줘",
    ];
    let widened = 0;
    for (const prior of anchors) {
      for (const reply of replies) {
        for (const stage of STAGES) {
          const label = `${prior} / ${reply} / ${stage}`;
          const before = offeredOnFollowUp(prior, reply, stage, false);
          const after = offeredOnFollowUp(prior, reply, stage);
          const ceiling = new Set([...before, ...offeredOnOwnTurn(prior, stage)]);
          expect(after, label).toEqual(expect.arrayContaining(before));
          expect(after.filter((name) => !ceiling.has(name)), label).toEqual([]);
          if (after.length > before.length) widened += 1;
        }
      }
    }
    // 불변식이 공허하게 참이 아님을 확인한다 — 실제로 넓어지는 칸이 있어야 한다.
    expect(widened).toBeGreaterThan(0);
  });

  it("닻이 없으면 이어 붙인 문장만 본다(이 수리 전과 같은 입력)", () => {
    for (const stage of STAGES) {
      expect(offeredOnFollowUp(U1, "응", stage, false)).toEqual([]);
      expect(offeredOnFollowUp(U1, "네 반영해줘", stage, false)).toEqual([]);
    }
  });
});
