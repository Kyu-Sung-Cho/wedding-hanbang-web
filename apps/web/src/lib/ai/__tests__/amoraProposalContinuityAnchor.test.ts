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
 *   아모라: (기능이 없다며 예산 화면에서 직접 입력하라고 안내)
 *
 * 라우트는 연속성이 증명된 턴에서 U1 과 답을 이어 붙여 선택기에 넘기는데, 전문분야는
 * 답만 보고 정한다. 답에는 키워드가 없어 관문 해제가 꺼지고, 이어 붙인 문장의 가드가
 * **U1 자신의 "알려줘"** 에 걸렸다.
 *
 * 입력은 라우트가 만드는 모양 그대로다 — 답의 라우팅은 답만으로, 닻의 라우팅은
 * 앞 요청만으로 계산한다.
 *
 * ## 2026-09-18 (1) 관문을 뒤집었다
 *
 * 처음 판(803831b6)은 "무르는 말이 아니면 이어받는다" 였고, 거절 어형을 열거해
 * 막았다. 재검사에서 그 구조가 양쪽으로 틀린 것이 숫자로 나왔다. 지금은 **실행해
 * 달라거나 값을 고쳐 달라는 말일 때만** 이어받는다.
 *
 * ## 2026-09-18 (2) 이어받기를 앞 제안에 **묶었다**
 *
 * 뒤집은 판도 답이 **무엇에 대해** 말하는지는 안 봤다. 그래서 배분표 뒤에서
 * 주제를 바꾸는 부탁이 예산 카드 도구를 그대로 물려받았다 — 재검사 실측:
 *
 *   "상견례 날짜 4월 5일로 잡아줘"  → 일정 도구 0개 + **예산 도구 4개**
 *                                    (그 답만 놓고 고르면 일정 도구 7개다)
 *   "이건 아니야. 그래도 일정은 잡아줘" → 같은 일이 일어났다
 *   "일정은 나중에 잡아줘"·"드레스는 다음에 정해줘"·"다음 주에 적용해줘"
 *                                    → 지금 적용하는 카드를 보류에 내밀었다
 *   "예단은 취소해줘"·"메이크업은 빼줘" → 한 줄을 빼 달라는 말에 `apply_budget_plan`
 *                                    (배분 전체를 반영하는 도구)을 내밀었다
 *
 * 그래서 이어받기에 조건 둘이 붙었다: 답이 **그 제안**을 말하는가(앞 제안에 없던
 * 축을 스스로 가리키면 새 요청이다), 그리고 답에 **무름·보류·한 줄 빼기**가 없는가.
 * 아래 `MATRIX` 주석에 버킷별 전/후 표가 있다.
 *
 * 그 결과로 이 파일의 기대값이 여섯 줄 바뀌었다 — 날짜 정정 둘("아니 10월 18일로
 * 해줘"·"아니 다음 주 화요일로 옮겨줘")과 제거 요청 넷("드레스 투어 일정 취소해줘"·
 * "예약 취소해줘"·"한복은 취소해줘"·"메모는 취소해줘")이 **배분표 뒤에서는** 이어받지
 * 않는다. 같은 문장이 **일정 제안 뒤에서는** 그대로 이어받는 것을 아래
 * `SCHEDULE_PLAN_ANCHOR` 묶음이 함께 잰다 — 닫힌 것은 어형이 아니라 **축이 다른 조합**이다.
 *
 * ## 2026-09-18 (3) 여는 모양을 두 개로 좁혔다 — 무름·보류·빼기·축 목록을 버렸다
 *
 * (2) 판의 닫는 쪽은 전부 낱말 목록이었고 재검사가 목록 밖 어형을 또 찾았다 —
 * "예단 빼고 저장해줘"(`apply_budget_plan` 까지), "이번 주말에 반영해줘"·"상담 끝나고
 * 적용해줘", 그리고 축 비교가 거르개가 아니라 거부권이라 축 하나를 가리킨 답이 앞 제안의
 * 도구 **전부**를 받았다. 이제 이어받는 모양은 둘뿐이고 둘 다 **답 전체**를 대조한다:
 *
 *  - 순수 실행 부탁(승낙어 · 이대로/그대로 · 전부/다 · 실행 동사뿐) → 앞 제안의 도구 전부
 *  - 금액 정정("(아니) (항목은) 금액으로 해줘" 뿐) → 앞 제안의 **예산 카드 도구만**
 *
 * 정정을 남긴 이유는 재서 나왔다 — `EARNS_NOTHING_WITHOUT_ANCHOR` 가 그 숫자를 고정한다.
 * 이 판에서 기대값이 바뀐 줄(전부 **이어받지 않는** 쪽으로)은 `NOT_PURE_ANY_MORE` ·
 * `DATE_CORRECTION_COST` 와 일정·할 일 제안 묶음에 있다.
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
 * **일정** 제안을 낸 앞 요청. 배분표와 같은 모양이지만 축이 다르다 — 키워드(본식·당일)로
 * 본식 진행 경로에 들어가고, "알려줘" 때문에 이어 붙인 문장은 스스로 닫힌다. 그래서
 * 이어받기가 **관찰된다**(닻 없이 0개 → 닻으로 일정 도구 7개).
 */
const SCHEDULE_PLAN_ANCHOR = "본식 당일 일정을 시간대별로 짜서 알려줘";
/** **할 일** 제안을 낸 앞 요청. 일정·할 일 도구 10개를 자기 턴에 받는다. */
const ACTION_PLAN_ANCHOR = "본식 당일 챙길 것 메모해서 알려줘";
/**
 * **여러 축**을 받은 계획 요청 — `예산` 으로 예산 도구, `결혼식` 으로 일정 도구를 받는다(11개).
 * "알려줘" 때문에 이어 붙인 문장은 스스로 닫히므로, 금액 정정이 그 중 무엇을 이어받는지가
 * 그대로 보인다(거르개인가 거부권인가).
 */
