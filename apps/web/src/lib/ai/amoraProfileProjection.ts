import {
  canonicalizeAmoraMemoryText,
  containsPotentialSensitiveData,
  type AmoraMemoryActorRole,
  type AmoraMemoryVisibility,
} from "@/lib/ai/amoraMemoryCompiler";

export const AMORA_PROFILE_PROJECTION_QUERY_LIMIT = 501;
export const AMORA_PROFILE_FIELD_MAX_CHARS = 2_000;

const MAX_PROJECTABLE_NODES = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}:[a-z0-9_]{2,48}$/;
const MEMORY_KINDS = new Set([
  "decision",
  "preference",
  "constraint",
  "relationship",
  "fact",
]);
const VISIBILITY_ORDER: AmoraMemoryVisibility[] = [
  "shared",
  "bride_private",
  "groom_private",
];
const TASTE_NAMESPACES = new Set([
  "style",
  "venue",
  "dress",
  "studio",
  "makeup",
  "photo",
  "flower",
  "ring",
  "honeymoon",
]);

export type AmoraProfileProjectionSourceMessage = {
  id: string;
  coupleId: string;
  visibility: AmoraMemoryVisibility;
  senderId: string;
  senderType: string;
  role: string;
  metadata: unknown;
};

export type AmoraProfileProjectionNode = {
  id: string;
  coupleId: string;
  visibility: AmoraMemoryVisibility;
  memoryKey: string | null;
  memoryKind: string | null;
  title: string | null;
  value: unknown;
  reasoning: string | null;
  confidence: number | null;
  sourceMessageId: string | null;
  sourceActorRole: AmoraMemoryActorRole | null;
  supersededAt: string | null;
  metadata: unknown;
  createdAt: string | null;
  updatedAt: string | null;
  sourceMessage: AmoraProfileProjectionSourceMessage | null;
};

export type ProjectedAmoraProfile = {
  visibility: AmoraMemoryVisibility;
  personaSummary: null;
  budgetPosture: string | null;
  decisionStyle: string | null;
  tasteProfile: string | null;
  communicationStyle: string | null;
  conflictPattern: null;
  sensitiveTopics: [];
  recommendationRules: [];
  openQuestions: [];
  confidenceScore: number;
  updatedAt: string | null;
};

export type AmoraProfileProjectionContext = {
  coupleId: string;
  memberIds: Record<AmoraMemoryActorRole, string | null>;
  allowedVisibilities: readonly AmoraMemoryVisibility[];
  /**
   * 중립 준비 공간이면 슬롯(bride/groom)을 라벨로 쓰지 않는다. 이 경우 라벨은
   * 관점에 의존하므로 viewerUserId 가 함께 있어야 한다 — 없으면 누가 봐도 같은
   * 중립 라벨을 쓴다(액터 구분은 유지되지만 "나/상대"는 알 수 없다).
   */
  neutralMemberPresentation?: boolean;
  viewerUserId?: string | null;
};

export type AmoraProfileProjectionResult = {
  profiles: ProjectedAmoraProfile[];
  rejectedReason: "too_many_nodes" | "invalid_source" | null;
};

type ValidProjectionNode = AmoraProfileProjectionNode & {
  confidence: number;
  memoryKey: string;
  memoryKind: string;
  value: string;
  sourceMessageId: string;
  sourceActorRole: AmoraMemoryActorRole;
};

type ProjectionField =
  | "budgetPosture"
  | "decisionStyle"
  | "tasteProfile"
  | "communicationStyle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMetadataTarget(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.target === "string" ? value.target : null;
}

function isTombstone(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.user_deleted === true
    || value.tombstone === true
    || value.deleted === true;
}

function isExplicitV2Node(value: unknown): boolean {
  return isRecord(value) && value.explicit === true;
}

