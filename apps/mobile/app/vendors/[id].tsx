import { Redirect } from "expo-router";

// Legacy UUID details cannot be mapped safely to a published disclosure slug
// on-device. Return to the canonical explorer instead of showing stale data.
export default function LegacyVendorDetailScreen() {
  return <Redirect href="/market-prices" />;
}
