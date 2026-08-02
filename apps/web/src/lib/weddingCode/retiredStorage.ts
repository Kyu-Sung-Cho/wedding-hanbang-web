export const RETIRED_WEDDING_CODE_RESULT_STORAGE_KEY = "wc_result_v05";

/** Remove the retired v0.5 answer snapshot from a shared browser profile. */
export function clearRetiredWeddingCodeStorage(
  storage: Pick<Storage, "removeItem"> | null =
    typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage) return;
  try {
    storage.removeItem(RETIRED_WEDDING_CODE_RESULT_STORAGE_KEY);
  } catch {
    // Identity transitions continue even when browser storage is unavailable.
  }
}
