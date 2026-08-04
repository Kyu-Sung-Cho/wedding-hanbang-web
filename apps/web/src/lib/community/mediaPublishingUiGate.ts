/**
 * This flag controls only whether media affordances are shown in the browser.
 * It is never an authorization boundary; every upload and publish API remains
 * protected by the separate server-only media publishing flag.
 */
export function isCommunityMediaPublishingUiEnabled(
  publicFlag: string | undefined,
): boolean {
  return publicFlag === "true";
}
