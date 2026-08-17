import {
  AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT,
  isAmoraPreparationTopicMessageRefTopicKey,
  parseAmoraPreparationTopicMessageRefMutationRequest,
  validateAmoraPreparationTopicMessageRefCollectionResponse,
  validateAmoraPreparationTopicMessageRefMutationResponse,
  validateAmoraPreparationTopicMessageRefStateResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
import { NextResponse } from "next/server";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 2_048;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type RequestContext = {
  userId: string;
  coupleId: string;
  privacyEpoch: number;
};

type ContextResult =
  | { ok: true; value: RequestContext }
  | { ok: false; response: NextResponse };

function isMissingRowError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "PGRST116";
}

async function loadContext(request: Request): Promise<ContextResult> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_AUTH_REQUIRED" }, 401),
    };
  }
  const userId = user.id.toLowerCase();
  const actor = verifyMutationActorFence(request.headers, userId, {
    allowLegacy: false,
  });
  if (!actor.ok) {
    return { ok: false, response: response({ code: actor.code }, actor.status) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (profileError && !isMissingRowError(profileError)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503),
    };
  }
  if (
    !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409),
    };
  }
  const coupleId = profile.couple_id.toLowerCase();
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  if (coupleError && !isMissingRowError(coupleError)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503),
    };
  }
  const rosterMatches = !coupleError && (
    (profile.role === "bride"
      && isUuid(couple?.bride_id)
      && couple.bride_id.toLowerCase() === userId)
    || (profile.role === "groom"
      && isUuid(couple?.groom_id)
      && couple.groom_id.toLowerCase() === userId)
  );
  if (!rosterMatches) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409),
    };
  }

  const { data: privacyEpoch, error: privacyError } = await supabase.rpc(
    "get_own_amora_privacy_epoch",
    { p_couple_id: coupleId, p_visibility: "shared" },
  );
  if (
    privacyError
    || !Number.isSafeInteger(privacyEpoch)
    || privacyEpoch < 1
  ) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_PRIVACY_UNAVAILABLE" }, 503),
    };
  }
  return {
    ok: true,
    value: { userId, coupleId, privacyEpoch },
  };
}

function privateRateLimit(responseValue: NextResponse) {
  responseValue.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  responseValue.headers.set("Vary", PRIVATE_HEADERS.Vary);
  return responseValue;
}

function mapRpcError(error: { code?: unknown }) {
  if (error.code === "P0002") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND" }, 404);
  }
  if (error.code === "40001") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT" }, 409);
  }
  if (error.code === "22023") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
  }
  return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
}

type ReadQuery =
  | { mode: "list" }
  | { mode: "state"; topicKey: string; messageId: string };

function parseReadQuery(request: Request): ReadQuery | null {
  const searchParams = new URL(request.url).searchParams;
  const entries = [...searchParams.entries()];
  if (entries.length === 0) return { mode: "list" };
  if (
    entries.length !== 2
    || searchParams.getAll("topicKey").length !== 1
    || searchParams.getAll("messageId").length !== 1
    || entries.some(([key]) => key !== "topicKey" && key !== "messageId")
  ) return null;
  const topicKey = searchParams.get("topicKey");
  const messageId = searchParams.get("messageId");
  if (!isAmoraPreparationTopicMessageRefTopicKey(topicKey) || !isUuid(messageId)) {
    return null;
  }
  return { mode: "state", topicKey, messageId: messageId.toLowerCase() };
}

export async function GET(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_ORIGIN_REJECTED" }, 403);
    }
    const query = parseReadQuery(request);
    if (!query) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_QUERY_INVALID" }, 400);
    }
    const loaded = await loadContext(request);
    if (!loaded.ok) return loaded.response;
    const context = loaded.value;
    const limited = checkRateLimit(
      rateLimitKey("amora-preparation-topic-message-ref:read", request, context.userId),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) return privateRateLimit(limited);

    if (query.mode === "list") {
      const { data, error } = await createAdminClient().rpc(
        "list_amora_preparation_topic_message_refs_v1",
        {
          p_couple_id: context.coupleId,
          p_recipient_user_id: context.userId,
          p_expected_privacy_epoch: context.privacyEpoch,
          p_limit: AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT,
        },
      );
      if (error) return mapRpcError(error);
      const validated = validateAmoraPreparationTopicMessageRefCollectionResponse(
        data,
        context.userId,
        context.coupleId,
      );
      if (!validated.ok) {
        console.error("[preparation-topic-message-refs] invalid list response", {
          reason: validated.reason,
        });
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      return response(validated.value);
    }

    const { data, error } = await createAdminClient().rpc(
      "get_amora_preparation_topic_message_ref_state_v1",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_topic_key: query.topicKey,
        p_message_id: query.messageId,
        p_expected_privacy_epoch: context.privacyEpoch,
      },
    );
    if (error) return mapRpcError(error);
    const validated = validateAmoraPreparationTopicMessageRefStateResponse(
      data,
      context.userId,
      context.coupleId,
      query.topicKey,
      query.messageId,
    );
    if (!validated.ok) {
      console.error("[preparation-topic-message-refs] invalid state response", {
        reason: validated.reason,
      });
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[preparation-topic-message-refs] GET failed", error);
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_ORIGIN_REJECTED" }, 403);
    }
    if ([...new URL(request.url).searchParams.entries()].length > 0) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_QUERY_INVALID" }, 400);
    }
    const loaded = await loadContext(request);
    if (!loaded.ok) return loaded.response;
    const context = loaded.value;
    const limited = checkRateLimit(
      rateLimitKey("amora-preparation-topic-message-ref:write", request, context.userId),
      { maxRequests: 30, windowMs: 60_000 },
    );
    if (limited) return privateRateLimit(limited);

    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.text);
    } catch {
      parsed = null;
    }
    const input = parseAmoraPreparationTopicMessageRefMutationRequest(parsed);
    if (!input) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
    }

    const { data, error } = await createAdminClient().rpc(
      "set_amora_preparation_topic_message_ref_v1",
      {
        p_couple_id: context.coupleId,
        p_actor_user_id: context.userId,
        p_topic_key: input.topicKey,
        p_message_id: input.messageId.toLowerCase(),
        p_desired_state: input.desiredState,
        p_expected_revision: input.expectedRevision,
        p_request_id: input.requestId.toLowerCase(),
        p_expected_privacy_epoch: context.privacyEpoch,
      },
    );
    if (error) return mapRpcError(error);
    const validated = validateAmoraPreparationTopicMessageRefMutationResponse(
      data,
      context.userId,
      context.coupleId,
      input.topicKey,
      input.messageId.toLowerCase(),
      input.desiredState,
    );
    if (!validated.ok) {
      console.error("[preparation-topic-message-refs] invalid mutation response", {
        reason: validated.reason,
      });
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[preparation-topic-message-refs] PUT failed", error);
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
  }
}
