import {
  validateAmoraScheduleCareFollowUpBinding,
  validateAmoraScheduleCareFollowUpPreview,
  type AmoraScheduleCareFollowUpBinding,
} from "@hanbang/shared/amora-schedule-care-follow-up";

import { buildTodayOneScheduleCandidates } from "@/lib/care/todayOne";
import { ymdInKst } from "@/lib/utils/kstDate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEvents } from "@/utils/scheduleEvents";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AmoraScheduleCareFollowUpResolutionFailure =
  | "invalid_binding"
  | "scope_changed"
  | "privacy_unavailable"
  | "source_unavailable"
  | "card_stale"
  | "signal_stale"
  | "journey_stale"
  | "moment_stale";

export type AmoraScheduleCareFollowUpResolverClient = Pick<
  ReturnType<typeof createAdminClient>,
  "from" | "rpc"
>;

export interface ResolvedAmoraScheduleCareFollowUp {
  recipientUserId: string;
  coupleId: string;
  actorRole: "bride" | "groom";
  privacyEpoch: number;
  binding: AmoraScheduleCareFollowUpBinding;
  expiresAt: string;
  sourceKey: string;
  sourceStateDigest: string;
  sourceEventId: string;
  momentType: "sanggyeonrye";
  attentionWindow: "dAfter";
  eventTitle: string;
  eventDate: string;
  question: string;
  prompt: string;
}

export type AmoraScheduleCareFollowUpResolution =
  | { ok: true; value: ResolvedAmoraScheduleCareFollowUp }
  | { ok: false; reason: AmoraScheduleCareFollowUpResolutionFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonnegativeSafeInteger(value) && value >= 1;
}

function failed(
  reason: AmoraScheduleCareFollowUpResolutionFailure,
): AmoraScheduleCareFollowUpResolution {
  return { ok: false, reason };
}

function buildCanonicalPrompt(input: {
  question: string;
}): string {
  return [
    "어제 상견례에서 실제로 합의된 것과 아직 이야기 중인 것을 나만 아모라와 정리할게요.",
    "",
    input.question,
    "",
    "내 답:",
  ].join("\n");
}

