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

export declare function buildLegacyVendorDetailUrl(
  vendorId: string | null | undefined,
  siteOrigin: string,
): string | null;

export declare function normalizeMobileSiteUrl(
  value: string | null,
  siteOrigin: string,
): string | null;

export declare function buildShareableMobileSiteUrl(
  value: string | null,
  siteOrigin: string,
): string | null;
