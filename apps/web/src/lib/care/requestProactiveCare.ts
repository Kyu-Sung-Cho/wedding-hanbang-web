/**
 * Triggers an authenticated, same-origin proactive-care check without making
 * page rendering depend on the network request.
 */
export async function requestProactiveCare(): Promise<void> {
  try {
    await fetch("/api/chat/proactive", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    // Realtime/polling will continue to work; the next eligible page entry can retry.
  }
}
