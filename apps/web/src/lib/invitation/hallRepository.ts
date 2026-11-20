import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { parseHallListing, type HallListing } from "./hallCompare";

/**
 * 웨딩홀 자료와 커플이 담은 홀 읽기. 사용자 권한(RLS)으로 읽어서 공개 중인 홀과 내 커플이 담은 홀만 보인다.
 * 이 파일은 운영자가 넣은 `hall_listings` 만 읽는다. 공개 가격 공시 표는 읽지 않는다(D-79).
 */

export const MAX_COMPARE_HALLS = 30;
export const MAX_SHORTLIST = 10;

export type ReadResult<T> = { ok: true; value: T } | { ok: false };

function listings(rows: unknown): HallListing[] {
  return Array.isArray(rows) ? rows.map(parseHallListing).filter((hall): hall is HallListing => hall !== null) : [];
}

export async function readRegionHalls(supabase: SupabaseClient, region: string): Promise<ReadResult<HallListing[]>> {
  const { data, error } = await supabase
    .from("hall_listings")
    .select("id, name, region, area_label, kind_label, meal_price_won, rental_fee_won, rental_included, minimum_guarantee, station_walk_minutes, transit_note, photo_url, source_url, checked_on, active")
    .eq("region", region)
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(MAX_COMPARE_HALLS);
  if (error) return { ok: false };
  return { ok: true, value: listings(data) };
}

export async function readHallsByIds(supabase: SupabaseClient, ids: readonly string[]): Promise<ReadResult<HallListing[]>> {
  if (ids.length === 0) return { ok: true, value: [] };
  const { data, error } = await supabase
    .from("hall_listings")
    .select("id, name, region, area_label, kind_label, meal_price_won, rental_fee_won, rental_included, minimum_guarantee, station_walk_minutes, transit_note, photo_url, source_url, checked_on, active")
    .in("id", [...ids])
    .limit(MAX_COMPARE_HALLS);
  if (error) return { ok: false };
  return { ok: true, value: listings(data) };
}

/** 담은 순서대로 홀 ID. */
export async function readShortlist(supabase: SupabaseClient, coupleId: string): Promise<ReadResult<string[]>> {
  const { data, error } = await supabase
    .from("hall_shortlists")
    .select("hall_id, created_at")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: true })
    .limit(MAX_SHORTLIST);
  if (error) return { ok: false };
  const ids = Array.isArray(data)
    ? data.flatMap((row) => (isRecord(row) && isUuid(row.hall_id) ? [row.hall_id.toLowerCase()] : []))
    : [];
  return { ok: true, value: ids };
}
