import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicProviderSchema, providerCatalogPageSchema, providerMediaUrl, type ProviderCatalogPage, type PublicProvider } from "./contracts";
import { catalogQuerySchema } from "./validation";

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("PROVIDER_UNAVAILABLE");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) } });
}
function mediaUrls(profiles: PublicProvider[]): PublicProvider[] {
  return profiles.map((profile) => ({ ...profile, media: profile.media.map((media) => ({ ...media, image_url: providerMediaUrl(profile.id, media.id) })) }));
}
/** 공개 RPC는 연락처·심사 메모·소유자 식별자를 반환하지 않는다. */
export async function getPublicProviders(id?: string): Promise<PublicProvider[]> {
  if (id) z.string().uuid().parse(id);
  const { data, error } = await publicClient().rpc("provider_public_catalog", { p_provider_id: id ?? null, p_limit: 30 });
  if (error) throw new Error("PROVIDER_UNAVAILABLE");
  return mediaUrls(z.array(publicProviderSchema).parse(data));
}
export async function getPublicProviderPage(input: z.input<typeof catalogQuerySchema> = {}): Promise<ProviderCatalogPage> {
  const query = catalogQuerySchema.parse(input);
  const { data, error } = await publicClient().rpc("provider_search_catalog", {
    p_category: query.category ?? null, p_region: query.region ?? null, p_query: query.q ?? null,
    p_after: query.after ?? null, p_limit: 30, p_recommendation_only: false, p_max_base_price_krw: null,
  });
  if (error) throw new Error("PROVIDER_UNAVAILABLE");
  const page = providerCatalogPageSchema.parse(data);
  return { ...page, providers: mediaUrls(page.providers) };
}
