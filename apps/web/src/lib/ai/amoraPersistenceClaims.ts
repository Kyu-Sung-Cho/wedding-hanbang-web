import type { ToolExecutionResult } from "@/types/database.types";

import { guardDemoPersistenceDisclosure } from "./amoraDemoPersistence";
import { isMutatingTool } from "./mutationTools";
import { screenAmoraTrustClaims } from "./amoraTrustClaims";
import { splitAmoraClaimSegments } from "./amoraClaimSegments";

const AFFIRMATIVE_PERSISTENCE_CLAIM_RE =
  /(?:(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용|처리|입력)(?:해\s*(?:두었|뒀|놓았|놨|드렸)|하였|했|됐|되었|\s*완료(?:했|됐))|(?:넣어|적어|써|바꿔|올려)\s*(?:두었|뒀|놓았|놨|드렸)|(?:넣었|적었|썼|바꿨|올렸)|완료(?:하였|했|됐|되었))(?:어요|습니다|어|다)?/u;

/**
 * `잡았`·`맞췄` 는 **변경 턴에서, 값 조사 뒤에서만** 저장 주장으로 본다(3차·4차 검토
 * 2026-09-14). "드레스 예산을 300만 원으로 잡았어요"·"10월 5일로 잡아 뒀어요"·"300만 원에
 * 맞춰 놓았어요" 는 사용자가 변경을 요청한 턴에서 나오면 저장 주장인데 어휘에 없어
 * 카드도 안내도 없이 그대로 나갔다.
 *
 * 다만 잡다·맞추다 는 뜻이 많다. "자리를 잡았어요"·"감을 잡았어요" 는 저장이 아니고(값
 * 조사 뒤에서만 본다), 무엇보다 **변경을 요청하지 않은 턴**에서는 "식대는 1인 7만 원으로
 * 잡았어요"(추정), "세 벌 모두 두 분 예산에 맞췄어요"(추천 근거), "후보는 강남 쪽 세 곳으로
 * 잡았어요"(정리)처럼 설명 문장이다 — 4차 검토에서 이런 문장이 안내 없이 조용히 지워져
 * 한 문장짜리 답은 빈 안내가 됐다. 그래서 이 묶음은 `includeChangeTurnValueClaims`
 * (변경 요청 턴·카드가 살아 있는 턴)일 때만 검사한다.
 */
const CHANGE_TURN_VALUE_CLAIM_RE =
  /(?:(?:으로|로)\s*(?:잡았|잡아\s*(?:두었|뒀|놓았|놨|드렸))|(?:으로|로|에)\s*(?:맞췄|맞춰\s*(?:두었|뒀|놓았|놨|드렸)))(?:어요|습니다|어|다)?/u;

/**
 * 위 완료형 매치 **바로 뒤**에 오는, 주장을 취소하는 어미.
 *
 * 2026-09-03 실측 오탐. "예식 월만 6월에서 5월로 바꿀게, 영향만 짧게" 처럼 **영향만
 * 물어본 턴**에서 아모라가 이렇게 답한다:
 *
 *     "5월로 변경했을 때 달라지는 항목은 없어요."
 *     "예식 월을 5월로 바꿨을 때 영향은 크지 않아요."
 *
 * 둘 다 가정이지 저장 주장이 아닌데, `변경했`·`바꿨` 만 보고 저장 주장으로 잡혔다.
 * 그 결과는 문장 하나가 지워지는 정도가 아니다 — 답변이 통째로 사라지고 그 자리에
 * "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요" 가 나갔다.
 * 사용자는 **요청하지도 않은 변경**의 실패를 통보받는다.
 *
 * 예외는 **매치 지점에 붙여서만** 판정한다. 문장 어딘가에 "없어요" 가 있으면
 * 봐준다는 식으로 만들면 "예산은 5,000만원으로 반영했고 더 남은 건 없어요" 같은
 * 진짜 주장이 그대로 빠져나간다. 그리고 한 문장에 매치가 여럿이면 **하나라도
 * 단정형이면 주장으로 친다**(아래 `hasAssertivePersistenceClaim`).
 *
 * 3차 검토(2026-09-14): 회상(`던` — "저장했던 게 언제였죠?"·"잡았던 걸로 기억해요")과
 * 물음(`나요`·바로 뒤의 물음표 — "잡았나요?"·"저장했어요?")도 이번 턴의 저장 주장이
 * 아니다. 회상은 매치 지점에 붙는 어미라 여기서 본다.
 */
const NON_ASSERTIVE_CLAIM_CONTINUATION_RE =
  /^(?:을\s*때|다면|더라면|으?면|을\s*경우|다고\s*가정|다\s*치면|는지|은지|던|나요|\s*[?？])/u;

const AFFIRMATIVE_PERSISTENCE_CLAIM_SCAN_RE = new RegExp(
  AFFIRMATIVE_PERSISTENCE_CLAIM_RE.source,
  "gu",
);
const CHANGE_TURN_VALUE_CLAIM_SCAN_RE = new RegExp(
  CHANGE_TURN_VALUE_CLAIM_RE.source,
  "gu",
);

/**
 * 이 문장에 **단정형** 저장 주장이 하나라도 있는가.
 *
 * 완료형 어휘가 보였다는 것만으로는 부족하다. 가정절("변경했을 때")과 단정
 * ("변경했어요")은 같은 어휘로 시작하고 뒤에서 갈린다.
 *
 * `includeChangeTurnValueClaims` 가 참이면(변경 요청 턴·카드가 살아 있는 턴) 값을 정한
 * `잡았/맞췄` 묶음도 함께 본다. 읽기·계획·추천 턴에서는 그 묶음이 설명 문장이라 보지 않는다.
 */
