import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicProviderSchema, providerMediaUrl, type PublicProvider } from "./contracts";

/** 공개 RPC는 연락처·심사 메모·소유자 식별자를 반환하지 않는다. */
export async function getPublicProviders(id?: string): Promise<PublicProvider[]> {
  if (id) z.string().uuid().parse(id);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("PROVIDER_UNAVAILABLE");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) } });
  const { data, error } = await client.rpc("provider_public_catalog", { p_provider_id: id ?? null, p_limit: 30 });
  if (error) throw new Error("PROVIDER_UNAVAILABLE");
  return z.array(publicProviderSchema).parse(data).map((profile) => ({ ...profile, media: profile.media.map((media) => ({ ...media, image_url: providerMediaUrl(profile.id, media.id) })) }));
}
