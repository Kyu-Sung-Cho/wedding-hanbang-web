import { Redirect } from "expo-router";

// Native vendor discovery previously duplicated ranking and price semantics.
// The disclosure explorer is the sole consumer source of vendor price truth.
export default function LegacyVendorsScreen() {
  return <Redirect href="/market-prices" />;
}
