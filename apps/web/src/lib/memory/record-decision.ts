// =============================================
// Record Decision — Bucket C 의사결정 그래프 기록 헬퍼
// =============================================
// 목적: decision_nodes + (optional) decision_edges 기록
// 특징:
//   - Service role로 INSERT (유저 권한 무관)
//   - try/catch로 감싸 예외 절대 propagate 안 함
//   - parents 배열 있으면 decision_edges 자동 생성
//   - 반환값에 nodeId (실패 시 null)
// =============================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  DecisionType,
  DecisionSource,
  DecisionEdgeRelationship,
  StageTag,
} from "@/types/moat.types";

// -------------------------------------------
// 입력 스키마
// -------------------------------------------
export interface DecisionParent {
  nodeId: string;
  relationship: DecisionEdgeRelationship;
  weight?: number;
}

export interface RecordDecisionInput {
  coupleId: string;
  userId?: string | null;
  /** vendor category (studio/dress/...) 또는 'budget'/'timeline'/'venue' 등 */
  category: string;
  title: string;
  chosenValue?: unknown;
  decisionType?: DecisionType;
  stageTag?: StageTag | null;
  source: DecisionSource;
  sourceRefId?: string | null;
  reasoning?: string | null;
  confidence?: number;
  parents?: DecisionParent[];
  metadata?: Record<string, unknown> | null;
  /** 메모리 격리: 'shared' (default) | 'bride_private' | 'groom_private' */
  visibility?: "shared" | "bride_private" | "groom_private";
  /**
   * 중복 방지 — 같은 (couple_id, source_ref_id, source, decision_type) 조합이 이미 있으면
   * 새로 만들지 않고 기존 nodeId 반환. 현재는 찜(favorites) hook에서 활용.
   */
  dedupeKey?: {
    sourceRefId: string;
    source: DecisionSource;
    decisionType: DecisionType;
  };
}

export interface RecordDecisionResult {
  nodeId: string | null;
  deduped?: boolean;
}

// -------------------------------------------
// Service role 클라이언트 (lazy init)
// -------------------------------------------
let _admin: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 미설정");
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

// -------------------------------------------
// 공개 헬퍼: recordDecision
// -------------------------------------------
/**
 * 의사결정 노드(+ 엣지) 기록. 예외는 내부에서 삼킴.
 * fire-and-forget 패턴 OK. 필요 시 반환된 nodeId로 후속 엣지 연결 가능.
 */
export async function recordDecision(
  input: RecordDecisionInput
): Promise<RecordDecisionResult> {
  try {
    const admin = getAdminClient();

    // 1. Dedupe 체크
    if (input.dedupeKey) {
      const { data: existing } = await admin
        .from("decision_nodes")
        .select("id")
        .eq("couple_id", input.coupleId)
        .eq("source_ref_id", input.dedupeKey.sourceRefId)
        .eq("source", input.dedupeKey.source)
        .eq("decision_type", input.dedupeKey.decisionType)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        return { nodeId: String(existing.id), deduped: true };
      }
    }

    // 2. 노드 INSERT
    const { data: node, error: nodeErr } = await admin
      .from("decision_nodes")
      .insert({
        couple_id: input.coupleId,
        category: input.category,
        decision_type: input.decisionType ?? "considering",
        title: input.title,
        chosen_value: input.chosenValue ?? null,
        reasoning: input.reasoning ?? null,
        confidence: input.confidence ?? 0.5,
        stage_tag: input.stageTag ?? null,
        source: input.source,
        source_ref_id: input.sourceRefId ?? null,
        metadata: input.metadata ?? {},
        visibility: input.visibility ?? "shared",
      })
      .select("id")
      .single();

    if (nodeErr || !node) {
      console.error("[record-decision] 노드 INSERT 실패 (무시됨):", nodeErr?.message);
      return { nodeId: null };
    }

    const nodeId = String((node as { id: string }).id);

    // 3. 엣지 INSERT (parents 있을 때만)
    if (input.parents && input.parents.length > 0) {
      const edgeRows = input.parents.map((p) => ({
        couple_id: input.coupleId,
        from_node_id: p.nodeId,
        to_node_id: nodeId,
        relationship: p.relationship,
        weight: p.weight ?? 1.0,
      }));

      const { error: edgeErr } = await admin
        .from("decision_edges")
        .insert(edgeRows);

      if (edgeErr) {
        // 엣지 실패해도 노드는 이미 만들어짐 — 로그만 남김
        console.error("[record-decision] 엣지 INSERT 실패 (무시됨):", edgeErr.message);
      }
    }

    return { nodeId };
  } catch (err) {
    console.error("[record-decision] 예외 (무시됨):", err);
    return { nodeId: null };
  }
}
