// 기억을 처음 켜면 기존 기록이 지워진다 — 그 사실을 켜기 전에 세어 둔다.
//
// `set_amora_memory_consent` (20260716090000_amora_memory_engine_v2.sql:1168-1190) 는
// 최초 활성화 트랜잭션 안에서 세 가지를 지운다.
//
//   - decision_nodes  : 사용자가 확인하지 않았고 직접 고치지도 않은 자동 기억
//   - chat_summaries  : 그 범위의 대화 요약 **전부** (조건 없음)
//   - amora_couple_profiles : 그 범위의 프로필 전부
//
// 설계 의도는 "동의 이전에 동의 없이 만들어진 것으로 시작하지 않는다" 이고 그건 옳다.
// 문제는 **화면이 그 말을 한 적이 없다**는 것이다. 설정 화면은 기억 목록을 보여주면서
// 켜기 버튼 옆에 "정리해 다음 상담에 활용해요" 라고만 적어 두었다. 오늘 그 버튼을 누른
// 사람은 자기가 보고 있던 목록이 사라진 이유를 알 방법이 없고, 되돌릴 수도 없다.
//
// 여기서 세는 조건은 위 SQL 의 DELETE 조건과 **같아야 한다.** 다르면 화면이 말한 숫자와
// 실제로 지워지는 양이 어긋나고, 그건 경고가 없는 것보다 나쁘다.
// `amoraMemoryPurgePreview.test.ts` 가 SQL 원문을 읽어 이 조건을 대조한다.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmoraMemoryVisibility } from "@/lib/ai/amoraMemoryCompiler";

export type AmoraMemoryPurgePreview = {
  /** 지금 켜면(공유는 두 사람이 다 켜면) 이만큼이 지워진다. */
  memories: number;
  summaries: number;
  profiles: number;
  total: number;
};

export const EMPTY_PURGE_PREVIEW: AmoraMemoryPurgePreview = {
  memories: 0,
  summaries: 0,
  profiles: 0,
  total: 0,
};

type PurgeCandidateRow = {
  user_confirmed_at?: unknown;
  memory_key?: unknown;
  metadata?: unknown;
};

/**
 * SQL 의 decision_nodes DELETE 조건을 그대로 옮긴 것.
 *
 *   user_confirmed_at IS NULL
 *   AND metadata ->> 'user_corrected' IS DISTINCT FROM 'true'
 *   AND (memory_key IS NOT NULL OR metadata ? 'extracted_by')
 */
export function isPurgedOnFirstActivation(row: PurgeCandidateRow): boolean {
  if (row.user_confirmed_at !== null && row.user_confirmed_at !== undefined) return false;

  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};

  // 사용자가 직접 고친 기억은 "확인했다" 는 뜻이라 살아남는다.
  if (metadata.user_corrected === true || metadata.user_corrected === "true") return false;

  const hasMemoryKey = typeof row.memory_key === "string" && row.memory_key.length > 0;
  const wasAutoExtracted = Object.prototype.hasOwnProperty.call(metadata, "extracted_by");
  return hasMemoryKey || wasAutoExtracted;
}

/**
 * 아직 최초 활성화 퍼지가 일어나지 않은 범위에서, 켜면 지워질 양을 센다.
 *
 * `legacyPurgedAt` 이 이미 찍혀 있으면 퍼지는 다시 돌지 않으므로 0 을 돌려준다 —
 * 세어 보고 판단하는 게 아니라 조회 자체를 하지 않는다.
 */
export async function previewAmoraMemoryPurge(
  admin: SupabaseClient,
  params: {
    coupleId: string;
    visibility: AmoraMemoryVisibility;
    legacyPurgedAt: string | null;
  },
): Promise<AmoraMemoryPurgePreview> {
  if (params.legacyPurgedAt !== null) return EMPTY_PURGE_PREVIEW;

  const [nodesResult, summariesResult, profilesResult] = await Promise.all([
    admin
      .from("decision_nodes")
      .select("user_confirmed_at, memory_key, metadata")
      .eq("couple_id", params.coupleId)
      .eq("visibility", params.visibility)
      .is("user_confirmed_at", null),
    admin
      .from("chat_summaries")
      .select("id", { count: "exact", head: true })
      .eq("couple_id", params.coupleId)
      .eq("visibility", params.visibility),
    admin
      .from("amora_couple_profiles")
      .select("couple_id", { count: "exact", head: true })
      .eq("couple_id", params.coupleId)
      .eq("visibility", params.visibility),
  ]);

  // 셀 수 없으면 0 이 아니라 **모른다**로 다뤄야 맞지만, 화면이 켜기를 막을 근거로는
  // 쓰지 않는다. 세기 실패로 경고가 사라지면 조용히 지워지는 원래 문제로 돌아간다.
  // 그래서 실패한 축은 0 으로 두되 다른 축이 살아 있으면 경고는 여전히 뜬다.
  const memories = nodesResult.error
    ? 0
    : (nodesResult.data ?? []).filter(isPurgedOnFirstActivation).length;
  const summaries = summariesResult.error ? 0 : (summariesResult.count ?? 0);
  const profiles = profilesResult.error ? 0 : (profilesResult.count ?? 0);

  return { memories, summaries, profiles, total: memories + summaries + profiles };
}
