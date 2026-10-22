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

import { createAdminClient } from "@/lib/supabase/admin";
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
  /** 작성자 역할 (신부 / 신랑 / 중립) */
  sourceActorRole?: "bride" | "groom" | null;
  /**
   * 중복 방지 — 문자열 키(metadata->>dedupe_key) 또는
   * (couple_id, source_ref_id, source, decision_type) 조합이 이미 있으면
   * 새로 만들지 않고 기존 노드를 재사용/갱신.
   */
  dedupeKey?:
    | string
    | {
        sourceRefId: string;
        source: DecisionSource;
        decisionType: DecisionType;
      };
}

export type RecordDecisionParams = RecordDecisionInput;

export interface RecordDecisionResult {
  nodeId: string | null;
  deduped?: boolean;
}

const getAdminClient = createAdminClient;

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

    const baseMetadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(typeof input.dedupeKey === "string" && input.dedupeKey.trim()
        ? { dedupe_key: input.dedupeKey.trim() }
        : {}),
    };

    // 1. Dedupe 체크
    if (typeof input.dedupeKey === "string" && input.dedupeKey.trim()) {
      const trimmedKey = input.dedupeKey.trim();
      const { data: existing } = await admin
        .from("decision_nodes")
        .select("id")
        .eq("couple_id", input.coupleId)
        .eq("metadata->>dedupe_key", trimmedKey)
        .is("superseded_at", null)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        await admin
          .from("decision_nodes")
          .update({
            category: input.category,
            decision_type: input.decisionType ?? "considering",
            title: input.title,
            chosen_value: input.chosenValue ?? null,
            reasoning: input.reasoning ?? null,
            confidence: input.confidence ?? 0.5,
            stage_tag: input.stageTag ?? null,
            metadata: baseMetadata,
            ...(input.sourceActorRole !== undefined
              ? { source_actor_role: input.sourceActorRole ?? null }
              : {}),
          })
          .eq("id", existing.id);
        return { nodeId: String(existing.id), deduped: true };
      }
    } else if (input.dedupeKey && typeof input.dedupeKey === "object") {
      const { data: existing } = await admin
        .from("decision_nodes")
        .select("id")
        .eq("couple_id", input.coupleId)
        .eq("source_ref_id", input.dedupeKey.sourceRefId)
        .eq("source", input.dedupeKey.source)
        .eq("decision_type", input.dedupeKey.decisionType)
        .is("superseded_at", null)
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
        metadata: baseMetadata,
        visibility: input.visibility ?? "shared",
        ...(input.sourceActorRole !== undefined
          ? { source_actor_role: input.sourceActorRole ?? null }
          : {}),
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