function isSourceValid(
  node: AmoraProfileProjectionNode,
  context: AmoraProfileProjectionContext,
): node is AmoraProfileProjectionNode & {
  sourceMessageId: string;
  sourceActorRole: AmoraMemoryActorRole;
} {
  const actor = node.sourceActorRole;
  const source = node.sourceMessage;
  if (
    (actor !== "bride" && actor !== "groom")
    || !node.sourceMessageId
    || !UUID_PATTERN.test(node.sourceMessageId)
    || !source
  ) {
    return false;
  }
  const memberId = context.memberIds[actor];
  if (!memberId) return false;
  if (node.visibility === "bride_private" && actor !== "bride") return false;
  if (node.visibility === "groom_private" && actor !== "groom") return false;
  return source.id === node.sourceMessageId
    && source.coupleId === context.coupleId
    && source.coupleId === node.coupleId
    && source.visibility === node.visibility
    && source.senderId === memberId
    && source.senderType === actor
    && source.role === "user"
    && getMetadataTarget(source.metadata) !== "partner";
}

function validateNode(
  node: AmoraProfileProjectionNode,
  context: AmoraProfileProjectionContext,
): ValidProjectionNode | null {
  if (
    node.coupleId !== context.coupleId
    || !context.allowedVisibilities.includes(node.visibility)
    || node.supersededAt !== null
    || isTombstone(node.metadata)
    || !isExplicitV2Node(node.metadata)
    || !isSourceValid(node, context)
    || typeof node.memoryKey !== "string"
    || !MEMORY_KEY_PATTERN.test(node.memoryKey)
    || typeof node.memoryKind !== "string"
    || !MEMORY_KINDS.has(node.memoryKind)
    || typeof node.value !== "string"
    || typeof node.confidence !== "number"
    || !Number.isFinite(node.confidence)
    || node.confidence < 0.8
    || node.confidence > 1
  ) {
    return null;
  }

  const value = canonicalizeAmoraMemoryText(node.value);
  if (value.length === 0 || value.length > 160) return null;
  const dlpCandidate = [
    node.memoryKey,
    node.memoryKind,
    node.title ?? "",
    value,
    node.reasoning ?? "",
  ].join("\n");
  if (containsPotentialSensitiveData(dlpCandidate)) return null;
  return { ...node, value } as ValidProjectionNode;
}

function isV2ProjectionCandidate(
  node: AmoraProfileProjectionNode,
  context: AmoraProfileProjectionContext,
): boolean {
  return node.coupleId === context.coupleId
    && context.allowedVisibilities.includes(node.visibility)
    && node.supersededAt === null
    && !isTombstone(node.metadata)
    && isExplicitV2Node(node.metadata)
    && typeof node.memoryKey === "string"
    && MEMORY_KEY_PATTERN.test(node.memoryKey)
    && typeof node.memoryKind === "string"
    && MEMORY_KINDS.has(node.memoryKind)
    && typeof node.value === "string"
    && canonicalizeAmoraMemoryText(node.value).length > 0
    && typeof node.confidence === "number"
    && Number.isFinite(node.confidence)
    && node.confidence >= 0.8
    && node.confidence <= 1;
}

function newestNode(
  current: ValidProjectionNode,
  candidate: ValidProjectionNode,
): ValidProjectionNode {
  const currentTime = Date.parse(current.updatedAt ?? current.createdAt ?? "");
  const candidateTime = Date.parse(candidate.updatedAt ?? candidate.createdAt ?? "");
  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : Number.NEGATIVE_INFINITY;
  const safeCandidateTime = Number.isFinite(candidateTime) ? candidateTime : Number.NEGATIVE_INFINITY;
  if (safeCandidateTime !== safeCurrentTime) {
    return safeCandidateTime > safeCurrentTime ? candidate : current;
  }
  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

function compareNewestFirst(
  left: ValidProjectionNode,
  right: ValidProjectionNode,
): number {
  const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "");
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "");
  const safeLeftTime = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
  const safeRightTime = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
  if (safeLeftTime !== safeRightTime) return safeRightTime - safeLeftTime;
  return right.id.localeCompare(left.id);
}