const MULTI_AXIS_ANCHOR = "결혼식 예산 배분 짜서 알려줘";

/**
 * 일정 제안 뒤에서 (2) 판까지 이어받던 날짜·값 없는 정정. 2026-09-18 (3) 부터 이어받지 않는다
 * — 날짜는 그 자체가 시각 표현이라 보류와 글자로 가를 수 없다(아래 "치른 값" 테스트).
 */
const DATE_CORRECTION_COST = [
  "아니 10월 18일로 해줘",
  "아니 다음 주 화요일로 옮겨줘",
  "일정 다시 잡아줘",
  "오후 3시로 옮겨줘",
  "스튜디오는 3월 22일로 옮겨줘",
] as const;

/** 앞 요청을 그대로 잇는 실행 부탁·정정. */
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
 * 농담·남에게 보낼 문자·이미 무른 말은 "이대로 적용해줘"·"4천으로 해줘" 를 그대로 품고
 * 있다. (2) 판까지는 관문의 첫 줄(`isNotOurDecision`)이 이것을 졌다. 2026-09-18 (3) 부터는
 * 여는 모양이 **답 전체**를 대조하므로 앞에 붙은 "농담이야"·"엄마한테 보낼 문자야" 가 곧
 * 모양 밖이다 — 그 줄은 할 일이 없어져 걷었고, 이 목록이 그 판단을 잰다.
 */
const NOT_OUR_DECISION_REPLIES = [
  "농담이야 이대로 적용해줘",
  "장난이야 4천으로 해줘",
  "엄마한테 보낼 문자야 4천으로 해줘",
  "아까 말한 거 없던 일로 해줘",
] as const;

/** 앞 요청을 **거절하는** 답. */
const REFUSING_REPLIES = [
  "아니 됐어",
  "아니 하지 마",
  "나중에 할래",
  "취소해줘",
  "안 할래",
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
  // 항목을 말하지만 거절이다.
  "드레스는 나중에 할래",
  // 이 갈래는 `RETRACTION` 이 이미 닫고 있었다. 회귀 여부를 같이 본다.
  "없던 일로 해줘",
] as const;

/**
 * 거절인데 **자기 문장이 금액을 품어** 이어 붙인 문장만으로 예산 경로가 열리는 답.
 *
 * "300만원" 이 키워드로 배분 경로를 열어 `pendingProposalToolNames` 의 관문 해제가
 * 켜지므로, 이 턴은 닻이 없어도 예산 카드 도구가 나온다. 여기서 고정하는 것은
 * **닻이 아무것도 더하지 않는다**는 것이다.
 */
const REFUSING_REPLIES_WITH_OWN_VALUE = ["300만원은 필요 없어"] as const;

/**
 * 거절처럼 생겼지만 **새 금액을 주는** 답 — 예산 카드 도구를 받는다.
 *
 * 2026-09-18(2): 날짜를 주는 정정 둘과 제거 요청 둘이 이 목록에서 빠졌다. 배분표
 * 뒤에서 날짜·일정은 **다른 축**이고, 제거는 값을 주는 말이 아니기 때문이다. 어디로
 * 갔는지는 `OTHER_DOMAIN_REPLIES`·`DROP_REPLIES` 와 `SCHEDULE_PLAN_ANCHOR` 묶음에 있다.
 * 2026-09-18 (3): 무름·빼기가 섞인 둘이 더 빠졌다(`NOT_PURE_ANY_MORE`).
 */
const CORRECTING_REPLIES = [
  "아니 3천으로 바꿔줘",
  "그건 아니야, 4천으로 해줘",
  "드레스는 300으로 해줘",
  // 이 줄은 정정 모양 밖이다(무름 절이 섞였다). 이어받지 않지만 `식대` 가 키워드로 배분
  // 경로를 열어 자기 문장으로 받는다 — 결과가 같은지 여기서 함께 본다.
  "아니 그건 하지 말고 식대는 1200만원으로 올려줘",
] as const;

/**
 * 2026-09-18 (3) 사전 측정 — 같은 축 정정은 **닻 없이** 맞는 카드 도구를 받는가.
 *
 * 받는다면 정정 갈래는 필요 없다. 재 보니 앞의 둘은 배분표 뒤에서 세 단계 모두 0개였다
 * (이어 붙인 문장이 앞 요청의 "알려줘" 에 걸린다). 셋째만 `총예산` 키워드로 스스로 받는다.
 * 그래서 금액 정정 갈래를 남겼고, 이 표가 그 근거를 고정한다 — 둘째 열이 4 로 바뀌면
 * 정정 갈래를 걷어낼 수 있다는 뜻이다.
 */
const EARNS_NOTHING_WITHOUT_ANCHOR = [
  ["아니 4천으로 해줘", 0],
  ["드레스는 300으로 해줘", 0],
  ["총예산 3500으로 해줘", 4],
] as const;

/**
 * 2026-09-18 (2) 판까지 이어받던 정정·실행 부탁 중 **모양 밖**이라 이제 이어받지 않는 답.
 *
 * 무름("하지 말고")·빼기("취소하고")가 섞였거나, 새 금액이 없거나("좀 줄여줘"), 다른
 * 동사가 붙었다("그리고 일정도 잡아줘"). 닫힌 답은 이어 붙인 문장이 스스로 받는 것만
 * 받는다 — 배분표 뒤에서는 0개이고, 그것이 이 판이 치른 값이다. 이 답들을 다시 열려면
 * 목록을 늘려야 하는데, 그 구조가 네 번의 재검사에서 양쪽으로 샜다.
 */
