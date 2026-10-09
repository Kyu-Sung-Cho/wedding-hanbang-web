type PathCommitCallback = () => void;
type PathCommitWindow = { __hanbangMonitoringPathCommit?: PathCommitCallback };

/** 번들이 갈려도 콜백 하나만 공유한다. 경로나 오류 원문은 보관하지 않는다. */
export function registerClientMonitoringPathCommit(callback: PathCommitCallback): void {
  if (typeof window === "undefined") return;
  (window as unknown as PathCommitWindow).__hanbangMonitoringPathCommit = callback;
}

/** App Router의 경로 확정 effect가 호출하며 SDK 수명은 instrumentation이 맡는다. */
export function notifyClientMonitoringPathCommit(): void {
  if (typeof window === "undefined") return;
  try {
    (window as unknown as PathCommitWindow).__hanbangMonitoringPathCommit?.();
  } catch {
    // 모니터링 실패가 페이지 이동을 막으면 안 된다.
  }
}
