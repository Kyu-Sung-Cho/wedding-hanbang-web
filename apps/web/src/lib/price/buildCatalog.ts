import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
} from "./catalog";

const CI_PLACEHOLDER_PROJECT_REF = "abcdefghijklmnopqrst";

function supabaseProjectRef(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const match = /^([a-z0-9]{20})\.supabase\.(?:co|in)$/u.exec(url.hostname);
    return url.protocol === "https:" && url.pathname === "/" ? match?.[1] ?? null : null;
  } catch {
    return null;
  }
}

export function isPriceCatalogBuildPlaceholderEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env.NEXT_PUBLIC_PREVIEW_STUB_MODE === "true") return true;

  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  return env.CI === "true"
    && supabaseProjectRef(rawUrl) === CI_PLACEHOLDER_PROJECT_REF;
}

export function createEmptyPriceCatalog(): PriceCatalog {
  return {
    periodLabel: "기간 확인 필요",
    categories: Object.fromEntries(
      PRICE_CATEGORIES.map((category) => [category, []]),
    ) as Record<PriceCategory, []>,
    counts: Object.fromEntries(
      PRICE_CATEGORIES.map((category) => [category, 0]),
    ) as Record<PriceCategory, number>,
    agencies: [],
  };
}

export async function loadPriceCatalogWithBuildFallback(
  loader: () => Promise<PriceCatalog>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PriceCatalog> {
  if (isPriceCatalogBuildPlaceholderEnvironment(env)) {
    return createEmptyPriceCatalog();
  }
  return loader();
}