const NOT_PURE_ANY_MORE = [
  "아니 드레스는 하지 말고 스튜디오로 해줘",
  "아니 그건 취소하고 4천으로 해줘",
  "그건 취소해줘 그리고 4천으로 해줘",
  "예단 좀 줄여줘",
  "한복 좀 늘려줘",
  "예약 시간 옮겨줘",
  "응 적용해줘 그리고 일정도 잡아줘",
  // 방향만 정하는 동사(줄여·늘려·옮겨)는 제안을 **바꾸라는** 말이지 그대로 실행하라는 말이
  // 아니다. 맨 "할게" 는 사용자가 하겠다는 인정이다. 둘 다 (2) 판에서는 실행 부탁 동사였다.
  "응 줄여줘",
  "좀 늘려줘",
  "응 옮겨줘",
  "그렇게 할게",
] as const;

/**
 * 거절 낱말을 품었지만 거절도 아닌 말 — **상태 이야기**다. 실행 부탁도 정정도 아니라
 * 이어받지 않고, 닫힌 답은 이어 붙인 문장이 스스로 받는 것만 받는다.
 */
const STATUS_REPORT_REPLIES = [
  "잘 됐어",
  "거의 다 됐어",
  "안 됐어",
  "그만큼이면 충분해",
  // 사양이 아니라 되묻는 말.
  "그건 괜찮아?",
] as const;

/**
 * **다른 축**을 스스로 가리키는 답. 배분표 뒤에서는 이어받지 않는다.
 *
 * 앞 넷은 일정 축(날짜·일정·투어)이고 마지막은 할 일 축이다. (2) 판에서는 같은 문장이 그
 * 축의 제안 뒤에서 이어받았다. 2026-09-18 (3) 부터는 금액 정정이 아니라서 **어느 제안
 * 뒤에서도** 이어받지 않는다 — `DATE_CORRECTION_COST` 와 일정·할 일 제안 묶음이 잰다.
 */
const OTHER_DOMAIN_REPLIES = [
  "아니 10월 18일로 해줘",
  "아니 다음 주 화요일로 옮겨줘",
  "스튜디오는 3월 22일로 옮겨줘",
  "드레스 투어는 다음 주 토요일로 잡아줘",
  "일정 다시 잡아줘",
  "리마인드 설정해줘",
  "메모는 다시 기록해줘",
] as const;

/**
 * 제안의 **한 줄을 빼 달라는** 답. 새 값이 없으므로 정정이 아니다.
 *
 * `apply_budget_plan` 은 배분 **전체**를 반영하는 도구다. 한 항목을 빼 달라는 말에
 * 그것을 내미는 것이라 방향이 반대다(2026-09-18 재검사).
 */
