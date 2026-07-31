const AFFIRMATIVE_PERSISTENCE_CLAIM_RE =
  /(?:저장|기록|등록|반영|변경|수정|추가|삭제|취소|확정|업데이트|적용)(?:해\s*(?:두었|뒀|놓았|놨|드렸)|하였|했|됐|되었|\s*완료(?:했|됐))(?:어요|습니다|어|다)?/u;

const NON_SUCCESS_CONTEXT_RE =
  /(?:아직|실제로는|현재는).{0,32}(?:않|안\s*됐|못\s*했|되지|미저장|미반영)|(?:되지\s*않|안\s*됐|못\s*했|할\s*수\s*없)|(?:라고|이라는|라는)\s*(?:말|표현|문구)|(?:예시|가정|만약|말하면\s*안|하지\s*마)/u;

const SERVER_OWNED_UNVERIFIED_NOTICE =
  "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.";

const SERVER_OWNED_PENDING_NOTICE =
  "아직 실제 준비에는 반영되지 않았어요. 아래 확인 내용을 검토해주세요.";

export type AmoraPersistenceClaimGuardResult = {
  text: string;
  corrected: boolean;
  removedClaimCount: number;
};

function containsUnverifiedSuccessClaim(segment: string): boolean {
  return AFFIRMATIVE_PERSISTENCE_CLAIM_RE.test(segment)
    && !NON_SUCCESS_CONTEXT_RE.test(segment);
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

  const segments = normalizedText
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let removedClaimCount = 0;

  for (const segment of segments) {
    if (containsUnverifiedSuccessClaim(segment)) {
      removedClaimCount += 1;
    } else {
      kept.push(segment);
    }
  }

  if (removedClaimCount === 0) {
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
    text: [...kept, notice].join("\n\n"),
    corrected: true,
    removedClaimCount,
  };
}
