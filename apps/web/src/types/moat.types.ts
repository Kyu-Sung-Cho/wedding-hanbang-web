// =============================================
// Moat Wiring Types (Bucket C 스키마 대응)
// DB CHECK 제약조건과 1:1 매칭
// =============================================

// chat_messages.stage_tag / decision_nodes.stage_tag
export type StageTag =
  | "planning_0"       // 결심 ~ 상견례
  | "preparation_1"    // 본 준비 D-180 ~ D-30
  | "execution_2"      // D-30 ~ 본식
  | "ceremony_3"       // 본식 당일
  | "settlement_4";    // 결혼 후 정착

// chat_messages.specialist_type / ai_interactions_log.specialist_type
export type SpecialistType =
  | "sangkyeonrye_advisor"    // 상견례/양가/예법
  | "contract_reviewer"       // 계약서/약관/분쟁
  | "budget_optimizer"        // 예산/견적/시세
  | "ceremony_coordinator"    // 본식/식순/하객
  | "settlement_companion"    // 혼인신고/신혼/사후
  | "general";                 // 분류 불가 or 시스템 메시지

// ai_interactions_log.interaction_type
export type InteractionType =
  | "chat_turn"
  | "tool_call"
  | "tool_result"
  | "amora_director"
  | "vendor_recommendation"
  | "feedback"
  | "community_amora_comment";

// decision_nodes.decision_type
export type DecisionType =
  | "exploring"
  | "considering"
  | "decided"
  | "scheduled"
  | "booked"
  | "completed";

// decision_nodes.source
export type DecisionSource =
  | "chat"
  | "manual"
  | "import"
  | "vendor_booking"
  | "schedule"
  | "budget"
  | "onboarding"
  | "community";

// decision_edges.relationship
export type DecisionEdgeRelationship =
  | "depends_on"
  | "alternative_to"
  | "replaces"
  | "budget_shared"
  | "after"
  | "because_of";
