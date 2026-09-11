import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAmoraMemoryTurnOptOut } from "@/lib/ai/amoraMemoryTurnOptOut";
import type { AmoraMemorySourceScopeRow } from "@/lib/ai/amoraMemorySourceScope";

const KEY = "amora_memory_policy";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = "id,sender_id,sender_type,role,visibility,segment_id,metadata";
type Scope = { coupleId: string; actorId: string; actorRole: "bride" | "groom";
  visibility: "shared" | "bride_private" | "groom_private"; segmentId: string };
type Source = Pick<AmoraMemorySourceScopeRow, "id" | "sender_id" | "sender_type" | "role" | "visibility" | "metadata" | "content" | "segment_id">;
type Policy = { version: 1; scope: "conversation"; effect: "deny"; actorId: string;
  segmentId: string; sourceUserMessageId: string; sourceTextSha256: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export class AmoraMemoryConversationPolicyError extends Error {
  readonly code = "AMORA_MEMORY_POLICY_UNAVAILABLE";
  constructor() { super("AMORA_MEMORY_POLICY_UNAVAILABLE"); this.name = "AmoraMemoryConversationPolicyError"; }
}

/** 한 메시지의 금지를 대화 전체로 넓히지 않는다. 인용은 범위 근거도 될 수 없다. */
export function hasAmoraMemoryConversationOptOut(text: string): boolean {
  const plain = text.normalize("NFKC").replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|'[^'\n]*'|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』/gu, " ")
    .replace(/^\s*>[^\n]*/gmu, " ");
  if (!hasAmoraMemoryTurnOptOut(plain)) return false;
  return /(?:이번|지금\s*이|이)\s*(?:대화|상담)(?:에서|에)?만\s*(?:(?:참고|사용|이용)(?:해\s*(?:줘|주세요)|하고|하되)|써\s*(?:줘|주세요))(?=$|[\s.!?。,;…])/u.test(plain)
    || plain.split(/[.!?。\n]/u).some(clause => /(?:이번|이)\s*(?:대화|상담)(?:는|은|를|을)/u.test(clause)
      && hasAmoraMemoryTurnOptOut(clause));
}

function validateScope(scope: Scope): void {
  if (![scope.coupleId, scope.actorId, scope.segmentId].every(value => UUID.test(value))
    || (scope.visibility !== "shared" && scope.visibility !== `${scope.actorRole}_private`)) throw new AmoraMemoryConversationPolicyError();
}

function owns(source: Partial<Source>, scope: Scope): boolean {
  return typeof source.id === "string" && UUID.test(source.id) && source.sender_id === scope.actorId
    && source.sender_type === scope.actorRole && source.role === "user"
    && source.visibility === scope.visibility && source.segment_id === scope.segmentId
    && source.metadata?.target !== "partner";
}

function policyFor(source: Partial<Source>, scope: Scope): Policy | null {
  if (!record(source.metadata) || !(KEY in source.metadata)) return null;
  const policy = source.metadata[KEY];
  if (!owns(source, scope) || !record(policy) || policy.version !== 1 || policy.scope !== "conversation"
    || policy.effect !== "deny" || policy.actorId !== scope.actorId || policy.segmentId !== scope.segmentId
    || policy.sourceUserMessageId !== source.id || typeof policy.sourceTextSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(policy.sourceTextSha256)) throw new AmoraMemoryConversationPolicyError();
  if (typeof source.content === "string"
    && policy.sourceTextSha256 !== createHash("sha256").update(source.content).digest("hex")) throw new AmoraMemoryConversationPolicyError();
  return policy as Policy;
}

function scopedQuery(admin: SupabaseClient, scope: Scope) {
  return admin.from("chat_messages").select(FIELDS).eq("couple_id", scope.coupleId)
    .eq("sender_id", scope.actorId).eq("sender_type", scope.actorRole).eq("role", "user")
    .eq("visibility", scope.visibility).eq("segment_id", scope.segmentId);
}