function projectionField(node: ValidProjectionNode): ProjectionField | null {
  const namespace = node.memoryKey.split(":", 1)[0];
  if (namespace === "budget") return "budgetPosture";
  if (
    TASTE_NAMESPACES.has(namespace)
    && (node.memoryKind === "preference" || node.memoryKind === "constraint")
  ) {
    return "tasteProfile";
  }
  if (namespace === "decision_process") return "decisionStyle";
  if (namespace === "communication" || namespace === "amora_response") {
    return "communicationStyle";
  }
  return null;
}

function actorLabel(
  actor: AmoraMemoryActorRole,
  context: AmoraProfileProjectionContext,
): string {
  if (context.neutralMemberPresentation !== true) {
    return actor === "bride" ? "신부" : "신랑";
  }
  // 액터 구분은 유지해야 한다 — 한 사람의 말을 두 사람의 합의로 넓히지 않기
  // 위해서다. 그래서 "중립"으로 뭉개지 않고 관점으로 가른다.
  const viewerId = context.viewerUserId ?? null;
  if (viewerId !== null) {
    const actorId = context.memberIds[actor];
    if (actorId !== null) {
      return actorId === viewerId ? "본인" : "상대";
    }
  }
  // 관점을 모르면 누가 봐도 같은 안정된 이름을 쓴다. 슬롯 이름을 노출하지
  // 않으면서 두 사람을 구분한다.
  return actor === "bride" ? "구성원 1" : "구성원 2";
}

function contributionText(
  node: ValidProjectionNode,
  context: AmoraProfileProjectionContext,
): string {
  return `${actorLabel(node.sourceActorRole, context)} 명시 · ${node.memoryKey} = ${node.value}`;
}

function projectVisibility(
  visibility: AmoraMemoryVisibility,
  nodes: readonly ValidProjectionNode[],
  context: AmoraProfileProjectionContext,
): ProjectedAmoraProfile | null {
  const byActorAndKey = new Map<string, ValidProjectionNode>();
  for (const node of nodes) {
    if (node.visibility !== visibility) continue;
    const key = `${node.sourceActorRole}\0${node.memoryKey}`;
    const current = byActorAndKey.get(key);
    byActorAndKey.set(key, current ? newestNode(current, node) : node);
  }

  const mappedContributions = [...byActorAndKey.values()]
    .map((node) => ({ node, field: projectionField(node) }))
    .filter((item): item is { node: ValidProjectionNode; field: ProjectionField } =>
      item.field !== null
    );
  const fields: ProjectionField[] = [
    "budgetPosture",
    "decisionStyle",
    "tasteProfile",
    "communicationStyle",
  ];
  const actors: AmoraMemoryActorRole[] = ["bride", "groom"];
  const contributions = fields.flatMap((field) =>
    actors.flatMap((actor) => mappedContributions
      .filter((item) => item.field === field && item.node.sourceActorRole === actor)
      .sort((left, right) => compareNewestFirst(left.node, right.node))
      .slice(0, 4)
    )
  )
    .sort((left, right) => {
      const actorDifference = left.node.sourceActorRole.localeCompare(right.node.sourceActorRole);
      return actorDifference !== 0
        ? actorDifference
        : left.node.memoryKey.localeCompare(right.node.memoryKey);
    });
  if (contributions.length === 0) return null;

  const fieldText = (field: ProjectionField) => {
    const values = contributions
      .filter((item) => item.field === field)
      .map((item) => contributionText(item.node, context));
    if (values.length === 0) return null;
    const joined = values.join(" / ");
    return joined.length <= AMORA_PROFILE_FIELD_MAX_CHARS
      ? joined
      : `${joined.slice(0, AMORA_PROFILE_FIELD_MAX_CHARS - 1)}…`;
  };
  const updatedAt = contributions
    .map((item) => item.node.updatedAt ?? item.node.createdAt)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1) ?? null;

  return {
    visibility,
    personaSummary: null,
    budgetPosture: fieldText("budgetPosture"),
    decisionStyle: fieldText("decisionStyle"),
    tasteProfile: fieldText("tasteProfile"),
    communicationStyle: fieldText("communicationStyle"),
    conflictPattern: null,
    sensitiveTopics: [],
    recommendationRules: [],
    openQuestions: [],
    confidenceScore: Math.min(...contributions.map((item) => item.node.confidence)),
    updatedAt,
  };
}

