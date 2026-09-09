import { splitAmoraClaimSegments } from "./amoraClaimSegments";

/**
 * 아모라가 해서는 안 되는 말을 답변에서 걷어낸다.
 *
 * ## 왜 프롬프트로는 부족한가
 *
 * 금지 문구 목록은 프롬프트에 적혀 있다. 그런데 프롬프트는 요청이지 강제가 아니다.
 * 모델이 어기면 그대로 사용자에게 나간다. 이 저장소에서 실제로 출력을 검사하는 층은
 * `amoraPersistenceClaims`(저장했다는 거짓말을 잘라냄) 하나뿐이었고, 나머지 금지
 * 규칙에는 같은 장치가 없었다.
 *
 * 여기서 막는 말들은 성격이 같다 — **사용자가 검증할 수 없는 약속**이거나
 * **사람에 대한 판정**이다. 둘 다 틀렸을 때 사용자가 알아챌 방법이 없고, 그래서
 * 프롬프트에 적어두는 것만으로는 위험이 남는다.
 *
 * ## 왜 문장만 지우고 답변은 살리는가
 *
 * 답변 전체를 막으면 쓸모 있는 나머지까지 사라진다. `amoraPersistenceClaims`가 이미
 * 문장 단위로 잘라내는 방식을 쓰고 있으므로 같은 관용구를 따른다.
 *
 * ## 오탐을 어떻게 줄였는가
 *
 * 따뜻한 말과 위험한 약속은 다르다. "걱정 마세요"는 그대로 둔다 — 금지되는 것은
 * "걱정 마세요, 아무 문제 없어요"처럼 **보증이 붙을 때**다. 마찬가지로 "신랑 측에서
 * 준비하는 경우가 많아요"는 관행 서술이라 남기고, "신랑 측에서 해야 해요"처럼
 * **의무로 말할 때**만 잘라낸다.
 *
 * 그래서 대부분의 패턴은 낱말 하나가 아니라 낱말 + 단정/의무 표지를 함께 요구한다.
 */

/** 보증·면책. 배분 합계 100%는 숫자 설명이므로 결과 보증 표현과 함께 있을 때만 차단한다. */
const GUARANTEE_RE =
  /(?:제가|아모라가)?\s*(?:다|전부|모두)?\s*책임(?:질게|지겠|집니다|져\s*드릴)|100\s*%[^.!?\n]{0,20}(?:안전|정확(?:히(?=\s*(?:판단|예측|처리|해결|보호))|(?!히))|확실|확신|성공|보장|보증|책임|보호(?:해|하|합|할|된|돼|됩)|(?:유출|누출)(?:되지\s*않|이?\s*없|을?\s*막)|맞(?:아요|습니다|다고)|믿(?:어도|으셔도|으세요)|(?:실수|문제|오류)\s*없)|(?:안전|정확|성공|적중|맞을)[^.!?\n]{0,12}100\s*%|절대(?:로)?\s*(?:안전|유출|누출|실수|놓치|틀리)|완벽(?:하게|히)?[^.!?\n]{0,12}(?:줄여|보장|처리|해결|막아)|아무것도\s*(?:안\s*)?(?:놓치지|빠뜨리지)\s*않|하나도\s*놓치지\s*않|문제\s*(?:없|안\s*생)(?:어요|습니다|을\s*거예요|을\s*겁니다)|걱정\s*(?:마세요|말아요)[^.!?\n]{0,20}(?:없|안\s*생|괜찮)/u;

/** 정체성 사칭 — 아모라는 사람도, 결혼 경험자도, 대기 중인 담당자도 아니다. */
const IMPERSONATION_RE =
  /(?:제가|저도|저는)\s*(?:결혼|예식|상견례)(?:을|를)?\s*(?:해\s*보|해봐|했을\s*때|해봤)|직접\s*겪어\s*(?:봐서|봤)|전문가가\s*(?:이미\s*)?(?:확인|검토)(?:했|해\s*드렸|됐)|변호사(?:가|와)\s*(?:확인|검토)(?:했|됐)|24\s*시간\s*(?:대기|상주|지켜)|밤에도\s*(?:지켜|보고)/u;

/** 비밀 약속 — 공유 범위를 아모라가 약속할 수 없다. */
const SECRECY_RE =
  /(?:우리|저희)\s*(?:둘|두\s*사람)만(?:의)?\s*비밀|아무(?:한테|에게)도\s*(?:말|얘기|공유)\s*(?:안|하지)\s*않(?:을게|겠)|비밀(?:로)?\s*(?:지켜\s*드릴게|해\s*드릴게|지킬게)/u;

