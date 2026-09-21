export type InviteCodeAttempt = { rawPending: boolean; needsReview: boolean };

// 재마운트로 아직 끝나지 않은 재발급을 우회하지 않는다. 코드 원문은 보관하지 않는다.
const attempts = new Map<string, InviteCodeAttempt>();
const listeners = new Set<(scope: string) => void>();

export function subscribeInviteCodeSettlement(listener: (scope: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function markInviteCodeUnknown(scope: string, attempt: InviteCodeAttempt): void {
  attempt.needsReview = true;
  if (!attempt.rawPending) listeners.forEach(listener => listener(scope));
}

export function settleInviteCodeAttempt(scope: string, attempt: InviteCodeAttempt): void {
  attempt.rawPending = false;
  if (attempt.needsReview) listeners.forEach(listener => listener(scope));
}

export function getInviteCodeAttempt(scope: string): InviteCodeAttempt | undefined {
  return attempts.get(scope);
}

export function beginInviteCodeAttempt(scope: string): InviteCodeAttempt | null {
  if (attempts.has(scope)) return null;
  const attempt = { rawPending: true, needsReview: false };
  attempts.set(scope, attempt);
  return attempt;
}

export function clearInviteCodeAttempt(scope: string, attempt: InviteCodeAttempt): boolean {
  if (attempts.get(scope) !== attempt || attempt.rawPending) return false;
  return attempts.delete(scope);
}
