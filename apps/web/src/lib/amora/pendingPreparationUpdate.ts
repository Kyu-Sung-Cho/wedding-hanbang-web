export type PendingPreparationUpdate = { scope: string; id: string; rawPending: boolean; needsReview: boolean };

// 원문은 보관하지 않는다. 화면 이동/계정 복귀로 미완료 쓰기를 우회하지 못하게 한다.
const attempts = new Map<string, PendingPreparationUpdate>();
const listeners = new Set<() => void>();
const key = (scope: string, id: string) => JSON.stringify([scope, id]);
let revision = 0;
let writeSequence = 0;
const notify = () => { revision += 1; listeners.forEach(listener => listener()); };
export const preparationUpdateRevision = () => revision;
export const preparationWriteSequence = () => writeSequence;
export const subscribePreparationUpdates = (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export const getPreparationUpdate = (scope: string, id: string) => attempts.get(key(scope, id));
export const listPreparationUpdates = (scope: string) => [...attempts.values()].filter(attempt => attempt.scope === scope);
export function beginPreparationUpdate(scope: string, id: string): PendingPreparationUpdate | null {
  if (getPreparationUpdate(scope, id)) return null;
  const attempt = { scope, id, rawPending: true, needsReview: false };
  attempts.set(key(scope, id), attempt); writeSequence += 1; notify(); return attempt;
}
export function settlePreparationUpdate(attempt: PendingPreparationUpdate) {
  attempt.rawPending = false; notify();
}
export function markPreparationUpdateUnknown(attempt: PendingPreparationUpdate) {
  attempt.needsReview = true; notify();
}
export function clearPreparationUpdate(attempt: PendingPreparationUpdate): boolean {
  if (attempt.rawPending || getPreparationUpdate(attempt.scope, attempt.id) !== attempt) return false;
  attempts.delete(key(attempt.scope, attempt.id)); notify(); return true;
}