const DROP_REPLIES = [
  "예단은 취소해줘",
  "메이크업은 빼줘",
  "한복은 취소해줘",
  "메모는 취소해줘",
  "드레스 투어 일정 취소해줘",
  "예약 취소해줘",
  "그 항목은 지워줘",
  "일단 빼줘",
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
 * 같은 선택기로 같은 입력을 재서(어형마다 앞 요청 2개 × 단계 3개 = 6칸) 남긴 숫자.
 * 닻이 **더한** 칸/도구/어형이고, "전" 은 2026-09-18 첫 판(이어받기를 뒤집은 판),
 * "후" 는 앞 제안에 묶은 판이다. 앞 요청은 U1(배분표 계획)과 직접 변경 요청 둘이다.
 *
 *   버킷              어형   칸    전               후
 *   거절·보류          65    390   0/0/0            0/0/0
 *   인정·감사          27    162   0/0/0            0/0/0
 *   물음              10     60   0/0/0            0/0/0
 *   딴 이야기           7     42   0/0/0            0/0/0
 *   실행 부탁          22    132   66/264/22        66/264/22   ← 한 칸도 줄지 않았다
 *   정정              10     60   12/48/4           6/24/2
 *   주제 전환 부탁       8     48   21/84/7           0/0/0
 *   보류·빼기 부탁      16     96   15/60/5           0/0/0
 *
 * 실행 부탁 132칸은 전후 모두 **닻이 자기 턴에 받았던 것을 답도 받는다**(132/132).
 * 정정에서 닫힌 둘은 "스튜디오는 3월 22일로 옮겨줘"·"드레스 투어는 다음 주 토요일로
 * 잡아줘" — 배분표 뒤의 **일정** 정정이다. 그 둘은 일정 제안 뒤에서는 그대로 열린다.
 *
 * 함께 잰 변형 하나를 **쓰지 않았다**: "답이 키워드로 다른 전문분야에 걸리면 닫는다".
 * `SPECIALIST_KEYWORDS` 가 예단·예물·폐백·부케·답례품·축가를 상견례/본식 쪽에 두는데
 * 그 낱말들은 동시에 배분표의 항목 이름이라, 그 변형은 같은 축 정정을 닫았다
 * (실측: 지금 관문이 더하는 9칸이 사라졌고 — "예단은 300으로 해줘"·"예물은 500으로
 * 해줘" 각 4칸 — 반대로 새로 막히는 누출은 0칸이었다).
 *
 * ## 2026-09-18 (3) 재측정 — 순수 실행 부탁과 금액 정정만 더한다
 *
 * 앞 라운드들의 어형을 모아 다시 쟀다(앞 요청 U1·직접 변경 × 단계 3개). "전" 은 2f19b811
 * (축에 묶은 (2) 판), "후" 는 이 판이다. 닻이 **더한** 칸/도구/어형:
 *
 *   버킷                 어형   칸    전               후
 *   순수 실행 부탁         70    420   195/780/65       210/840/70    ← 420/420 앞 요청 몫을 덮는다
 *   실행 부탁 + 다른 말      8     48     3/12/1          0/0/0
 *   거절                 142    852     0/0/0           0/0/0
 *   보류(시각)             48    288     3/12/1          0/0/0
 *   빼기                  35    210    33/132/11        0/0/0
 *   주제 전환              17    102     0/0/0           0/0/0
 *   인정·감사              54    324     0/0/0           0/0/0
 *   물음                  41    246    15/84/4          0/0/0
 *   정정                  34    204    36/168/11       24/96/7       ← 더한 것은 전부 예산 카드 도구
 *   남의 말                13     78     9/60/2          0/0/0
 *   개인 레인(위 전부)      —   2874     6칸             0칸
 *
 * 일정·할 일 제안을 앞 요청으로 두면 (2) 판의 누출이 훨씬 컸다 — 같은 버킷에서 보류 30칸
 * ("이번 주말에 반영해줘"·"상담 끝나고 적용해줘"), 주제 전환 51칸, 빼기 66칸, 정정 60칸,
 * 개인 레인 36칸. 이 판에서는 순수 실행 부탁 420칸 말고는 전부 0칸이다. 그래서 아래
 * `MATRIX_ANCHORS` 에 그 둘과 여러 축 제안을 더했다.
 *
 * 정정에서 닫힌 넷("아니 그건 취소하고 4천으로 해줘"·"그건 취소해줘 그리고 4천으로 해줘"·
 * "예단 좀 줄여줘"·"한복 좀 늘려줘")은 `NOT_PURE_ANY_MORE` 에 치른 값으로 적어 둔다.
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
      // 2026-09-18 재검사가 더 보내온 어형.
      "아니요", "아냐 하지 마", "하지 마세요", "됐어요", "괜찮아 안 해도 돼",
      "그건 아니야", "그거 취소해줘", "적용하지 마", "넣지 마", "그렇게는 하지 마",
      "그건 말고", "그건 아닌 것 같아", "일단 넘어가자", "나중에 할게", "이따 할게",
      "주말에 다시 보자", "생각 좀 해볼게", "배우자랑 상의해보고 말할게",
      "남편이랑 얘기해보고 정할게", "엄마한테 물어보고 할게", "잠깐만", "잠시만요",
      "조금만 기다려줘", "안 해도 될 듯", "필요 없을 것 같아", "지금은 좀 그래",
      "패스", "스킵할게", "이번엔 넘어갈게", "음 좀 아닌 듯", "별로야", "마음에 안 들어",
      "다시 짜줄 필요는 없어", "이건 내가 직접 할게", "내가 앱에서 넣을게",
      "내가 알아서 할게", "그냥 참고만 할게", "참고만 하려고", "아직 확정 아니야",
      "미정이야", "확정 아니니까 저장은 하지 말아줘", "일단 저장은 하지 말고 놔둬",
      "꼭 해야 해?", "안 하면 안 돼?", "다른 방법 없어?",
      // 대상을 말하지 않는 제거·보류.
      "그건 빼줘", "예산은 그대로 놔둬",
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
      "정말 고마워", "알겠습니다", "오키", "ㅇㅇ", "좋아요",
      "괜찮네", "이해했어", "참고할게", "도움 됐어", "수고했어", "역시 최고야",
    ],
  },
  {
    bucket: "실행 부탁",
    inherits: "all",
    replies: [
      "응 적용해줘", "네 반영해줘", "그래 저장해줘", "좋아 등록해줘", "맞아 그렇게 해줘",
      "이대로 반영해줘", "이대로 적용해줘", "그렇게 해줘", "응 넣어줘", "응 바꿔줘",
      "좋아, 이대로 적용해줘", "네 그렇게 해줘", "응 그대로 저장해줘", "응 적용 부탁해",
      "응 그렇게 적용해", "네 저장해주세요", "이대로 진행해줘", "그대로 반영해줘",
      "응 등록해줘", "오케이 적용해줘", "ㅇㅋ 반영해줘", "응 적용해줘 ㅎㅎ",
      "그래 그렇게 해줘", "응 반영 부탁해", "넵 적용해주세요", "좋아 저장해줘",
      // 내용 없는 부사(그냥·좀)는 새 대상도 값도 아니다. 지시어 앞에도 뒤에도 온다.
      "이대로 그냥 반영해줘", "그냥 적용해줘", "그냥 이대로 적용해줘",
      "응 저장해줘", "네 등록해줘", "그거로 해줘", "제안대로 진행해줘", "반영 부탁해",
      "네 그대로 저장 부탁해", "응 확정해줘", "응 배분해줘", "이대로 기록해줘",
      "그렇게 잡아줘", "응 진행해줘", "그대로 하자",
      // 2026-09-18 (3): 전부/다 — 제안 **전체**를 가리키는 말이라 순수 실행 부탁이다.
      "전부 반영해줘", "다 적용해줘", "응 전부 다 반영해줘", "이대로 전부 적용해줘",
    ],
  },
  {
    // 실행 부탁에 **다른 말**이 붙은 답. 2026-09-18 (3) 부터 순수 모양 밖이라 이어받지 않는다.
    // 첫 줄은 D1 라이브 대화의 가운데 발화 그대로인데, `예산` 이 키워드로 배분 경로를 열어
    // **자기 문장으로** 같은 카드 도구를 받는다(아래 별도 테스트가 잰다). 나머지는 이번
    // 재검사가 보낸 모양 — 뒤에 빼기·시각이 붙은 실행 부탁이다.
    bucket: "실행 부탁 + 다른 말",
    inherits: false,
    replies: [
      "응, 이대로 실제 예산에 반영해줘.", "응 적용해줘 그리고 일정도 잡아줘",
      "응 적용해줘 예단 빼고", "좋아 이대로 적용해줘 상담 끝나고", "응 반영해줘 다음 주에",
      "이대로 적용하고 일정도 잡아줘", "응 적용해줘 그리고 예단은 빼줘",
      // 앞은 남의 말이다 — 뒤 절만 보면 실행 부탁이다.
      "친구는 이대로 했대 응 적용해줘", "엄마가 이대로 하라는데 적용해줘",
    ],
  },
  {
    // 금액 정정은 앞 제안의 **예산 카드 도구만** 받는다(거르개). 앞 제안이 예산 도구와
    // 일정 도구를 함께 받았어도 일정 도구는 오지 않는다 — 직접 변경 요청 닻("결혼식장 예산 …")
    // 이 바로 그 경우다(`결혼식` 때문에 일정 도구까지 받는다).
    bucket: "금액 정정",
    inherits: "budget",
    replies: [
      "아니 4천으로 해줘", "드레스는 300으로 해줘", "아니 3천으로 바꿔줘",
      "아니 식대는 1200만원으로 해줘", "총예산 3500으로 해줘",
      "스튜디오는 400만원으로 잡아줘", "총예산은 4500만원으로 바꿔줘",
      "식대만 1500만원으로 올려줘", "총예산은 6천으로 맞춰줘",
      "메이크업 예산 100만원으로 내려줘", "아니 3천5백만원으로 바꿔줘",
      "아니 총예산 4천만원으로 맞춰줘", "스튜디오는 250만원으로 낮춰줘",
      // **항목 이름이 다른 전문분야 키워드인** 정정. 배분표의 항목 이름이므로 금액 정정이다.
      "예단은 300으로 해줘", "예물은 500으로 해줘", "폐백은 100만원으로 해줘",
      "축가는 30만원으로 해줘", "부케는 20만원으로 해줘", "답례품은 200만원으로 해줘",
      // 앞 절이 무름이어도 바로 새 금액이 오면 정정이다("아니 4천으로 해줘" 와 같은 말).
      // 직접 변경 요청 뒤에서는 이어 붙인 문장이 이 "아니야" 에 걸려 0개라, 닻이 더하는
      // 것이 **예산 도구 4개뿐**인지(앞 제안의 12개가 아니라) 이 줄이 잰다.
      "그건 아니야, 4천으로 해줘",
      // 아래 셋은 정정 **모양 밖**(값 뒤에 동사가 앞선다·앞 절이 붙었다·사람 수)이지만
      // 자기 문장이 키워드로 배분 경로를 열어 같은 도구를 받는다. 결과만 본다.
      "예단은 좀 줄여줘 500만원으로", "그건 그대로 두고 드레스만 400만원으로 고쳐줘",
      "하객은 120명으로 해줘",
    ],
  },
  {
    // 2026-09-18 (2) 판까지 정정·실행 부탁으로 이어받던 것 중 모양 밖인 답(`NOT_PURE_ANY_MORE`).
    bucket: "모양 밖 — 이제 이어받지 않는다",
    inherits: false,
    replies: [...NOT_PURE_ANY_MORE],
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
      "왜 그렇게 나눴어?", "이게 최선이야?", "다른 안도 있어?", "식대는 왜 이렇게 많아?",
      "총합이 얼마야?", "남은 예산은 얼마야?", "이거 나중에 바꿀 수 있어?",
      "다른 커플은 보통 어떻게 해?", "하객이 늘면 어떻게 돼?", "이게 평균이야?",
      // 2026-09-18 (3): 부탁 어형에 물음표만 붙은 답. (2) 판은 정정 갈래로 이것들을 열었다.
      "이대로 적용해줘?", "4천으로 해줘?", "예단은 300으로 해줘?", "총예산 4천으로 바꿔줘?",
      "이대로 적용해줘? 아니면 다시 짜줘?",
    ],
  },
  {
    // 제안과 상관없는 이야기로 넘어간 답. 부탁 어형이 아니어서 관문에 닿지도 않는다.
    bucket: "딴 이야기",
    inherits: false,
    replies: [
      "근데 오늘 날씨 어때?", "점심 뭐 먹지", "회사 일이 너무 바빠", "요즘 잠을 잘 못 자",
      "시어머니가 계속 전화해", "청첩장은 어디서 만들어?", "신혼여행 어디가 좋아?",
    ],
  },
  {
    // 2026-09-18 재검사의 첫 번째 누출. 부탁 어형이지만 **다른 축의 새 요청**이다.
    // 8가지 중 7가지가 예산 카드 도구 4개를 받고 있었다.
    bucket: "주제 전환 부탁",
    inherits: false,
    replies: [
      "드레스 투어는 다음 주 토요일로 잡아줘", "청첩장 문구 다시 써줘", "신혼여행 일정 잡아줘",
      "상견례 날짜 4월 5일로 잡아줘", "웨딩홀 상담 일정 추가해줘", "체크리스트에 예단 준비 넣어줘",
      "스튜디오 촬영 일정 옮겨줘", "할 일에 청첩장 주문 추가해줘",
      // 앞 절이 무름이고 뒤 절이 다른 축의 부탁이다.
      "이건 아니야. 그래도 일정은 잡아줘",
    ],
  },
  {
    // 2026-09-18 재검사의 두 번째 누출. 16가지 중 5가지가 받고 있었다 — 그중
    // "다음 주에 적용해줘" 는 **적용 자체를 미루는 말**인데 지금 적용하는 카드를 받았고,
    // "예단은 취소해줘"·"메이크업은 빼줘" 는 한 줄을 빼 달라는 말인데 배분 전체를
    // 반영하는 `apply_budget_plan` 을 받았다.
    bucket: "보류·빼기 부탁",
    inherits: false,
    replies: [
      "일정은 나중에 잡아줘", "드레스는 다음에 정해줘", "예산은 나중에 반영해줘",
      "식대는 일단 놔두고 나중에 바꿔줘", "그건 내일 반영해줘", "다음 주에 적용해줘",
      "상의하고 나서 저장해줘", "확정되면 반영해줘", "일단 빼줘", "그 항목은 지워줘",
      "예단은 취소해줘", "메이크업은 빼줘", "총예산은 그대로 두고 나중에 해줘",
      "지금은 말고 나중에 적용해줘", "나중에 적용 부탁해", "확정되면 적용 부탁해",
      // 2026-09-18 (3): 보류 목록에 없던 시각. 앞의 셋은 재검사가 보낸 그대로다.
      "상견례 끝나고 적용해줘", "이번 주말에 반영해줘", "상담 끝나고 적용해줘",
      "주말에 적용해줘", "저녁에 반영해줘", "퇴근하고 저장해줘", "월요일에 적용해줘",
      "투어 다녀와서 적용해줘", "이번 주 안에 반영해줘", "견적 나오면 적용해줘",
      "신랑 오면 적용해줘", "한 달 뒤에 반영해줘",
    ],
  },
  {
    // 2026-09-18 (3): 금액 정정 모양에 **다른 말**이 붙은 답. 금액이 있어도 시각·무름·빼기·
    // 목록 밖 대상이 섞이면 정정이 아니다 — 정정 갈래가 답 전체를 대조하는지 이 버킷이 잰다.
    // (2) 판은 이 중 넷("나중에 4천으로 해줘"·"내일은 4천으로 해줘"·"예단 빼고 4천으로
    // 맞춰줘"·"하지 말고 4천으로 해줘")을 배분표 뒤에서 열었다 — 보류·빼기 목록에 안 걸렸다.
    bucket: "금액 + 다른 말",
    inherits: false,
    replies: [
      "나중에 4천으로 해줘", "다음 주에 4천으로 바꿔줘", "내일은 4천으로 해줘",
      "예단 빼고 4천으로 맞춰줘", "하지 말고 4천으로 해줘", "4천으로 해줘 나중에",
      "4천으로 하지 마", "상담 끝나고 300으로 해줘",
    ],
  },
  {
    // 2026-09-18 (3): **동사가 떨어진 빼기**. 뒤 절이 실행 부탁이라 (2) 판은 이것들을 열었고,
    // 배분 전체를 반영하는 `apply_budget_plan` 까지 받았다 — 11가지 전부, 배분표 뒤 세 단계.
    bucket: "빼고 실행",
    inherits: false,
    replies: [
      "예단 빼고 저장해줘", "예단 빼고 반영해줘", "메이크업 제외하고 적용해줘",
      "한복 빼고 이대로 적용해줘", "스냅 없이 반영해줘", "예단 말고 나머지만 반영해줘",
      "예단만 빼고 그대로 적용해줘", "예단은 빼고 적용해줘", "예단 빼서 반영해줘",
      "예단 제외해서 적용해줘", "예단 없는 걸로 반영해줘", "폐백 지우고 저장해줘",
      "부케 없애고 적용해줘", "축가 취소하고 반영해줘",
    ],
  },
  {
    // 값 없이 항목만 빼 달라는 말. 2026-09-18(1) 판에서는 "무엇을 말했으니 정정" 으로
    // 읽어 이어받고 있었다. 같은 문장이 그 축의 제안 뒤에서 어떻게 되는지는
    // `SCHEDULE_PLAN_ANCHOR` 묶음이 함께 적어 둔다.
    bucket: "한 줄 빼기",
    inherits: false,
    replies: [
      "한복은 취소해줘", "메모는 취소해줘", "드레스 투어 일정 취소해줘", "예약 취소해줘",
    ],
  },
  {
    // 값은 있지만 **축이 다른** 정정. 배분표 뒤에서 날짜·일정·할 일은 새 요청이다.
    bucket: "다른 축 정정",
    inherits: false,
    replies: [
      "아니 10월 18일로 해줘", "아니 다음 주 화요일로 옮겨줘", "스튜디오는 3월 22일로 옮겨줘",
      "일정 다시 잡아줘", "리마인드 설정해줘", "메모는 다시 기록해줘",
    ],
  },
] as const;

