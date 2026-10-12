const SHARED_TASK_TARGET = /(?:공유|함께\s*보는)\s*할\s*일(?:에|로|을|를|은|는)?/u;
const OTHER_TASK_DOMAIN = /회사|업무|직장|부서|프로젝트|숙제|과제|자격증/u;
const TASK_REQUEST = /(?:저장|추가|등록|제안)해\s*(?:줘|주세요|줄래)(?:요)?(?=$|[\s.!?,])(?!\s*(?:라고|라는|라며))|넣어\s*(?:줘|주세요)(?=$|[\s.!?,])(?!\s*(?:라고|라는|라며))/u;
const TASK_PROPOSAL_REQUEST = /제안해\s*(?:줘|주세요|줄래)(?:요)?(?=$|[\s.!?,])(?!\s*(?:라고|라는|라며))|(?:미리보기|확인\s*카드)(?:를|만|부터)?\s*(?:보여|만들어)\s*(?:줘|주세요|줄래)(?:요)?(?=$|[\s.!?,])(?!\s*(?:라고|라는|라며))/u;

function unquotedRequest(text: string): string {
  return text.normalize("NFKC").replace(/"[^"\r\n]*"|“[^”\r\n]*”|'[^'\r\n]*'|‘[^’\r\n]*’/gu, " ")
    .replace(/\s+/gu, " ").trim();
}

/** 제품 목록을 직접 조작하라는 의도만 판정한다. 값 검증·실행 승인은 하지 않는다. */
function sharedTaskRequestTail(text: string): string | null {
  if (text.length > 10000) return null;
  const request = unquotedRequest(text);
  if (OTHER_TASK_DOMAIN.test(request)
    || /^(?:예시|가정|만약|가령)(?:로|으로|인)?(?=$|[\s:：,.!?])/u.test(request)) return null;
  const target = SHARED_TASK_TARGET.exec(request);
  return target === null ? null : request.slice(target.index + target[0].length);
}

export function hasExplicitAmoraSharedTaskRequest(text: string): boolean {
  const tail = sharedTaskRequestTail(text);
  return tail !== null && (TASK_REQUEST.test(tail) || TASK_PROPOSAL_REQUEST.test(tail));
}

/** 제안에는 항목 추가 확인 카드만 허용한다. 저장 여부는 승인 토큰이 따로 결정한다. */
export function hasAmoraSharedTaskProposalRequest(text: string): boolean {
  const tail = sharedTaskRequestTail(text);
  return tail !== null && TASK_PROPOSAL_REQUEST.test(tail);
}