async function persistDenial(admin: SupabaseClient, scope: Scope, source: Source, signal: AbortSignal): Promise<void> {
  if (!owns(source, scope) || !hasAmoraMemoryConversationOptOut(source.content)) throw new AmoraMemoryConversationPolicyError();
  if (policyFor(source, scope)) return;
  if (source.metadata !== null && !record(source.metadata)) throw new AmoraMemoryConversationPolicyError();
  const policy: Policy = { version: 1, scope: "conversation", effect: "deny", actorId: scope.actorId,
    segmentId: scope.segmentId, sourceUserMessageId: source.id,
    sourceTextSha256: createHash("sha256").update(source.content).digest("hex") };
  let update = admin.from("chat_messages").update({ metadata: { ...source.metadata, [KEY]: policy } })
    .eq("id", source.id).eq("couple_id", scope.coupleId).eq("sender_id", scope.actorId)
    .eq("sender_type", scope.actorRole).eq("role", "user").eq("visibility", scope.visibility)
    .eq("segment_id", scope.segmentId).eq("content", source.content);
  update = source.metadata === null ? update.is("metadata", null) : update.eq("metadata", JSON.stringify(source.metadata));
  const result = await update.select(FIELDS).abortSignal(signal).maybeSingle();
  if (result.error) throw new AmoraMemoryConversationPolicyError();
  if (result.data && policyFor(result.data, scope)) return;
  // 다른 키를 갱신한 경쟁은 덮지 않는다. 같은 deny를 기록한 재시도만 idempotent 성공이다.
  const retry = await scopedQuery(admin, scope).eq("id", source.id).abortSignal(signal).maybeSingle();
  if (retry.error || !retry.data || !policyFor(retry.data, scope)) throw new AmoraMemoryConversationPolicyError();
}

/** 원문 창은 최초 금지의 복구에만 쓰며, 지속 여부는 항상 cursor 독립 metadata 조회로 판정한다. */
export async function resolveAmoraMemoryConversationPolicy(input: {
  admin: SupabaseClient; scope: Scope; sources?: readonly Source[];
  signal?: AbortSignal;
}): Promise<boolean> {
  try {
    validateScope(input.scope);
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000);
    if (signal.aborted) throw new AmoraMemoryConversationPolicyError();
    for (const source of input.sources ?? []) {
      if (owns(source, input.scope) && hasAmoraMemoryConversationOptOut(source.content)) {
        await persistDenial(input.admin, input.scope, source, signal);
      }
    }
    const result = await scopedQuery(input.admin, input.scope).not(`metadata->${KEY}`, "is", null)
      .order("created_at", { ascending: true }).limit(1).abortSignal(signal).maybeSingle();
    if (result.error) throw new AmoraMemoryConversationPolicyError();
    if (!result.data) return false;
    if (!policyFor(result.data, input.scope)) throw new AmoraMemoryConversationPolicyError();
    return true;
  } catch { throw new AmoraMemoryConversationPolicyError(); }
}

/** 40+1 source 창에 있는 actor/segment만 조회한다. 전체 대화 원문이나 전역 설정을 읽지 않는다. */
export async function resolveAmoraMemoryConversationExclusions(input: {
  admin: SupabaseClient; coupleId: string; visibility: Scope["visibility"];
  couple: { brideId: string | null; groomId: string | null }; rows: readonly AmoraMemorySourceScopeRow[];
  registerDenials?: boolean;
}): Promise<ReadonlySet<string>> {
  const denied = new Set<string>();
  // 41개 scope가 모두 달라도 한 번의 확인에 5초 이상 순차 대기하지 않는다.
  const signal = AbortSignal.timeout(5_000);
  const scopes = new Map<string, Scope>();
  if (input.rows.length > 41) throw new AmoraMemoryConversationPolicyError();
  for (const row of input.rows) {
    if (row.role !== "user" || row.sender_type === "ai" || row.visibility !== input.visibility || row.metadata?.target === "partner") continue;
    if (!row.sender_id || row.sender_id !== (row.sender_type === "bride" ? input.couple.brideId : input.couple.groomId)) continue;
    if (!row.segment_id || !UUID.test(row.segment_id)) { denied.add(row.id); continue; }
    scopes.set(`${row.segment_id}:${row.sender_id}`, { coupleId: input.coupleId, actorId: row.sender_id,
      actorRole: row.sender_type, visibility: input.visibility, segmentId: row.segment_id });
  }
  for (const scope of scopes.values()) {
    if (await resolveAmoraMemoryConversationPolicy({ admin: input.admin, scope, sources: input.registerDenials === false ? [] : input.rows, signal })) {
      for (const row of input.rows) if (owns(row, scope)) denied.add(row.id);
    }
  }
  return denied;
}