/** 의존 유도 — 없으면 큰일 난다는 말로 불안을 만들지 않는다. */
const DEPENDENCY_RE =
  /아모라\s*(?:가\s*)?없(?:으면|었으면)[^.!?\n]{0,24}(?:놓치|큰일|힘들|못\s*해|실수)|(?:저|언니|제)\s*말(?:만)?\s*믿(?:으세요|어요|고)|저만\s*믿(?:으세요|어요)|(?:저|아모라)에게\s*맡기(?:세요|시면\s*돼)/u;

/** 성역할·가족역할 강요 — 관행 서술과 의무 단정을 가른다. */
const ROLE_OBLIGATION_RE =
  /(?:신부|신랑|며느리|사위|여자|남자)\s*(?:라면|는|가|측(?:에서)?|쪽(?:에서)?)[^.!?\n]{0,24}(?:당연히|반드시|무조건)|(?:신부|신랑|며느리|사위)\s*(?:라면|측(?:에서)?|쪽(?:에서)?)[^.!?\n]{0,20}(?:해야\s*(?:해|합니다|돼|되)|하는\s*(?:거예요|겁니다|법))/u;

/** 비교 압박 — 다른 커플의 지출을 기준으로 삼지 않는다. */
const COMPARISON_PRESSURE_RE =
  /(?:다른|요즘|보통)\s*(?:커플|신혼부부|사람)(?:들)?(?:은|는|이|가)?\s*(?:다|대부분|보통|거의)[^.!?\n]{0,24}(?:정도(?:는)?\s*(?:쓰|해|하)|씁니다|써요|합니다|해요)/u;

/** 관계·성향 판정 — 궁합, 성격, 진정성은 아모라가 판정하지 않는다. */
const VERDICT_RE =
  /궁합(?:이|은|도)?\s*(?:좋|잘\s*맞|나쁘|안\s*맞)|두\s*분(?:은|이)?\s*(?:참|정말|아주)?\s*잘\s*맞(?:아요|습니다|는)|상대(?:방|분)?(?:의)?\s*성향(?:은|이)\s*(?:이렇|다음)|회피형|불안형|(?:진짜|정말)\s*사랑(?:한다면|하면)[^.!?\n]{0,16}(?:해야|이\s*정도)/u;

const SCREENS = [
  ["guarantee", GUARANTEE_RE],
  ["impersonation", IMPERSONATION_RE],
  ["secrecy", SECRECY_RE],
  ["dependency", DEPENDENCY_RE],
  ["role_obligation", ROLE_OBLIGATION_RE],
  ["comparison_pressure", COMPARISON_PRESSURE_RE],
  ["verdict", VERDICT_RE],
] as const;

export type AmoraTrustClaimKind = (typeof SCREENS)[number][0];

/**
 * 인용·부정 문맥은 남긴다. 아모라가 "이렇게 말하지 않아요"라고 설명하는 문장까지
 * 지우면 자기 규칙을 설명할 수 없다.
 */
const QUOTED_OR_NEGATED_RE =
  /(?:라고|이라고|라는|이라는)\s*(?:말|표현|문구|얘기)|말(?:하지|씀드리지)\s*않|하지\s*않(?:아요|습니다)|할\s*수\s*없(?:어요|습니다)/u;

export interface AmoraTrustClaimScreenResult {
  text: string;
  removedKinds: AmoraTrustClaimKind[];
  removedCount: number;
}

export function findAmoraTrustClaims(segment: string): AmoraTrustClaimKind[] {
  if (typeof segment !== "string" || !segment.trim()) return [];
  if (QUOTED_OR_NEGATED_RE.test(segment)) return [];
  return SCREENS
    .filter(([, pattern]) => pattern.test(segment))
    .map(([kind]) => kind);
}

/**
 * 제공자 산문에서 금지된 약속·판정 문장을 걷어낸다.
 *
 * 서버가 소유한 문구(도구 실행 결과 메시지, 서버 정정 안내)에는 적용하지 않는다 —
 * 그 문장들은 모델이 쓴 것이 아니고, 검사하면 오히려 훼손된다.
 */
export function screenAmoraTrustClaims(text: string): AmoraTrustClaimScreenResult {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) return { text: "", removedKinds: [], removedCount: 0 };

  // `amoraPersistenceClaims`와 같은 문장 분리 규칙을 쓴다. 두 검사가 서로 다른
  // 단위로 자르면 한쪽만 통과하는 문장이 생긴다.
  const segments = splitAmoraClaimSegments(normalized);

  const kept: string[] = [];
  const removedKinds = new Set<AmoraTrustClaimKind>();
  let removedCount = 0;

  for (const { claim: segment, source } of segments) {
    const kinds = findAmoraTrustClaims(segment);
    if (kinds.length > 0) {
      removedCount += 1;
      for (const kind of kinds) removedKinds.add(kind);
    } else {
      kept.push(source);
    }
  }

  return {
    text: removedCount === 0 ? normalized : kept.join("").trim(),
    removedKinds: [...removedKinds],
    removedCount,
  };
}