/**
 * 행렬을 재는 앞 요청 — 키워드로 배분 경로에 들어간 계획 요청과 직접 변경 요청, 그리고
 * 2026-09-18 (3) 부터 일정·할 일·여러 축 제안. 앞의 둘만 재면 (2) 판의 시각 보류
 * ("이번 주말에 반영해줘")·축 거부권은 보이지 않았다 — 그 누출은 일정·할 일 제안 뒤에서 났다.
 */
const MATRIX_ANCHORS = [
  U1,
  DIRECT_CHANGE_ANCHORS[0],
  SCHEDULE_PLAN_ANCHOR,
  ACTION_PLAN_ANCHOR,
  MULTI_AXIS_ANCHOR,
] as const;

function anchorFor(prior: string, reply: string, stage: StageTag): AmoraProposalContinuityAnchor {
  return {
    priorUserText: prior,
    priorSpecialistType: routeSpecialist(prior, stage),
    priorSpecialistMatchedByKeyword: matchedSpecialistByKeyword(prior),
    replyText: reply,
  };
}

/** 라우트의 후속 턴 호출. `withAnchor=false` 는 닻이 없던 때와 같은 입력이다. */
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

/** 앞 요청(또는 답)이 **혼자** 받는 제안 도구. */
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
    // 금액·날짜를 품고 있어 그 경로로는 오늘도 도구가 나온다.
    // 여기서 고정하는 것은 **닻이 아무것도 더하지 않는다**는 것뿐이다.
    it.each([...REFUSING_REPLIES, ...REFUSING_REPLIES_WITH_OWN_VALUE, ...DROP_REPLIES])(
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

    it.each(CORRECTING_REPLIES)("금액을 주는 정정 \"%s\" 는 예산 카드 도구를 받는다", (reply) => {
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

  describe.each(MATRIX)("행렬: $bucket (이어받음: $inherits)", ({ inherits, replies }) => {
    it.each(replies)("\"%s\"", (reply) => {
      for (const prior of MATRIX_ANCHORS) {
        for (const stage of STAGES) {
          const label = `${prior} / ${stage}`;
          const before = offeredOnFollowUp(prior, reply, stage, false);
          const after = offeredOnFollowUp(prior, reply, stage);
          const own = offeredOnOwnTurn(prior, stage);
          if (inherits === "all") {
            // 닻이 자기 턴에 받았던 것을 답도 받는다. 이어 붙인 문장이 이미 같은 도구를
            // 주고 있던 칸도 있으므로 "더 늘었는가" 가 아니라 이것을 잰다.
            expect(after, label).toEqual(expect.arrayContaining(own));
          } else if (inherits === "budget") {
            // 앞 제안의 예산 카드 도구는 받고, 닻이 **더한 것**은 예산 카드 도구뿐이다.
            // 앞 제안에 예산 도구가 없으면(일정·할 일 제안) 아무것도 더하지 않는다.
            const ownBudget = own.filter((name) => (BUDGET_CARD_TOOLS as readonly string[]).includes(name));
            expect(after, label).toEqual(expect.arrayContaining(ownBudget));
            const added = after.filter((name) => !before.includes(name));
            expect(added.filter((name) => !(BUDGET_CARD_TOOLS as readonly string[]).includes(name)), label)
              .toEqual([]);
          } else {
            expect(after, label).toEqual(before);
          }
        }
      }
    });
  });

  /**
   * **이어받는 양은 답의 모양이 정한다** — 순수 실행 부탁은 앞 제안 전부, 금액 정정은 그 중
   * 예산 카드 도구만, 나머지는 아무것도.
   *
   * 2026-09-18 (2) 판의 이 묶음은 "축은 앞 제안이 정한다" 였다 — 답이 앞 제안에 있던 축을
   * 가리키면 열었다. 그 비교는 거르개가 아니라 거부권이었고(축 하나가 맞으면 앞 제안 **전부**),
   * 날짜·일정·할 일 어휘로 연 정정은 시각 보류("이번 주말에 반영해줘")와 글자로 가를 수
   * 없었다. 그래서 날짜 정정과 값 없는 정정은 이제 어느 제안 뒤에서도 이어받지 않는다.
   */
  describe("일정·할 일 제안 뒤: 순수 실행 부탁만 이어받는다", () => {
    it.each(STAGES)("일정 계획 요청은 자기 턴에 일정 도구를 받고, 이어 붙인 문장은 스스로 닫힌다 (%s)", (stage) => {
      expect(matchedSpecialistByKeyword(SCHEDULE_PLAN_ANCHOR)).toBe(true);
      expect(routeSpecialist(SCHEDULE_PLAN_ANCHOR, stage)).toBe("ceremony_coordinator");
      expect(offeredOnOwnTurn(SCHEDULE_PLAN_ANCHOR, stage)).toEqual(
        expect.arrayContaining(["add_schedule_event", "update_schedule_event", "cancel_schedule_event"]),
      );
      expect(offeredOnOwnTurn(SCHEDULE_PLAN_ANCHOR, stage)).not.toEqual(
        expect.arrayContaining([...BUDGET_CARD_TOOLS]),
      );
      expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, "응 적용해줘", stage, false)).toEqual([]);
    });

    it.each(["응 적용해줘", "이대로 반영해줘", "그대로 저장해줘", "네 진행해줘"])(
      "일정 제안 뒤의 순수 실행 부탁 \"%s\" 는 일정 도구를 이어받는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage, false), stage).toEqual([]);
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage), stage)
            .toEqual(expect.arrayContaining(offeredOnOwnTurn(SCHEDULE_PLAN_ANCHOR, stage)));
        }
      },
    );

    /**
     * 이 판이 **치른 값**. 일정 제안 뒤의 날짜 정정·값 없는 정정은 더는 이어받지 않는다 —
     * 이어 붙인 문장이 앞 요청의 "알려줘" 에 걸려 0개이고, 닻이 없던 `main` 과 같은 상태다.
     * 다시 열려면 "다음 주 화요일로 옮겨줘"(새 값)와 "다음 주에 적용해줘"(보류)를 글자로
     * 갈라야 하는데, 그것이 네 번의 재검사에서 양쪽으로 샌 목록이다.
     */
    it.each(DATE_CORRECTION_COST)(
      "일정 제안 뒤의 날짜·값 없는 정정 \"%s\" 는 이어받지 않는다(치른 값 — main 과 같다)",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage, false), stage).toEqual([]);
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage), stage).toEqual([]);
        }
      },
    );

    // 치른 값의 출구: 대상을 말한 날짜 정정은 **자기 문장으로** 일정 도구를 받는다.
    it.each(["본식 일정 10월 18일로 옮겨줘", "본식 일정 오후 3시로 옮겨줘"])(
      "대상을 말한 날짜 정정 \"%s\" 는 닻 없이도 일정 도구를 받는다",
      (reply) => {
        for (const stage of STAGES) {
          const before = offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage, false);
          expect(before, stage).toEqual(expect.arrayContaining(["update_schedule_event"]));
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage), stage).toEqual(before);
        }
      },
    );

    // 앞 제안에 예산 도구가 없으면 금액 정정은 아무것도 받지 않는다 — (2) 판은 여기서
    // "드레스는 300으로 해줘" 에 **일정** 도구를 줬다(단위 없는 금액이 어느 축도 아니라서).
    it.each(["아니 4천으로 해줘", "총예산은 6천으로 맞춰줘", "메이크업 예산 100만원으로 내려줘", "드레스는 300으로 해줘"])(
      "일정 제안 뒤의 금액 정정 \"%s\" 는 이어받지 않는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage), stage)
            .toEqual(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage, false));
        }
      },
    );

    it.each(["응 적용해줘", "그대로 저장해줘"])(
      "할 일 제안 뒤의 순수 실행 부탁 \"%s\" 는 일정·할 일 도구를 이어받는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnOwnTurn(ACTION_PLAN_ANCHOR, stage), stage)
            .toEqual(expect.arrayContaining(["add_amora_action", "update_amora_action"]));
          expect(offeredOnFollowUp(ACTION_PLAN_ANCHOR, reply, stage, false), stage).toEqual([]);
          expect(offeredOnFollowUp(ACTION_PLAN_ANCHOR, reply, stage), stage)
            .toEqual(expect.arrayContaining(offeredOnOwnTurn(ACTION_PLAN_ANCHOR, stage)));
        }
      },
    );

    /**
     * 2026-09-18 (3) 재검사의 두 번째 막힘: 할 일 제안(일정·할 일 도구 10개) 뒤의 상견례 날짜
     * 답이 앞 제안 **전부**를 받았다 — 답은 일정을 말했을 뿐인데 할 일 도구까지 따라왔다.
     * 지금은 둘 다 아무것도 이어받지 않는다(앞의 셋은 (2) 판에서 열리던 값 없는 정정이다).
     */
    it.each(["메모는 다시 기록해줘", "리마인드 설정해줘", "일정 다시 잡아줘", "상견례 날짜 4월 5일로 잡아줘", "상견례는 4월 5일로 잡아줘"])(
      "할 일 제안 뒤의 \"%s\" 는 이어받지 않는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(ACTION_PLAN_ANCHOR, reply, stage), stage)
            .toEqual(offeredOnFollowUp(ACTION_PLAN_ANCHOR, reply, stage, false));
        }
      },
    );

    /**
     * (2) 판이 **치른 값**이고 이 판에서도 그대로다. 값 없는 제거 요청은 같은 축의 제안
     * 뒤에서도 닻을 이어받지 않는다. 그 답은 자기 어휘로 일정 도구를 받지만(아래 첫
     * 기대값), 이어 붙인 문장이 앞 요청의 "알려줘" 에 걸려 닫히는 턴에서는 카드가 0개가
     * 된다 — `main` 과 같은 상태다.
     */
    it.each(["드레스 투어 일정 취소해줘", "일정 취소해줘"])(
      "값 없는 제거 \"%s\" 는 일정 제안 뒤에서도 이어받지 않는다(치른 값)",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnOwnTurn(reply, stage).length, stage).toBeGreaterThan(0);
          expect(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage), stage)
            .toEqual(offeredOnFollowUp(SCHEDULE_PLAN_ANCHOR, reply, stage, false));
        }
      },
    );
  });

  /**
   * **금액 정정은 거르개다.** 앞 제안이 예산 도구와 일정 도구를 함께 받았어도 금액 정정은
   * 예산 카드 도구만 받는다. (2) 판의 축 비교는 거부권이라, 답이 가리킨 축이 앞 제안에
   * 하나라도 있으면 앞 제안 **전부**를 넘겨줬다.
   */
  describe("금액 정정은 앞 제안의 예산 카드 도구만 받는다", () => {
    it.each(STAGES)("여러 축을 받은 앞 요청은 예산·일정 도구를 받고, 이어 붙인 문장은 스스로 닫힌다 (%s)", (stage) => {
      const own = offeredOnOwnTurn(MULTI_AXIS_ANCHOR, stage);
      expect(own).toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
      expect(own).toEqual(expect.arrayContaining(["add_schedule_event", "update_wedding_date"]));
      expect(offeredOnFollowUp(MULTI_AXIS_ANCHOR, "아니 4천으로 해줘", stage, false)).toEqual([]);
    });

    it.each(["아니 4천으로 해줘", "드레스는 300으로 해줘", "아니 3천으로 바꿔줘", "그건 아니야, 4천으로 해줘"])(
      "금액 정정 \"%s\" 는 예산 카드 도구만 받는다",
      (reply) => {
        for (const stage of STAGES) {
          expect([...offeredOnFollowUp(MULTI_AXIS_ANCHOR, reply, stage)].sort(), stage)
            .toEqual([...BUDGET_CARD_TOOLS].sort());
        }
      },
    );

    it.each(["응 적용해줘", "이대로 반영해줘", "전부 반영해줘"])(
      "같은 앞 요청 뒤의 순수 실행 부탁 \"%s\" 는 앞 제안 전부를 받는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(MULTI_AXIS_ANCHOR, reply, stage), stage)
            .toEqual(expect.arrayContaining(offeredOnOwnTurn(MULTI_AXIS_ANCHOR, stage)));
        }
      },
    );
  });

  describe("2026-09-18 (3) 사전 측정: 같은 축 정정은 닻 없이 받지 못한다", () => {
    it.each(EARNS_NOTHING_WITHOUT_ANCHOR)(
      "\"%s\" 는 배분표 뒤에서 닻 없이 %i개를 받고, 닻과 함께 예산 카드 도구를 받는다",
      (reply, withoutAnchor) => {
        for (const stage of STAGES) {
          expect(offeredOnOwnTurn(U1, stage).length, stage).toBe(4);
          expect(offeredOnFollowUp(U1, reply, stage, false).length, stage).toBe(withoutAnchor);
          expect([...offeredOnFollowUp(U1, reply, stage)].sort(), stage).toEqual([...BUDGET_CARD_TOOLS].sort());
        }
      },
    );
  });

  it("더해지는 것은 앞 요청이 이미 받았던 것뿐이고, 오늘 받던 것은 줄지 않는다", () => {
    const anchors = [
      ...PLANNING_ANCHORS,
      ...NO_OFFER_ANCHORS,
      ...DIRECT_CHANGE_ANCHORS,
      SCHEDULE_PLAN_ANCHOR,
      ACTION_PLAN_ANCHOR,
      MULTI_AXIS_ANCHOR,
      "드레스 예산을 450만 원으로 늘리면 남은 예산이 어떻게 돼?",
    ];
    const replies = [
      ...CONTINUING_REPLIES,
      ...CLOSING_REPLIES,
      ...REFUSING_REPLIES,
      ...REFUSING_REPLIES_WITH_OWN_VALUE,
      ...CORRECTING_REPLIES,
      ...STATUS_REPORT_REPLIES,
      ...OTHER_DOMAIN_REPLIES,
      ...DROP_REPLIES,
      ...DATE_CORRECTION_COST,
      ...EARNS_NOTHING_WITHOUT_ANCHOR.map(([reply]) => reply),
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
