export type MobileSiteOriginOptions = {
  isDevelopment: boolean;
};

export declare function resolveMobileSiteOrigin(
  configuredSiteUrl: string | undefined,
  options: MobileSiteOriginOptions,
): string;

export declare function buildMobileSiteUrl(
  pathname: string,
  siteOrigin: string,
): string;

export declare function normalizeMobileSiteUrl(
  value: string | null,
  siteOrigin: string,
): string | null;