export async function resolveAmoraScheduleCareFollowUp(input: {
  client: AmoraScheduleCareFollowUpResolverClient;
  recipientUserId: string;
  coupleId: string;
  binding: AmoraScheduleCareFollowUpBinding;
  now?: Date;
}): Promise<AmoraScheduleCareFollowUpResolution> {
  const binding = validateAmoraScheduleCareFollowUpBinding(input.binding);
  const now = input.now ?? new Date();
  if (
    !binding.ok
    || !isUuid(input.recipientUserId)
    || !isUuid(input.coupleId)
    || Number.isNaN(now.getTime())
  ) return failed("invalid_binding");

  const recipientUserId = input.recipientUserId.toLowerCase();
  const coupleId = input.coupleId.toLowerCase();

  try {
    const { data: profile, error: profileError } = await input.client
      .from("profiles")
      .select("couple_id, role")
      .eq("id", recipientUserId)
      .single();
    if (profileError) return failed("source_unavailable");
    if (
      !profile
      || profile.couple_id !== coupleId
      || (profile.role !== "bride" && profile.role !== "groom")
    ) return failed("scope_changed");

    const { data: couple, error: coupleError } = await input.client
      .from("couples")
      .select("bride_id, groom_id")
      .eq("id", coupleId)
      .single();
    if (coupleError) return failed("source_unavailable");
    const rosterMatches = profile.role === "bride"
      ? couple?.bride_id === recipientUserId
      : couple?.groom_id === recipientUserId;
    if (!rosterMatches) return failed("scope_changed");

    const { data: privacyEpoch, error: privacyError } = await input.client.rpc(
      "get_own_amora_privacy_epoch",
      { p_couple_id: coupleId, p_visibility: "shared" },
    );
    if (privacyError || !isPositiveSafeInteger(privacyEpoch)) {
      return failed("privacy_unavailable");
    }

    const { data: journey, error: journeyError } = await input.client
      .from("wedding_journeys")
      .select("wedding_date, progress, state_revision")
      .eq("couple_id", coupleId)
      .single();
    if (journeyError) return failed("source_unavailable");
    if (
      !journey
      || !(journey.wedding_date === null || typeof journey.wedding_date === "string")
      || !isRecord(journey.progress)
      || !isNonnegativeSafeInteger(journey.state_revision)
      || journey.state_revision !== binding.value.sourceRevision
    ) return failed("journey_stale");

    const { data: card, error: cardError } = await input.client
      .from("amora_today_one_recipient_states")
      .select(
        "id, signal_id, couple_id, recipient_user_id, revision, source_revision, state_digest, state, claimed_for_date, expires_at",
      )
      .eq("id", binding.value.cardId)
      .eq("couple_id", coupleId)
      .eq("recipient_user_id", recipientUserId)
      .maybeSingle();
    if (cardError) return failed("source_unavailable");
    const expiresAtMs = typeof card?.expires_at === "string"
      ? Date.parse(card.expires_at)
      : Number.NaN;
    if (
      !card
      || card.id !== binding.value.cardId
      || !isUuid(card.signal_id)
      || card.couple_id !== coupleId
      || card.recipient_user_id !== recipientUserId
      || card.revision !== binding.value.cardRevision
      || card.source_revision !== binding.value.sourceRevision
      || typeof card.state_digest !== "string"
      || !/^[0-9a-f]{64}$/u.test(card.state_digest)
      || card.state !== "ready"
      || card.claimed_for_date !== ymdInKst(now)
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= now.getTime()
    ) return failed("card_stale");
    const expiresAt = new Date(expiresAtMs).toISOString();

    const { data: signal, error: signalError } = await input.client
      .from("amora_today_one_signals")
      .select(
        "id, couple_id, recipient_user_id, source_key, state_digest, source_revision, kind, muted_at",
      )
      .eq("id", card.signal_id)
      .eq("couple_id", coupleId)
      .eq("recipient_user_id", recipientUserId)
      .maybeSingle();
    if (signalError) return failed("source_unavailable");
    if (
      !signal
      || signal.id !== card.signal_id
      || signal.couple_id !== coupleId
      || signal.recipient_user_id !== recipientUserId
      || typeof signal.source_key !== "string"
      || signal.state_digest !== card.state_digest
      || signal.source_revision !== binding.value.sourceRevision
      || signal.kind !== "schedule_moment"
      || signal.muted_at !== null
    ) return failed("signal_stale");

    const candidate = buildTodayOneScheduleCandidates({
      weddingDate: journey.wedding_date,
      progress: journey.progress,
      stateRevision: journey.state_revision,
      now,
    }).find((current) => (
      current.sourceKey === signal.source_key
      && current.sourceStateDigest === signal.state_digest
      && current.sourceRevision === binding.value.sourceRevision
      && current.attentionWindow === "dAfter"
      && current.care?.momentType === "sanggyeonrye"
      && current.care.attentionWindow === "dAfter"
      && typeof current.care.question === "string"
    ));
    if (!candidate?.care?.question) return failed("moment_stale");

    const sourceEvents = getEvents(journey.progress).filter(
      (event) => event.id === candidate.sourceEventId,
    );
    if (sourceEvents.length !== 1) return failed("moment_stale");
    const sourceEvent = sourceEvents[0];
    if (!sourceEvent || sourceEvent.momentType !== "sanggyeonrye") {
      return failed("moment_stale");
    }
    const eventDate = `${sourceEvent.date}${sourceEvent.time ? ` ${sourceEvent.time}` : ""}`;
    const prompt = buildCanonicalPrompt({
      question: candidate.care.question,
    });
    const preview = validateAmoraScheduleCareFollowUpPreview({
      version: 1,
      state: "ready",
      recipientUserId,
      coupleId,
      binding: binding.value,
      expiresAt,
      prompt,
    }, { recipientUserId, coupleId, nowMs: now.getTime() });
    if (!preview.ok) return failed("moment_stale");

    return {
      ok: true,
      value: {
        recipientUserId,
        coupleId,
        actorRole: profile.role,
        privacyEpoch,
        binding: preview.value.binding,
        expiresAt: preview.value.expiresAt,
        sourceKey: candidate.sourceKey,
        sourceStateDigest: candidate.sourceStateDigest,
        sourceEventId: candidate.sourceEventId,
        momentType: "sanggyeonrye",
        attentionWindow: "dAfter",
        eventTitle: sourceEvent.title,
        eventDate,
        question: candidate.care.question,
        prompt: preview.value.prompt,
      },
    };
  } catch {
    return failed("source_unavailable");
  }
}
