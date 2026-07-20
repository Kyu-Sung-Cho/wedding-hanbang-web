import { Redirect, useLocalSearchParams } from "expo-router";
import {
  buildLegacyVendorDetailUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";

const siteOrigin = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);

export default function LegacyVendorDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const vendorUrl = buildLegacyVendorDetailUrl(rawId, siteOrigin);

  if (!vendorUrl) return <Redirect href="/market-prices" />;
  return (
    <Redirect
      href={{
        pathname: "/webview",
        params: { url: vendorUrl },
      }}
    />
  );
}
