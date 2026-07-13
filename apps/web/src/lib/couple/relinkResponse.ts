/**
 * A replacement-couple request needs a full client reload only when the HTTP
 * boundary cannot prove that the mutation rolled back. Deterministic 4xx
 * responses are safe to keep on-screen so their actionable message survives.
 */
export function shouldReloadAfterFreshSpaceResponse(status: number | null): boolean {
  return status === null || (status >= 200 && status < 300) || status >= 500;
}