export function projectAmoraProfiles(
  nodes: readonly AmoraProfileProjectionNode[],
  context: AmoraProfileProjectionContext,
): AmoraProfileProjectionResult {
  if (nodes.length > MAX_PROJECTABLE_NODES) {
    return { profiles: [], rejectedReason: "too_many_nodes" };
  }
  if (nodes.some(
    (node) => isV2ProjectionCandidate(node, context) && !isSourceValid(node, context),
  )) {
    return { profiles: [], rejectedReason: "invalid_source" };
  }
  const validNodes = nodes
    .map((node) => validateNode(node, context))
    .filter((node): node is ValidProjectionNode => node !== null);
  const allowed = new Set(context.allowedVisibilities);
  const profiles = VISIBILITY_ORDER
    .filter((visibility) => allowed.has(visibility))
    .map((visibility) => projectVisibility(visibility, validNodes, context))
    .filter((profile): profile is ProjectedAmoraProfile => profile !== null);
  return { profiles, rejectedReason: null };
}

export function toPromptAmoraProfiles(
  profiles: readonly ProjectedAmoraProfile[],
  requestedVisibility: AmoraMemoryVisibility,
) {
  return {
    shared: profiles.find((profile) => profile.visibility === "shared") ?? null,
    private: requestedVisibility === "shared"
      ? null
      : profiles.find((profile) => profile.visibility === requestedVisibility) ?? null,
  };
}

export function toAmoraProfileApiRows(
  profiles: readonly ProjectedAmoraProfile[],
) {
  return profiles.map((profile) => ({
    visibility: profile.visibility,
    persona_summary: profile.personaSummary,
    budget_posture: profile.budgetPosture,
    decision_style: profile.decisionStyle,
    taste_profile: profile.tasteProfile,
    communication_style: profile.communicationStyle,
    conflict_pattern: profile.conflictPattern,
    recommendation_rules: profile.recommendationRules,
    open_questions: profile.openQuestions,
    confidence_score: profile.confidenceScore,
    updated_at: profile.updatedAt,
  }));
}

function normalizeSourceMessage(value: unknown): AmoraProfileProjectionSourceMessage | null {
  const source = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!isRecord(source)) return null;
  return {
    id: typeof source.id === "string" ? source.id : "",
    coupleId: typeof source.couple_id === "string" ? source.couple_id : "",
    visibility: source.visibility as AmoraMemoryVisibility,
    senderId: typeof source.sender_id === "string" ? source.sender_id : "",
    senderType: typeof source.sender_type === "string" ? source.sender_type : "",
    role: typeof source.role === "string" ? source.role : "",
    metadata: source.metadata,
  };
}

export function normalizeAmoraProfileProjectionRows(
  rows: readonly unknown[],
): AmoraProfileProjectionNode[] {
  return rows.map((value) => {
    const row = isRecord(value) ? value : {};
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    const chosenValue = isRecord(row.chosen_value) ? row.chosen_value.value : null;
    return {
      id: typeof row.id === "string" ? row.id : "",
      coupleId: typeof row.couple_id === "string" ? row.couple_id : "",
      visibility: row.visibility as AmoraMemoryVisibility,
      memoryKey: typeof row.memory_key === "string" ? row.memory_key : null,
      memoryKind: typeof metadata.memory_kind === "string" ? metadata.memory_kind : null,
      title: typeof row.title === "string" ? row.title : null,
      value: chosenValue,
      reasoning: typeof row.reasoning === "string" ? row.reasoning : null,
      confidence: typeof row.confidence === "number" ? row.confidence : null,
      sourceMessageId: typeof row.source_message_id === "string" ? row.source_message_id : null,
      sourceActorRole:
        row.source_actor_role === "bride" || row.source_actor_role === "groom"
          ? row.source_actor_role
          : null,
      supersededAt: typeof row.superseded_at === "string" ? row.superseded_at : null,
      metadata,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      sourceMessage: normalizeSourceMessage(row.source_message),
    };
  });
}
