import { createAdminClient } from "@/lib/supabase/admin";

export type ChatVisibility = "shared" | "bride_private" | "groom_private";

export interface PersistAiMessageParams {
  isDemo: boolean;
  coupleId: string;
  cleanText: string;
  clientRequestId: string;
  metadata: Record<string, unknown>;
  stageTag: string | null;
  specialistType: string | null;
  visibility: ChatVisibility;
}

export interface PersistedAiMessage {
  id: string | null;
  createdAt: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  stageTag: string | null;
  specialistType: string | null;
  visibility: ChatVisibility | null;
  reused: boolean;
}

export class AiMessagePersistenceError extends Error {
  readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiMessagePersistenceError";
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;
const RETRY_DELAYS_MS = [0, 120, 360] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "23505" || /duplicate|unique/i.test(error.message ?? "")),
  );
}

export async function findPersistedAiMessage(
  params: Pick<PersistAiMessageParams, "coupleId" | "clientRequestId" | "visibility">,
  admin: AdminClient = createAdminClient(),
): Promise<PersistedAiMessage | null> {
  const { data, error } = await admin
    .from("chat_messages")
    .select("id, created_at, content, metadata, stage_tag, specialist_type, visibility")
    .eq("couple_id", params.coupleId)
    .eq("metadata->>client_request_id", params.clientRequestId)
    .eq("sender_type", "ai")
    .eq("role", "assistant")
    .eq("visibility", params.visibility)
    .is("sender_id", null)
    .limit(1);

  if (error) throw error;
  const row = data?.[0];
  if (!row?.id || !row.created_at || typeof row.content !== "string") return null;
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    content: row.content,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    stageTag: (row.stage_tag as string | null) ?? null,
    specialistType: (row.specialist_type as string | null) ?? null,
    visibility: row.visibility as ChatVisibility,
    reused: true,
  };
}

/** Persist the terminal assistant message before the stream acknowledges `done`. */
export async function persistAiMessage(
  params: PersistAiMessageParams,
  admin: AdminClient = createAdminClient(),
): Promise<PersistedAiMessage> {
  if (params.isDemo) {
    return {
      id: null,
      createdAt: null,
      content: params.cleanText,
      metadata: params.metadata,
      stageTag: params.stageTag,
      specialistType: params.specialistType,
      visibility: params.visibility,
      reused: false,
    };
  }
  if (!params.cleanText.trim()) {
    throw new AiMessagePersistenceError("AI response was empty");
  }
  if (!params.clientRequestId) {
    throw new AiMessagePersistenceError("AI request id was missing");
  }

  try {
    const existing = await findPersistedAiMessage(params, admin);
    if (existing) return existing;
  } catch (error) {
    // A transient read failure should not prevent the first INSERT attempt.
    console.warn("[chat] idempotency preflight lookup failed", error);
  }

  const metadata = {
    ...params.metadata,
    client_request_id: params.clientRequestId,
  };
  let lastError: unknown = null;

  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);

    try {
      const { data, error } = await admin
        .from("chat_messages")
        .insert({
          couple_id: params.coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: params.cleanText,
          metadata,
          stage_tag: params.stageTag,
          specialist_type: params.specialistType,
          visibility: params.visibility,
        })
        .select("id, created_at")
        .single();

      if (!error && data?.id && data.created_at) {
        return {
          id: data.id as string,
          createdAt: data.created_at as string,
          content: params.cleanText,
          metadata,
          stageTag: params.stageTag,
          specialistType: params.specialistType,
          visibility: params.visibility,
          reused: false,
        };
      }

      lastError = error ?? new Error("AI message INSERT returned no row");
      if (isUniqueViolation(error)) {
        const existing = await findPersistedAiMessage(params, admin);
        if (existing) return existing;
        throw new AiMessagePersistenceError(
          "AI request id conflicts with a non-assistant message",
          { cause: error },
        );
      }
    } catch (error) {
      if (error instanceof AiMessagePersistenceError) throw error;
      lastError = error;
    }
  }

  throw new AiMessagePersistenceError("AI message could not be persisted", {
    cause: lastError,
  });
}
