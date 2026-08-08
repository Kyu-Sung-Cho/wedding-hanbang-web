import type { ToolExecutionResult } from "@/types/database.types";

import { guardDemoPersistenceDisclosure } from "./amoraDemoPersistence";
import { isMutatingTool } from "./mutationTools";
import { screenAmoraTrustClaims } from "./amoraTrustClaims";

const AFFIRMATIVE_PERSISTENCE_CLAIM_RE =
  /(?:(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용|처리|입력)(?:해\s*(?:두었|뒀|놓았|놨|드렸)|하였|했|됐|되었|\s*완료(?:했|됐))|(?:넣어|적어|써|바꿔|올려)\s*(?:두었|뒀|놓았|놨|드렸)|(?:넣었|적었|썼|바꿨|올렸)|완료(?:하였|했|됐|되었))(?:어요|습니다|어|다)?/u;

const AFFIRMATIVE_PERSISTENCE_STATE_RE =
  /(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용)(?:\s*완료(?:예요|입니다)|(?:되어|돼)\s*있(?:어요|습니다|다))/u;

const ENGLISH_AFFIRMATIVE_PERSISTENCE_WORD_RE =
  /\b(?:saved|recorded|registered|updated|changed|modified|added|deleted|removed|cancelled|canceled|confirmed|applied)(?:\s+successfully)?\b/giu;

const ENGLISH_DIRECT_NEGATION_BEFORE_CLAIM_RE =
  /(?:\b(?:not|never)\s+(?:\w+\s+){0,3}|\b(?:isn't|wasn't|hasn't|haven't|cannot|can't)\s+(?:been\s+)?(?:\w+\s+){0,2})$/iu;

const AFFIRMATIVE_MEMORY_CLAIM_RE =
  /(?:기억(?:해\s*(?:둘게|드릴게|놓을게|두겠|드리겠|놓겠)|하고\s*있을게|하고있을게|할게|하겠)(?:요|습니다)?|잊지\s*않(?:을게|겠)(?:요|습니다)?)/u;

const ENGLISH_AFFIRMATIVE_MEMORY_CLAIM_RE =
  /\b(?:i|we)(?:['’]ll| will)\s+remember\b/iu;

const NON_SUCCESS_CONTEXT_RE =
  /(?:라고|이라는|라는)\s*(?:말|표현|문구)|(?:예시|가정|만약|말하면\s*안|하지\s*마)/u;

const SERVER_OWNED_UNVERIFIED_NOTICE =
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
export function composeAmoraPersistenceTerminal({
  text,
  toolResults,
  hasPendingAction,
  persistenceMode,
  demoUserText = "",
}: {
  text: string;
  toolResults: readonly ToolExecutionResult[];
  hasPendingAction: boolean;
  persistenceMode: "durable" | "demo";
  demoUserText?: string;
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
  const trustCorrected = trustScreened.removedCount > 0;
  const sanitized = removeUnverifiedPersistenceClaims(trustScreened.text);

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

  if (sanitized.removedClaimCount === 0) {
    return {
      text: sanitized.text,
      corrected: trustCorrected,
      removedClaimCount: 0,
      source: trustCorrected ? "server_correction" : "provider",
    };
  }

  const notice = hasPendingAction
    ? SERVER_OWNED_PENDING_NOTICE
    : SERVER_OWNED_UNVERIFIED_NOTICE;

  return {
    text: [sanitized.text, notice].filter(Boolean).join("\n\n"),
    corrected: true,
    removedClaimCount: sanitized.removedClaimCount,
    source: "server_correction",
  };
}

function containsUnverifiedSuccessClaim(segment: string): boolean {
  const containsKoreanAffirmativeClaim = AFFIRMATIVE_PERSISTENCE_CLAIM_RE.test(segment)
    || AFFIRMATIVE_PERSISTENCE_STATE_RE.test(segment)
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

function removeUnverifiedPersistenceClaims(text: string): {
  text: string;
  removedClaimCount: number;
} {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return { text: "", removedClaimCount: 0 };
  }

  const segments = normalizedText
    .split(/(?<=[.!?。！？])\s*|\n+/u)
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

  return {
    text: removedClaimCount === 0 ? normalizedText : kept.join("\n\n"),
    removedClaimCount,
  };
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