function hasAssertivePersistenceClaim(segment: string, includeChangeTurnValueClaims = false): boolean {
  const scanners = includeChangeTurnValueClaims
    ? [AFFIRMATIVE_PERSISTENCE_CLAIM_SCAN_RE, CHANGE_TURN_VALUE_CLAIM_SCAN_RE]
    : [AFFIRMATIVE_PERSISTENCE_CLAIM_SCAN_RE];
  for (const scanner of scanners) {
    for (const match of segment.matchAll(scanner)) {
      const rest = segment.slice((match.index ?? 0) + match[0].length);
      if (!NON_ASSERTIVE_CLAIM_CONTINUATION_RE.test(rest)) return true;
    }
  }
  return false;
}

/**
 * 값의 **현재 상태** 서술 — "10월 5일 오후 12시로 등록되어 있어요"·"드레스 예산은 450만
 * 원으로 설정되어 있어요". 변경 요청도 카드도 없는 읽기 턴에서만 문맥이 검증한 서술로
 * 남긴다(`keepStateDescriptions`). 저장·기록·등록·설정·확정만 — 값이 어디에 어떻게
 * 있는지를 말하는 동사다.
 */
const AFFIRMATIVE_PERSISTENCE_STATE_RE =
  /(?:저장|기록|등록|설정|확정)(?:되어|돼)\s*있(?:어요|습니다|다)/u;

/**
 * 명사형 **완료 주장** — "총예산 5천만 원 설정 완료예요"·"등록 완료입니다"·"저장 완료예요".
 * 2차 검토(2026-09-14): 상태 서술 봐주기가 이 모양까지 살려 보냈다. 이것은 값의 상태가
 * 아니라 **방금 한 일**의 보고라, 읽기 영수증이 있어도 mutation 영수증 없이는 지운다.
 */
const AFFIRMATIVE_PERSISTENCE_COMPLETION_RE =
  /(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용)\s*완료(?:예요|입니다)/u;

/**
 * 상태 어미를 빌린 **적용 서술** — "이제 예산표에 반영되어 있어요"·"5천만 원으로 변경되어
 * 있어요"·"드레스 450만 원으로 적용되어 있어요". 반영·변경·수정·추가·삭제·취소·업데이트·
 * 적용은 `AFFIRMATIVE_PERSISTENCE_STATE_RE` 의 저장·등록·설정과 달리 방금 한 일로도 읽히므로
 * 문맥만으로는 봐주지 않는다. 3차 검토(2026-09-14): 2차 수정이 이것을 **무조건** 지워,
 * get_budget_summary 가 성공한 읽기 턴의 "드레스 예산은 450만 원으로 반영되어 있어요." 까지
 * 중립 안내로 바뀌었다(HEAD 는 `verifiedByRead` 로 살렸다). 성공한 읽기 영수증이 있는 읽기
 * 턴(`keepAppliedStateDescriptions`)에서만 상태 서술로 본다.
 */
const AFFIRMATIVE_PERSISTENCE_APPLIED_STATE_RE =
  /(?:반영|변경|수정|추가|삭제|취소|업데이트|적용)(?:되어|돼)\s*있(?:어요|습니다|다)/u;

const ENGLISH_AFFIRMATIVE_PERSISTENCE_WORD_RE =
  /\b(?:saved|recorded|registered|updated|changed|modified|added|deleted|removed|cancelled|canceled|confirmed|applied)(?:\s+successfully)?\b/giu;

