import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AmoraMemoryVisibility } from "@/lib/ai/amoraMemoryCompiler";

type AmoraActorRole = "bride" | "groom";

export type AmoraPrivacyMemoryState = {
  enabled: boolean;
  resetAt: string | null;
};

export type AmoraPrivacyContextSnapshot = {
  version: 2;
  privacyEpoch: number;
  actorRole: AmoraActorRole;
  rosterFingerprint: string;
  memory: Record<AmoraMemoryVisibility, AmoraPrivacyMemoryState>;
  personalization: {
    exists: boolean;
    revision: number | null;
  };
};

export type AmoraPrivacyContextErrorCode =
  | "AMORA_PRIVACY_CONTEXT_UNAVAILABLE"
  | "AMORA_PRIVACY_CONTEXT_CHANGED";

export type AmoraMemoryEnqueueResult =
  | "queued"
  | "requeued"
  | "not_requested"
  | "disabled"
  | "before_boundary"
  | "duplicate"
  | "dead_letter"
  | "failed";

export class AmoraPrivacyContextError extends Error {
  constructor(readonly code: AmoraPrivacyContextErrorCode) {
    super(code);
    this.name = "AmoraPrivacyContextError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyMemoryState(): Record<
  AmoraMemoryVisibility,
  AmoraPrivacyMemoryState
> {
  return {
    shared: { enabled: false, resetAt: null },
    bride_private: { enabled: false, resetAt: null },
    groom_private: { enabled: false, resetAt: null },
  };
}

function parsePrivacyMemoryState(
  value: unknown,
  runtimeEnabled: boolean,
): AmoraPrivacyMemoryState | null {
  if (
    !isRecord(value)
    || typeof value.enabled !== "boolean"
    || (value.resetAt !== null && typeof value.resetAt !== "string")
  ) {
    return null;
  }
  return {
    enabled: runtimeEnabled && value.enabled,
    resetAt: value.resetAt,
  };
}

function parseAmoraPrivacyContextSnapshot(
  value: unknown,
  requestedVisibilities: readonly AmoraMemoryVisibility[],
): AmoraPrivacyContextSnapshot | null {
  if (
    !isRecord(value)
    || value.version !== 2
    || !Number.isSafeInteger(value.privacyEpoch)
    || (value.privacyEpoch as number) < 1
    || (value.actorRole !== "bride" && value.actorRole !== "groom")
    || typeof value.rosterFingerprint !== "string"
    || !/^[a-f0-9]{32}$/.test(value.rosterFingerprint)
    || !isRecord(value.memory)
    || !isRecord(value.personalization)
    || typeof value.personalization.exists !== "boolean"
  ) {
    return null;
  }

  const personalizationRevision = value.personalization.revision;
  if (
    value.personalization.exists
      ? !Number.isSafeInteger(personalizationRevision)
        || (personalizationRevision as number) < 1
      : personalizationRevision !== null
  ) {
    return null;
  }

  const requested = [...new Set(requestedVisibilities)];
  if (
    requested.length === 0
    || requested.length > 2
    || Object.keys(value.memory).length !== requested.length
    || !requested.every((visibility) =>
      Object.prototype.hasOwnProperty.call(value.memory, visibility)
    )
  ) {
    return null;
  }

  const memory = emptyMemoryState();
  const runtimeEnabled = isAuxiliaryMemoryRuntimeEnabled();
  for (const visibility of requested) {
    const state = parsePrivacyMemoryState(
      value.memory[visibility],
      runtimeEnabled,
    );
    if (!state) return null;
    memory[visibility] = state;
  }

  return {
    version: 2,
    privacyEpoch: value.privacyEpoch as number,
    actorRole: value.actorRole,
    rosterFingerprint: value.rosterFingerprint,
    memory,
    personalization: {
      exists: value.personalization.exists,
      revision: value.personalization.exists
        ? (personalizationRevision as number)
        : null,
    },
  };
}

export async function getAmoraPrivacyEpoch(
  coupleId: string,
  visibility: AmoraMemoryVisibility,
  client: SupabaseClient,
): Promise<number> {
  const { data, error } = await client.rpc(
    "get_own_amora_privacy_epoch",
    {
      p_couple_id: coupleId,
      p_visibility: visibility,
    },
  );
  if (
    error
    || !Number.isSafeInteger(data)
    || (data as number) < 1
  ) {
    console.error(
      "[amora-privacy-context] epoch lookup failed",
      error?.code ?? "invalid_result",
    );
    throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
  }
  return data as number;
}

export function isAuxiliaryMemoryRuntimeEnabled(): boolean {
  return process.env.AMORA_AUXILIARY_MEMORY_ENABLED === "true";
}

export async function getAmoraPrivacyContextSnapshot(
  coupleId: string,
  visibilities: readonly AmoraMemoryVisibility[],
  client: SupabaseClient,
): Promise<AmoraPrivacyContextSnapshot> {
  const requested = [...new Set(visibilities)];
  if (requested.length === 0 || requested.length > 2) {
    throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
  }

  const { data, error } = await client.rpc(
    "get_own_amora_privacy_context_snapshot",
    {
      p_couple_id: coupleId,
      p_visibilities: requested,
    },
  );
  if (error) {
    console.error(
      "[amora-privacy-context] snapshot lookup failed",
      error.code ?? "unknown",
    );
    throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
  }

  const snapshot = parseAmoraPrivacyContextSnapshot(data, requested);
  if (!snapshot) {
    console.error("[amora-privacy-context] invalid snapshot result");
    throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
  }
  return snapshot;
}

export function assertAmoraPrivacyContextSnapshotCurrent(
  initial: AmoraPrivacyContextSnapshot,
  current: AmoraPrivacyContextSnapshot,
  visibilities: readonly AmoraMemoryVisibility[],
): void {
  if (
    initial.version !== current.version
    || initial.privacyEpoch !== current.privacyEpoch
    || initial.actorRole !== current.actorRole
    || initial.rosterFingerprint !== current.rosterFingerprint
    || initial.personalization.exists !== current.personalization.exists
    || initial.personalization.revision !== current.personalization.revision
  ) {
    throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
  }

  for (const visibility of new Set(visibilities)) {
    const initialMemory = initial.memory[visibility];
    const currentMemory = current.memory[visibility];
    // A newly enabled scope was not included in the already-built prompt, so
    // it is safe to finish this turn without rebuilding. A scope that supplied
    // context must remain enabled and on the exact same reset boundary.
    if (
      initialMemory.enabled
      && (
        !currentMemory.enabled
        || initialMemory.resetAt !== currentMemory.resetAt
      )
    ) {
      throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
    }
  }
}

export async function getAmoraMemoryEnablement(
  coupleId: string,
  visibilities: readonly AmoraMemoryVisibility[],
  admin?: SupabaseClient,
): Promise<Record<AmoraMemoryVisibility, boolean>> {
  const result: Record<AmoraMemoryVisibility, boolean> = {
    shared: false,
    bride_private: false,
    groom_private: false,
  };
  if (!isAuxiliaryMemoryRuntimeEnabled()) return result;
  const client = admin ?? createAdminClient();
  const requested = [...new Set(visibilities)];
  if (requested.length === 0) return result;
  const checks = await Promise.all(requested.map(async (visibility) => {
    const { data, error } = await client.rpc("has_current_amora_memory_consent", {
      p_couple_id: coupleId,
      p_visibility: visibility,
    });
    if (error) {
      console.error("[amora-memory] current consent lookup failed", error.code ?? "unknown");
      return [visibility, false] as const;
    }
    return [visibility, data === true] as const;
  }));
  for (const [visibility, enabled] of checks) {
    result[visibility] = enabled;
  }
  return result;
}

export async function enqueueAmoraMemoryJob(input: {
  coupleId: string;
  userId: string;
  visibility: AmoraMemoryVisibility;
  toMessageId: string;
  admin?: SupabaseClient;
}): Promise<AmoraMemoryEnqueueResult> {
  if (!isAuxiliaryMemoryRuntimeEnabled()) return "disabled";
  try {
    const admin = input.admin ?? createAdminClient();
    const { data, error } = await admin.rpc("enqueue_amora_memory_job", {
      p_couple_id: input.coupleId,
      p_user_id: input.userId,
      p_visibility: input.visibility,
      p_to_message_id: input.toMessageId,
    });
    if (
      !error
      && (
        data === "queued"
        || data === "requeued"
        || data === "not_requested"
        || data === "disabled"
        || data === "before_boundary"
        || data === "duplicate"
        || data === "dead_letter"
      )
    ) {
      return data;
    }
    console.error("[amora-memory] enqueue failed", error?.code ?? "invalid_result");
  } catch {
    console.error("[amora-memory] enqueue failed", "transport_error");
  }
  return "failed";
}

export const __private__ = {
  parseAmoraPrivacyContextSnapshot,
};