const ENGLISH_DIRECT_NEGATION_BEFORE_CLAIM_RE =
  /(?:\b(?:not|never)\s+(?:\w+\s+){0,3}|\b(?:isn't|wasn't|hasn't|haven't|cannot|can't)\s+(?:been\s+)?(?:\w+\s+){0,2})$/iu;

/**
 * 미래형 저장 약속 — "등록할게요" / "저장해 드릴게요" / "반영하겠습니다".
 *
 * 2026-09-03: 위 완료형 갈래는 이것을 하나도 못 잡는다. 워크트리에서 실제로
 * `composeAmoraPersistenceTerminal` 을 태워 보니 "예식장을 그랜드호텔로
 * 등록할게요."·"예산 5000만원으로 저장할게요."·"일정에 반영해 드릴게요."·"게스트
 * 명단에 추가하겠습니다." 가 전부 removedClaimCount=0 으로 원문 그대로 나갔다.
 * 사용자는 반영된 줄 알고 다음 턴으로 넘어가고, 아무것도 저장되지 않는다.
 *
 * 오탐을 줄이려고 두 가지로 좁혔다.
 *  - **저장 동사만**: 등록·저장·추가·반영·적용·입력. 그래서 "예식장에 문의할게요"·
 *    "확인해 드릴게요"·"알아볼게요" 처럼 저장이 아닌 약속은 그대로 남는다.
 *  - **주체가 아모라인 어미만**: 할게요/하겠습니다/해 드릴게요/해 둘게요/해 놓을게요.
 *    "언제 할지 알려주시면 등록할 수 있어요"·"직접 등록할 때는" 처럼 사용자 행동을
 *    말하는 형태는 걸리지 않는다.
 *
 * 이 갈래는 **이번 턴에 mutation 영수증도 확인 카드도 없을 때만** 켠다. 카드가 난
 * 턴의 본문은 이미 서버 확인문으로 통째로 대체돼 있어서(amoraPendingAction 의
 * `cleanText: marker.confirmation`) 검사하면 서버 문구를 훼손할 뿐이다.
 */
const FUTURE_PERSISTENCE_PROMISE_RE =
  /(?:등록|저장|추가|반영|적용|입력)(?:할게요?|할께요?|하겠습니다|하겠어요|해\s*드릴게요?|해\s*드리겠습니다|해\s*둘게요?|해\s*놓을게요?|해\s*놓겠습니다)/u;

const AFFIRMATIVE_MEMORY_CLAIM_RE =
  /(?:기억(?:해\s*(?:둘게|드릴게|놓을게|두겠|드리겠|놓겠)|하고\s*있을게|하고있을게|할게|하겠)(?:요|습니다)?|잊지\s*않(?:을게|겠)(?:요|습니다)?)/u;

const ENGLISH_AFFIRMATIVE_MEMORY_CLAIM_RE =
  /\b(?:i|we)(?:['’]ll| will)\s+remember\b/iu;

const PRIVATE_PREFERENCE_ACKNOWLEDGEMENT =
  "말씀하신 취향으로 이해했어요. 장기 기억에 저장됐다고는 아직 확인할 수 없어요.";

function withoutSharedWriteProhibitions(text: string): string {
  return splitAmoraClaimSegments(text).map(({ source }) => {
    const statement = source.trim();
    const prohibition = /^(?:파트너와\s*합의한\s*결정은\s*아니고,?\s*)?(?:공동|공유|함께\s*쓰는)\s*(?:예산|일정|할\s*일)(?:\s*[·,/와과]\s*(?:예산|일정|할\s*일))*\s*(?:에(?:는|도)?|은|는)?\s*(?:바꾸지|변경하지|수정하지|반영하지|저장하지|추가하지)\s*(마(?:세요)?|말아(?:줘|주세요)|말고)(?:[.!。]\s*|\s*)/u.exec(statement);
    if (!prohibition) return statement;
    const rest = statement.slice(prohibition[0].length).trim();
    // 독립 금지문 또는 '공동 예산에 반영하지 말고 기억해줘'의 금지절만 뺀다.
    // 뒤의 긍정 명령이나 개인 기억 철회는 남겨 아래 요청 판정이 거절하게 한다.
    return !rest || prohibition[1] === "말고" ? rest : statement;
  }).filter(Boolean).join(" ").trim();
}

// 현재 본인의 취향을 기억해 달라는 완결된 부탁만 받는다. 다른 과업·인용·타인
// 취향을 고정 답변으로 덮지 않으며, 이 판정은 기억 저장 권한을 만들지 않는다.
function isPrivatePreferenceMemoryRequest(value: string | undefined): boolean {
  if (!value || value.length > 500) return false;
  const normalized = value.normalize("NFKC").trim();
  if (/["'“”‘’`?？]/u.test(normalized)) return false;
  const text = withoutSharedWriteProhibitions(normalized);
  if (/만약|가정|예시|(?:라는|라고)\s*(?:말|문구|표현)|상대방?|파트너|친구|부모|엄마|아빠|신부|신랑/u.test(text)) return false;
  if (!/(?:^|\s)(?:(?:내|제|나의|저의)\s*(?:개인\s*)?취향|(?:나는|저는|난|전)\s+[^.!?\n]*(?:선호|좋아))/u.test(text)) return false;
  const request = /기억(?:해\s*(?:줘|주세요)|해서\s*참고해\s*(?:줘|주세요))[.!。]?$/u.exec(text);
  if (!request) return false;
  const before = text.slice(0, request.index);
  if (/기억|잊|저장|기록|수정|변경|반영|추가|등록|삭제|취소|공유|알려|보여|설명|정리|비교|추천|검색|찾아|보내/u.test(before)) return false;
  return /취향|선호|좋아/u.test(before);
}

function hasOnlyPrivateScopeDisclaimer(text: string): boolean {
  return !text.trim() || splitAmoraClaimSegments(text).every(({ claim }) =>
    /^(?:파트너와\s*합의한\s*결정이나\s*)?(?:공동|공유|함께\s*쓰는)\s*(?:예산|일정|할\s*일)(?:\s*[·,/와과]\s*(?:예산|일정|할\s*일))*\s*(?:에(?:는|도)?|은|는|로)?\s*(?:반영|저장|추가|변경|수정)하지\s*않(?:아요|았어요|습니다|았습니다)[.!。]?$/u.test(claim));
}

const NON_SUCCESS_CONTEXT_RE =
  /(?:라고|이라는|라는)\s*(?:말|표현|문구)|(?:예시|가정|만약|말하면\s*안|하지\s*마)/u;

// 2026-09-03: `isAmoraFailedProposalNotice`(amoraPendingAction.ts)가 이 문장을
// 이력 필터에 쓴다. 서버가 이 안내를 붙인 턴은 카드를 못 낸 턴이기 때문이다.
export const SERVER_OWNED_UNVERIFIED_NOTICE =
  "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.";

const SERVER_OWNED_PENDING_NOTICE =
  "아직 실제 준비에는 반영되지 않았어요. 아래 확인 내용을 검토해주세요.";

const SERVER_OWNED_DEMO_NOTICE =
  "체험 상담에서는 실제 일정·예산·예약 정보가 저장되거나 반영되지 않아요.";

const SERVER_OWNED_MISSING_RECEIPT_MESSAGE_NOTICE =
  "변경 실행 결과를 안전하게 표시할 수 없어 반영 여부를 확인하지 못했어요. 현재 화면에서 값을 확인해주세요.";

export type AmoraPersistenceClaimGuardResult = {
  text: string;
  corrected: boolean;
  removedClaimCount: number;
};

export type AmoraPersistenceTerminalResult =
  AmoraPersistenceClaimGuardResult & {
    source: "provider" | "server_mutation_receipts" | "server_correction";
  };

/**
 * Compose the only terminal text that may be shown and persisted for a turn.
 * Mutation receipts are server-owned, so provider prose is discarded whenever
 * at least one mutating tool was executed, including failed executions.
 */
/**
 * 사용자가 이번 턴에 변경을 **요청**했는가 — 제안 도구가 열렸다는 것과 다르다.
 *
 * 2026-09-04 팀원 2차 대본 재실행: "시기는 2028년 5월이나 6월쯤. 날짜는 아직." 은
 * 사실을 말한 것인데(변경 요청 아님) 도구 선택기가 결혼일 도구를 열어 `userRequestedChange`
 * 가 참이 됐고, 모델이 카드를 안 내자 "실제 실행 결과가 확인되지 않아 이 변경은 아직
 * 반영되지 않았어요" 가 붙었다. 요청하지 않은 변경의 실패를 사과받는 셈 — 2026-08-22
 * 와 같은 병(위 주석)이 "도구가 열렸다" 를 요청으로 읽어서 다시 났다.
 *
 * 그래서 안내는 **요청 동사가 있는 문장**에만 붙인다. 목록에 없는 요청 모양이면 안내가
 * 빠질 뿐(예전 동작), 없는 요청에 사과하지는 않는다.
 */
const EXPLICIT_CHANGE_REQUEST_PATTERN =
  /추가|등록|넣어|넣자|넣을|잡아|잡자|바꿔|바꾸|변경|수정|고쳐|취소|삭제|지워|옮겨|미뤄|당겨|적용|저장|반영|설정|정해\s*줘|정해\s*주|맞춰\s*줘|만들어\s*줘|올려|내려|줄여|늘려|완료\s*(?:처리|했|해)|체크\s*(?:해|처리)|기록\s*(?:해|남겨)/u;

/**
 * 상태를 **묻는** 절 — "예산 설정돼 있는 거 맞아?"·"상견례 일정 등록돼 있어?"·"드레스 예산
 * 반영됐어?"·"등록되어 있는지 알려줘". 3차 검토(2026-09-14): 위 패턴이 부분일치라 이 질문의
 * `설정`·`등록`·`반영` 이 변경 요청으로 읽혔고, 영수증이 있는 참 답 "총예산은 5천만 원으로
 * 설정되어 있어요." 가 "…아직 반영되지 않았어요" 사과로 바뀌었다.
 *
 * 절 단위로 걷어내고 나머지에서 요청 동사를 찾는다 — "설정돼 있어? 아니면 5천으로 바꿔줘"
 * 의 뒷절은 그대로 요청이다. 문장 끝(물음표·마침표·웃음·줄 끝)에 닿는 물음 어미만 본다.
 * "등록돼 있는 일정 취소해줘" 처럼 관형절로 이어지면 걷어내지 않는다(어차피 `취소` 가 남는다).
 * `는지` 는 내포 의문이라 끝 조건 없이 걷어낸다. 웃음 표기는 NFKC 뒤 조합형 자모
 * (U+110F·U+1112)로 바뀌므로 둘 다 끝으로 친다.
 */
const STATE_QUESTION_CLAUSE_RE =
  /(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용)\s*(?:(?:(?:돼|되어)\s*있|됐|되었)는지|(?:(?:돼|되어)\s*있(?:어|나|니|나요|어요|습니까|(?:는|던)\s*(?:거|건|게)(?:야|예요|에요|죠|지|니|나요)?)|(?:됐|되었)(?:어|나|니|나요|어요|습니까|(?:던|는)\s*(?:거|건|게)(?:야|예요|에요|죠|지|니|나요)?)|된\s*(?:거|건|게)(?:야|예요|에요|죠|지|니|나요)?)(?:\s*(?:맞(?:아|나|죠|지|나요|습니까)|아니야|아닌가|그치|그렇지|그죠))?\s*(?:[?？.!。~ㅋㅎᄏᄒ]|$))/gmu;

export function isExplicitAmoraChangeRequest(userText: string): boolean {
  if (typeof userText !== "string") return false;
  const text = userText.normalize("NFKC");
  const withoutProhibitions = text.replace(/(?:저장|수정|추가|등록|반영|변경|삭제|적용)(?:\s*(?:하거나|하고|및|또는|[/·,])?\s*(?:저장|수정|추가|등록|반영|변경|삭제|적용))*\s*(?:금지|하지\s*(?:말고|말아(?:줘)?|마(?:세요)?))/gu, "");
  // 조회에 붙인 쓰기 금지는 요청이 아니다. 독립적인 긍정 변경 동사는 남겨 두어
  // '일정 수정 금지, 예산 변경해줘' 같은 혼합 요청을 조회로 오인하지 않는다.
  if (withoutProhibitions !== text
    && /조회|알려\s*(?:줘|주세요)|보여\s*(?:줘|주세요)/u.test(withoutProhibitions)
    && !/(?:추가|등록|저장|반영|변경|수정|삭제|취소|적용|설정|기록)(?:해\s*(?:줘|주세요|주|줄)|하자|해라)|(?:바꿔|고쳐|지워|옮겨|넣어|잡아|미뤄|당겨|올려|내려|줄여|늘려|맞춰|정해)\s*(?:줘|주세요|주|줄)|완료\s*처리\s*해/u.test(withoutProhibitions)) return false;
  // 상태 질문 절은 요청이 아니다 — 걷어낸 나머지에서만 요청 동사를 찾는다.
  const withoutStateQuestions = withoutProhibitions.replace(STATE_QUESTION_CLAUSE_RE, " ");
  return EXPLICIT_CHANGE_REQUEST_PATTERN.test(withoutStateQuestions);
}

export const SERVER_OWNED_MISSING_CARD_NOTICE =
  "이번 답변에서는 확인 카드를 만들지 못했어요. 아직 반영하지 않았어요. 추가할 내용을 확인한 뒤 다시 요청해주세요.";

function removeUnemittedCardClaims(text: string, hasEmittedPendingAction: boolean): { text: string; removedCount: number } {
  if (hasEmittedPendingAction) return { text, removedCount: 0 };
  // 인용·예시 자체는 UI가 있다는 주장이 아니다. 문장 경계는 그대로 보존한다.
  const masked = text.replace(/```[\s\S]*?```|`[^`]*`|‘[^’]*’|“[^”]*”|"[^"\r\n]*"|'[^'\r\n]*'/g,
    match => match.replace(/[^\r\n.!?。！？]/g, " "));
  const claims = splitAmoraClaimSegments(masked);
  const sources = splitAmoraClaimSegments(text);
  let removedCount = 0;
  const kept = sources.filter((_segment, index) => {
    const claim = (claims[index]?.claim ?? "").replace(/[*_]/g, "");
    if (/[?？]$/.test(claim)) return true;
    const missingCard = /확인\s*카드(?:입니다|예요|에요)|확인\s*카드(?:를|가|이)?\s*(?:준비했|만들었|보여\s*드릴게|보여\s*드렸|확인해\s*주세요)|확인\s*카드(?:가|는)\s*있(?:어요|습니다)|적용\s*버튼(?:이\s*있(?:어요|습니다)|을\s*(?:눌러\s*주세요|누르세요))/u.test(claim);
    // 이전 답변의 카드도 이번 응답에 실제 실리지 않으면 현재 보인다고 말할 수 없다.
    // 인용·질문은 위에서 제외하고, 조건부 사용 설명과 과거 상태는 그대로 둔다.
    const conditionalCard = /카드[^.!?\n]*(?:있(?:다면|으면)|대기\s*중(?:이라면|이면))/u.test(claim);
    const waitingCard = /(?:확인\s*|변경\s*)?카드(?:가|는)\s*(?:이미\s*)?(?:화면에\s*)?(?:이미\s*)?대기\s*중(?:입니다|이에요|에요|이어요|이야|이\s*있(?:어요|습니다))/u.test(claim);
    const existingCardInstruction = /기존\s*(?:확인\s*|변경\s*)?카드에서\s*확인(?:해\s*주세요|하시면\s*(?:돼요|됩니다))/u.test(claim);
    const unsupportedCard = missingCard || (!conditionalCard && (waitingCard || existingCardInstruction));
    if (unsupportedCard) removedCount += 1;
    return !unsupportedCard;
  });
  return { text: removedCount ? kept.map(segment => segment.source).join("").trim() : text, removedCount };
}

export const SERVER_OWNED_EMPTY_ANSWER_NOTICE =
  "지금은 답을 만들지 못했어요. 한 번 더 물어봐 주세요.";

export function composeAmoraPersistenceTerminal(
  input: Parameters<typeof composeTerminalCandidate>[0],
): AmoraPersistenceTerminalResult {
  const composed = composeTerminalCandidate(input);
  if (composed.text.trim()) return composed;
  // 변경 요청이 없는 읽기·상담 턴은 자발적 표식까지 버렸더라도 중립 문장으로 남긴다.
  // 요청 인수를 생략한 기존 호출은 표식 유무에 따른 이전 fallback을 유지한다.
  if (
    input.userRequestedChange !== true
    && (input.droppedPendingActionTag !== true || input.userRequestedChange === false)
    && !input.hasPendingAction
  ) {
    return {
      ...composed,
      text: SERVER_OWNED_EMPTY_ANSWER_NOTICE,
      corrected: true,
      source: "server_correction",
    };
  }
  // 2026-09-03: **빈 본문은 턴 전체를 죽인다.**
  //
  // 운영 원장 2026-08-24 14:48:41 'post_provider_payload_invalid' → 14:48:45
  // 'CHAT_TURN_FAILED'(3.7초, budget_optimizer). 종단 검증
  // (`amoraProviderCallLedger`)이 `!input.content.trim()` 으로 거절하고, 사용자는
  // 원인과 무관한 "이 요청은 같은 식별자로 다시 이어갈 수 없어요" 를 받는다 —
  // 재시도 버튼도 없다.
  //
  // 빈 문자열은 아래에서 만들어진다. 신뢰 스크린이 모든 문장을 지우면 text=""
  // 인데 removedClaimCount 는 0 이라 안내가 안 붙고, 문장 전부가 저장 주장인
  // 답변에서 안내가 억제돼도 "" 가 된다. 걸러낸 내용은 그대로 버리므로(필터는
  // 조금도 약해지지 않는다) 서버 소유 문장 하나만 반드시 남긴다.
  return {
    ...composed,
    text: SERVER_OWNED_UNVERIFIED_NOTICE,
    corrected: true,
    source: "server_correction",
  };
}

function composeTerminalCandidate({
  text,
  toolResults,
  hasPendingAction,
  hasEmittedPendingAction = hasPendingAction,
  persistenceMode,
  demoUserText = "",
  userRequestedChange = true,
  userTurnIsChangeRequest = false,
  droppedPendingActionTag = false,
  privatePreferenceMemoryRequestText,
}: {
  text: string;
  toolResults: readonly ToolExecutionResult[];
  hasPendingAction: boolean;
  /** 실제 최종 metadata에 발행되는 새 카드 또는 이월 카드의 존재 여부. */
  hasEmittedPendingAction?: boolean;
  persistenceMode: "durable" | "demo";
  demoUserText?: string;
  /**
   * 이번 턴에 사용자가 변경을 요청했는가. 제안 도구가 열린 것과는 별개다.
   *
   * 거짓 저장 주장을 지운 뒤 붙이는 안내는 "변경할 내용을 확인한 뒤 다시
   * 요청해주세요" 라고 말한다. 사용자가 아무것도 요청하지 않은 턴에서는 그 말이
   * 틀렸다 — 2026-08-22 라이브에서 "친구는 스드메에 600만원 썼대" 에 그 안내가
   * 붙었다. 요청하지도 않은 변경의 실패를 사과받는 셈이다.
   *
   * 기본값은 기존 동작(붙인다)이다.
   */
  userRequestedChange?: boolean;
  /**
   * 사용자 발화 자체가 변경 요청인가 — 제안 도구 관문을 거치지 않은 판정.
   *
   * 라우트의 `userRequestedChange` 는 `pendingOfferEnabled && isExplicitAmoraChangeRequest(...)`
   * 라 제안 도구가 하나도 안 열린 턴은 요청 아님으로 들어온다. 2차 검토(2026-09-14):
   * "총예산 5천만원으로 바꿔 ㅋㅋ" 가 그 모양이었고, 상태 서술 봐주기가 "총예산은 5천만
   * 원으로 설정되어 있어요." 를 그대로 내보냈다. 이 값은 **상태 서술을 남길지**에만 쓰고,
   * 안내 문구 여부는 여전히 `userRequestedChange` 가 정한다. 기본값은 요청 아님이다 —
   * `userRequestedChange` 가 기본값(참)이면 상태 서술은 어차피 지워진다.
   */
  userTurnIsChangeRequest?: boolean;
  /**
   * 모델이 변경 표식을 냈는데 서버 검증에서 버려졌는가.
   *
   * 표식이 스키마를 통과 못 하면(지어낸 도구 이름·없는 필드) 카드가 안 나온다.
   * 그때 모델 본문이 거짓 성공 주장을 담고 있으면 아래 정리가 잡아내지만,
   * **중립적으로 쓰여 있으면 지울 것이 없어 아무 말도 안 나간다.**
   * 실제 변경 요청이 있었다면 사용자는 평범한 답만 읽고 저장 여부를 알 수 없다.
   *
   * 모델의 자발적 표식은 사용자 요청을 뜻하지 않는다. 실패 안내 여부는
   * userRequestedChange로 따로 판단하며 표식 검증 자체는 유지한다.
   */
  droppedPendingActionTag?: boolean;
  /** 서버가 검증한 일반 개인 상담 경계에서만 전달하는 현재 사용자 원문. 저장 권한 아님. */
  privatePreferenceMemoryRequestText?: string;
}): AmoraPersistenceTerminalResult {
  const mutationReceipts = toolResults.filter((result) =>
    isMutatingTool(result.toolName));

  if (mutationReceipts.length > 0) {
    return {
      text: mutationReceipts
        .map((result) => (result.displayMessage ?? "").trim()
          || SERVER_OWNED_MISSING_RECEIPT_MESSAGE_NOTICE)
        .join("\n\n"),
      corrected: true,
      removedClaimCount: 0,
      source: "server_mutation_receipts",
    };
  }

  // 위의 실행 결과 메시지는 서버가 소유한 문구라 검사하지 않는다 — 검사하면 오히려
  // 훼손된다. 여기부터가 제공자 산문이므로, 사용자가 검증할 수 없는 약속과 사람에
  // 대한 판정을 먼저 걷어낸다. 저장 주장 검사와 같은 문장 단위를 쓴다.
  const trustScreened = screenAmoraTrustClaims(text);
  const cardScreened = removeUnemittedCardClaims(trustScreened.text, hasEmittedPendingAction);
  const trustCorrected = trustScreened.removedCount > 0 || cardScreened.removedCount > 0;
  // 미래형 저장 약속은 **이번 턴에 아무것도 저장되지 않았을 때만** 지운다
  // (2026-09-03). 영수증이 있는 턴은 위에서 이미 반환됐고, 카드가 난 턴의 본문은
  // 서버가 만든 확인문이라 검사하면 서버 문구를 훼손한다.
  // 2026-09-05 페르소나 실측(p2 T7, 새 커플 재현 7/8): "드레스 예산이 지금 얼마로 되어
  // 있는지 알려 주세요" 에 get_budget_summary 가 성공했는데, 모델 답 "…450만 원으로
  // 설정되어 있어요" 가 상태 서술 정규식에 걸려 지워지고 본문이 비어 "변경이 반영되지
  // 않았어요" 만 나갔다 — DB 에는 450만 원이 있었으니 안내 자체가 거짓이었다.
  // 2026-09-14 출시 실사: 그 봐주기를 **성공한 읽기 영수증**에 걸어 두었더니 같은 문장이
  // 도구 없이 나갈 때는 여전히 지워졌다. 프롬프트가 `### 등록된 일정`·예산 요약을 문맥에
  // 인라인하므로 "상견례 일정 언제야?" 같은 읽기 턴은 도구를 하나도 안 돌리고, 영수증이
  // 없어 "10월 5일 오후 12시로 등록되어 있어요." 가 지워져 "지금은 답을 만들지 못했어요"
  // 만 나갔다 — 다시 물어도 같다. 변경 요청이 아닌 턴(요청 없음·카드 없음)의 상태 서술은
  // 영수증과 무관하게 문맥이 검증한 서술로 본다. 실행 주장("변경했어요")과 미래 약속은
  // 여전히 지운다 — 변경을 요청한 턴이나 카드가 살아 있는 턴의 상태 서술도 그대로 지운다.
  // 2차 검토: "요청 없음" 은 도구 관문을 거친 `userRequestedChange` 만으로는 모자란다 —
  // 도구가 안 열린 변경 요청("총예산 5천만원으로 바꿔 ㅋㅋ")이 거짓으로 들어온다. 발화
  // 판정(`userTurnIsChangeRequest`)과 이월 카드(`hasEmittedPendingAction`)도 함께 본다.
  // 3차 검토: 이월 카드는 **성공한 읽기 영수증**이 있으면 막지 않는다. 카드는 최대 2턴
  // 이월되므로 "상견례 일정 언제야?" 를 다시 물어도 get_schedule_events 가 성공한 참 답
  // "10월 5일 오후 12시로 등록되어 있어요." 가 중립 안내로 바뀌던 출시 증상이 그대로였다.
  // 영수증 없는 이월 카드 턴은 여전히 지운다. 그리고 같은 영수증은 "…반영되어 있어요"
  // 같은 적용 서술(`AFFIRMATIVE_PERSISTENCE_APPLIED_STATE_RE`)도 HEAD 처럼 검증한다.
  const verifiedByRead = toolResults.some((result) =>
    result.success === true && !isMutatingTool(result.toolName));
  const keepStateDescriptions = !hasPendingAction
    && (!hasEmittedPendingAction || verifiedByRead)
    && !userRequestedChange && !userTurnIsChangeRequest;
  // 4차 검토: 값 조사 뒤 `잡았/맞췄` 는 변경 요청 턴(도구가 안 열린 요청 포함)과 카드가
  // 살아 있는 턴에서만 저장 주장이다. 읽기·계획·추천 턴의 "1인 7만 원으로 잡았어요" 는 설명이다.
  const sanitized = removeUnverifiedPersistenceClaims(cardScreened.text, {
    includeFuturePromise: !hasPendingAction,
    keepStateDescriptions,
    keepAppliedStateDescriptions: keepStateDescriptions && verifiedByRead,
    includeChangeTurnValueClaims:
      userRequestedChange || userTurnIsChangeRequest || hasPendingAction || hasEmittedPendingAction,
  });

  // 기억 약속과 취향 확인이 한 문장일 때 함께 지워지고 무관한 공동 기록 안내만
  // 남았던 경우를 보완한다. 삭제 문장의 취향 값은 재사용하지 않는다.
  if (persistenceMode === "durable" && !hasPendingAction && !hasEmittedPendingAction
    && !userRequestedChange && !droppedPendingActionTag && !trustCorrected
    && sanitized.removedMemoryClaimCount > 0
    && sanitized.removedClaimCount === sanitized.removedMemoryClaimCount
    && isPrivatePreferenceMemoryRequest(privatePreferenceMemoryRequestText)
    && hasOnlyPrivateScopeDisclaimer(sanitized.text)) {
    return { text: PRIVATE_PREFERENCE_ACKNOWLEDGEMENT, corrected: true,
      removedClaimCount: sanitized.removedClaimCount, source: "server_correction" };
  }

  if (persistenceMode === "demo") {
    const demoGuard = guardDemoPersistenceDisclosure(
      sanitized.text,
      demoUserText,
    );
    const needsGenericNotice = sanitized.removedClaimCount > 0
      && demoGuard.appendedNotice === null;
    const demoText = needsGenericNotice
      ? [demoGuard.text, SERVER_OWNED_DEMO_NOTICE].filter(Boolean).join("\n\n")
      : demoGuard.text;
    const corrected = sanitized.removedClaimCount > 0
      || trustCorrected
      || demoGuard.appendedNotice !== null;

    return {
      text: demoText,
      corrected,
      removedClaimCount: sanitized.removedClaimCount,
      source: corrected ? "server_correction" : "provider",
    };
  }

  // 2026-09-05 페르소나 실측(p7 T12, p4 S4, p5 T3·T4): 모델이 "…으로 이해하면 될까요?" 처럼
  // **되묻고** 끝난 턴에 "변경할 내용을 확인한 뒤 다시 요청해주세요" 가 붙어, 질문과 안내가
  // 서로 다른 다음 행동을 요구했다. 되묻기 자체가 다음 단계다 — 카드가 살아 있는 턴만 빼고
  // 안내를 붙이지 않는다.
  if (cardScreened.removedCount > 0) {
    return {
      text: [sanitized.text, SERVER_OWNED_MISSING_CARD_NOTICE].filter(Boolean).join("\n\n"),
      corrected: true,
      removedClaimCount: sanitized.removedClaimCount + cardScreened.removedCount,
      source: "server_correction",
    };
  }
  const endsWithQuestion = /[?？]\s*$/u.test(sanitized.text.trim());
  if (sanitized.removedClaimCount === 0) {
    // 실제 변경 요청의 표식 실패만 안내한다. 모델의 자발적 표식은 요청의 근거가 아니다.
    if (droppedPendingActionTag && userRequestedChange && !endsWithQuestion) {
      return {
        text: [sanitized.text, SERVER_OWNED_UNVERIFIED_NOTICE]
          .filter(Boolean)
          .join("\n\n"),
        corrected: true,
        removedClaimCount: 0,
        source: "server_correction",
      };
    }
    return {
      text: sanitized.text,
      corrected: trustCorrected,
      removedClaimCount: 0,
      source: trustCorrected ? "server_correction" : "provider",
    };
  }

  // 요청하지 않은 변경의 실패를 알릴 이유가 없다. 거짓 주장은 이미 지웠으므로
  // 사용자가 잘못 믿을 것도 남아 있지 않다.
  // 모델이 자발적으로 한 미래 약속도 사용자 요청을 증명하지 않는다.
  const notice = (
    !hasPendingAction
    && !userRequestedChange
  ) || (!hasPendingAction && endsWithQuestion)
    ? null
    : hasPendingAction
      ? SERVER_OWNED_PENDING_NOTICE
      : SERVER_OWNED_UNVERIFIED_NOTICE;

  return {
    text: [sanitized.text, notice].filter(Boolean).join("\n\n"),
    corrected: true,
    removedClaimCount: sanitized.removedClaimCount,
    source: "server_correction",
  };
}

type StateDescriptionOptions = {
  /** 저장·등록·설정·확정 + "되어 있어요" 를 문맥이 검증한 상태 서술로 남긴다. */
  keepStateDescriptions?: boolean;
  /** 반영·변경·적용 + "되어 있어요" 도 남긴다 — 성공한 읽기 영수증이 있을 때만 참이다. */
  keepAppliedStateDescriptions?: boolean;
  /** 값 조사 뒤 `잡았/맞췄` 도 저장 주장으로 본다 — 변경 요청 턴·카드가 살아 있는 턴에서만 참이다. */
  includeChangeTurnValueClaims?: boolean;
};

function containsUnverifiedSuccessClaim(
  segment: string,
  {
    keepStateDescriptions = false,
    keepAppliedStateDescriptions = false,
    includeChangeTurnValueClaims = false,
  }: StateDescriptionOptions = {},
): boolean {
  const containsKoreanAffirmativeClaim = hasAssertivePersistenceClaim(segment, includeChangeTurnValueClaims)
    || AFFIRMATIVE_PERSISTENCE_COMPLETION_RE.test(segment)
    || (!keepAppliedStateDescriptions && AFFIRMATIVE_PERSISTENCE_APPLIED_STATE_RE.test(segment))
    || (!keepStateDescriptions && AFFIRMATIVE_PERSISTENCE_STATE_RE.test(segment))
    || AFFIRMATIVE_MEMORY_CLAIM_RE.test(segment)
    || ENGLISH_AFFIRMATIVE_MEMORY_CLAIM_RE.test(segment);
  if (containsKoreanAffirmativeClaim && !NON_SUCCESS_CONTEXT_RE.test(segment)) {
    return true;
  }

  // Inspect every English completion verb independently. A negative clause
  // such as "wasn't saved" must not shield a later "but was updated" claim.
  for (const match of segment.matchAll(ENGLISH_AFFIRMATIVE_PERSISTENCE_WORD_RE)) {
    const prefix = segment.slice(0, match.index).slice(-48);
    if (!ENGLISH_DIRECT_NEGATION_BEFORE_CLAIM_RE.test(prefix)) {
      return true;
    }
  }

  return false;
}

function removeUnverifiedPersistenceClaims(
  text: string,
  options: { includeFuturePromise?: boolean } & StateDescriptionOptions = {},
): {
  text: string;
  removedClaimCount: number;
  removedFuturePromiseCount: number;
  removedMemoryClaimCount: number;
} {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return { text: "", removedClaimCount: 0, removedFuturePromiseCount: 0, removedMemoryClaimCount: 0 };
  }

  const segments = splitAmoraClaimSegments(normalizedText);
  const kept: string[] = [];
  let removedClaimCount = 0;
  let removedFuturePromiseCount = 0;
  let removedMemoryClaimCount = 0;

  for (const { claim: segment, source } of segments) {
    if (containsUnverifiedSuccessClaim(segment, options)) {
      removedClaimCount += 1;
      if ((AFFIRMATIVE_MEMORY_CLAIM_RE.test(segment) || ENGLISH_AFFIRMATIVE_MEMORY_CLAIM_RE.test(segment))
        && !hasAssertivePersistenceClaim(segment, options.includeChangeTurnValueClaims === true)
        && !AFFIRMATIVE_PERSISTENCE_STATE_RE.test(segment)
        && !AFFIRMATIVE_PERSISTENCE_COMPLETION_RE.test(segment)
        && !AFFIRMATIVE_PERSISTENCE_APPLIED_STATE_RE.test(segment)
        && !FUTURE_PERSISTENCE_PROMISE_RE.test(segment)
        && segment.match(ENGLISH_AFFIRMATIVE_PERSISTENCE_WORD_RE) === null) {
        removedMemoryClaimCount += 1;
      }
    } else if (
      options.includeFuturePromise === true
      && containsFuturePersistencePromise(segment)
    ) {
      removedClaimCount += 1;
      removedFuturePromiseCount += 1;
    } else {
      kept.push(source);
    }
  }

  return {
    text: removedClaimCount === 0
      ? normalizedText
      : repairSplitEmphasis(dropDanglingConnective(kept.join("").trim())),
    removedClaimCount,
    removedFuturePromiseCount,
    removedMemoryClaimCount,
  };
}

/**
 * 아직 일어나지 않은 저장을 약속하는 문장인가.
 *
 * 완료형 검사와 같은 `NON_SUCCESS_CONTEXT_RE` 를 태워 예시·인용은 남긴다
 * ("'등록할게요' 라는 말은 하지 않아요" 같은 자기 규칙 설명).
 */
function containsFuturePersistencePromise(segment: string): boolean {
  return FUTURE_PERSISTENCE_PROMISE_RE.test(segment)
    && !NON_SUCCESS_CONTEXT_RE.test(segment);
}

/**
 * 문장을 지우면 강조 구간이 쪼개진다.
 *
 * 2026-08-22 라이브에서 사용자가 본 것:
 *
 *     우리 예산은 아직 **400만 원으로 확정되지 않았어요.
 *
 *     ** 400만 원과 600만 원 중 어느 쪽을…
 *
 * 여는 `**` 와 닫는 `**` 사이의 문장이 지워지면서 둘이 서로 다른 문단으로
 * 갈라졌다. 마크다운은 문단을 넘는 강조를 허용하지 않아 **별표가 글자 그대로
 * 화면에 보인다.**
 *
 * 짝이 맞지 않는 문단에서는 강조를 통째로 지운다 — 꾸밈을 잃는 편이 별표가
 * 노출되는 것보다 낫다.
 */
function repairSplitEmphasis(text: string): string {
  return text
    .split("\n\n")
    .map((paragraph) => {
      const markers = paragraph.match(/\*\*/g);
      return markers && markers.length % 2 === 1
        ? paragraph.replace(/\*\*/g, "")
        : paragraph;
    })
    .join("\n\n");
}

/**
 * 앞 문장을 지우면 잇는 말만 남는다.
 *
 * 2026-08-22 라이브에서 사용자가 실제로 본 것: **"다만 업체마다 포함 구성과…"**
 * — 앞 문장이 거짓 저장 주장이라 지워졌는데 "다만" 이 그대로 남아, 무엇에 대한
 * 단서인지 알 수 없는 문장이 됐다.
 */
const DANGLING_CONNECTIVE_RE =
  /^(?:다만|하지만|그렇지만|그러나|그런데|그리고|또한|또|그래서|따라서|그러니까|대신)\s*,?\s*/u;

function dropDanglingConnective(text: string): string {
  return text.replace(DANGLING_CONNECTIVE_RE, "");
}

/**
 * Provider prose is never proof that a write happened. Remove affirmative
 * persistence sentences unless this turn has a successful server-owned
 * mutation receipt. Pending proposals remain unapplied until the user
 * confirms the exact server-issued action.
 */
export function guardUnverifiedAmoraPersistenceClaims({
  text,
  hasVerifiedMutationReceipt,
  hasPendingAction,
}: {
  text: string;
  hasVerifiedMutationReceipt: boolean;
  hasPendingAction: boolean;
}): AmoraPersistenceClaimGuardResult {
  const normalizedText = text.trim();
  if (!normalizedText || hasVerifiedMutationReceipt) {
    return {
      text: normalizedText,
      corrected: false,
      removedClaimCount: 0,
    };
  }

  const sanitized = removeUnverifiedPersistenceClaims(normalizedText);

  if (sanitized.removedClaimCount === 0) {
    return {
      text: normalizedText,
      corrected: false,
      removedClaimCount: 0,
    };
  }

  const notice = hasPendingAction
    ? SERVER_OWNED_PENDING_NOTICE
    : SERVER_OWNED_UNVERIFIED_NOTICE;
  return {
    text: [sanitized.text, notice].filter(Boolean).join("\n\n"),
    corrected: true,
    removedClaimCount: sanitized.removedClaimCount,
  };
}
