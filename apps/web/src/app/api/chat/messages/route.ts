import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import {
  checkRateLimit,
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import {
  AMORA_ATTACHMENT_MEDIA_TYPES,
  AMORA_MAX_ATTACHMENT_BYTES,
  AMORA_MAX_ATTACHMENTS,
  AMORA_MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/ai/amoraAttachments";
import { verifyChatImageObjectBindings } from "@/lib/chat/attachmentStorage";

const MAX_BODY_BYTES = 8 * 1024;
// 20,000 Unicode code points can occupy up to 80KiB in UTF-8. Keep bounded
// metadata headroom without ever accepting raw attachment bytes here.
const MAX_POST_BODY_BYTES = 128 * 1024;
const MAX_MESSAGE_CHARACTERS = 20_000;
const MAX_IMAGE_PATHS = AMORA_MAX_ATTACHMENTS;
const PROVIDER_ATTACHMENT_MEDIA_TYPES = new Set<string>(
  AMORA_ATTACHMENT_MEDIA_TYPES,
);
const PROVIDER_ATTACHMENT_MANIFEST_KEYS = new Set([
  "mediaType",
  "byteLength",
  "sha256",
]);
const POST_BODY_KEYS = new Set([
  "coupleId",
  "content",
  "clientRequestId",
  "requestedVisibility",
  "target",
  "confirmedActionId",
  "imagePaths",
  "providerAttachmentCount",
  "providerAttachmentManifest",
]);
const CHAT_USER_ROW_SELECT = [
  "id",
  "couple_id",
  "sender_id",
  "sender_type",
  "sender_role",
  "role",
  "content",
  "metadata",
  "stage_tag",
  "specialist_type",
  "visibility",
  "segment_id",
  "created_at",
].join(", ");
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

type ChatVisibility = "shared" | "bride_private" | "groom_private";
type CoupleRole = "bride" | "groom";
type DeliveryTarget = "ai" | "partner";
type ProviderAttachmentState =
  | "none"
  | "present"
  | "discarded_by_safety_policy";

type ProviderAttachmentManifestEntry = {
  media_type: string;
  byte_length: number;
  sha256: string;
};

type ExpectedUserRow = {
  coupleId: string;
  userId: string;
  senderRole: CoupleRole;
  content: string;
  clientRequestId: string;
  target: DeliveryTarget;
  partnerRecipientId: string | null;
  visibility: ChatVisibility;
  confirmedActionId: string | null;
  imagePaths: string[];
  providerAttachmentCount: number | null;
  providerAttachmentState: ProviderAttachmentState | null;
  providerAttachmentManifest: ProviderAttachmentManifestEntry[] | null;
  aiResponseRequested: boolean | null;
};

function postJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function safeErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code.slice(0, 64);
  }
  return error instanceof Error ? error.name.slice(0, 64) : "UNKNOWN";
}

function isMissingStorageObject(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  const detail = `${String(error.error ?? "")} ${String(error.message ?? "")}`
    .toLowerCase();
  return status === "404" || detail.includes("not found");
}

function isValidMessageContent(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const characterLength = Array.from(value).length;
  return characterLength >= 1 && characterLength <= MAX_MESSAGE_CHARACTERS;
}

function parseVisibility(value: unknown): ChatVisibility | null {
  return value === "shared"
    || value === "bride_private"
    || value === "groom_private"
    ? value
    : null;
}

function parseImagePaths(
  value: unknown,
  coupleId: string,
  userId: string,
): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGE_PATHS) return null;

  const prefix = `${coupleId}/${userId}/`;
  const filePattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/;
  const paths: string[] = [];
  for (const path of value) {
    if (
      typeof path !== "string"
      || path.length < prefix.length + 40
      || path.length > 512
      || !path.startsWith(prefix)
      || path.includes("..")
      || path.includes("\\")
      || path.includes("?")
      || path.includes("#")
      || !filePattern.test(path.slice(prefix.length))
    ) {
      return null;
    }
    paths.push(path);
  }
  return paths;
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function parseProviderAttachmentManifest(
  value: unknown,
): ProviderAttachmentManifestEntry[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMAGE_PATHS) {
    return null;
  }

  const manifest: ProviderAttachmentManifestEntry[] = [];
  let totalBytes = 0;
  for (const entry of value) {
    if (
      !isRecord(entry)
      || Object.keys(entry).length !== PROVIDER_ATTACHMENT_MANIFEST_KEYS.size
      || Object.keys(entry).some((key) => !PROVIDER_ATTACHMENT_MANIFEST_KEYS.has(key))
      || typeof entry.mediaType !== "string"
      || !PROVIDER_ATTACHMENT_MEDIA_TYPES.has(entry.mediaType)
      || !Number.isSafeInteger(entry.byteLength)
      || (entry.byteLength as number) < 1
      || (entry.byteLength as number) > AMORA_MAX_ATTACHMENT_BYTES
      || typeof entry.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      return null;
    }
    totalBytes += entry.byteLength as number;
    if (totalBytes > AMORA_MAX_TOTAL_ATTACHMENT_BYTES) return null;
    manifest.push({
      media_type: entry.mediaType,
      byte_length: entry.byteLength as number,
      sha256: entry.sha256,
    });
  }
  return manifest;
}

function sameProviderAttachmentManifest(
  value: unknown,
  expected: ProviderAttachmentManifestEntry[],
): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => {
      const expectedEntry = expected[index];
      return isRecord(entry)
        && Object.keys(entry).length === 3
        && entry.media_type === expectedEntry?.media_type
        && entry.byte_length === expectedEntry?.byte_length
        && entry.sha256 === expectedEntry?.sha256;
    });
}

function isBoundCanonicalUserRow(
  row: unknown,
  expected: ExpectedUserRow,
): row is Record<string, unknown> {
  if (!isRecord(row)) return false;
  if (
    typeof row.id !== "string"
    || row.couple_id !== expected.coupleId
    || row.sender_id !== expected.userId
    || row.sender_type !== expected.senderRole
    || row.role !== "user"
    || row.content !== expected.content
    || row.visibility !== expected.visibility
  ) {
    return false;
  }

  if (!isRecord(row.metadata)) return false;
  const metadata = row.metadata;
  if (
    metadata.client_request_id !== expected.clientRequestId
  ) {
    return false;
  }
  if (expected.target === "partner") {
    if (
      metadata.target !== "partner"
      || metadata.partner_recipient_id !== expected.partnerRecipientId
    ) {
      return false;
    }
  } else if (
    metadata.target !== undefined
    || metadata.partner_recipient_id !== undefined
  ) {
    return false;
  }
  const storedAction = typeof metadata.confirmed_amora_action_id === "string"
    ? metadata.confirmed_amora_action_id
    : null;
  if (storedAction !== expected.confirmedActionId) return false;
  if (
    expected.providerAttachmentCount === null
      ? metadata.provider_attachment_count !== undefined
        || metadata.provider_attachment_state !== undefined
        || metadata.ai_response_requested !== undefined
        || metadata.amora_ingest_contract_version !== undefined
      : metadata.provider_attachment_count !== expected.providerAttachmentCount
        || metadata.provider_attachment_state !== expected.providerAttachmentState
        || metadata.ai_response_requested !== expected.aiResponseRequested
        || metadata.amora_ingest_contract_version
          !== (expected.providerAttachmentManifest === null ? 1 : 2)
  ) {
    return false;
  }
  if (
    expected.providerAttachmentManifest === null
      ? metadata.provider_attachment_manifest !== undefined
      : !sameProviderAttachmentManifest(
          metadata.provider_attachment_manifest,
          expected.providerAttachmentManifest,
        )
  ) {
    return false;
  }

  const storedPaths = metadata.imagePaths === undefined ? [] : metadata.imagePaths;
  return sameStringArray(storedPaths, expected.imagePaths);
}

function isBoundSafetyRetryRow(
  row: unknown,
  expected: Pick<
    ExpectedUserRow,
    | "coupleId"
    | "userId"
    | "senderRole"
    | "content"
    | "clientRequestId"
    | "target"
    | "partnerRecipientId"
  >,
): row is Record<string, unknown> {
  if (
    !isRecord(row)
    || typeof row.id !== "string"
    || row.couple_id !== expected.coupleId
    || row.sender_id !== expected.userId
    || row.sender_type !== expected.senderRole
    || row.role !== "user"
    || row.content !== expected.content
    || !isRecord(row.metadata)
    || row.metadata.client_request_id !== expected.clientRequestId
  ) {
    return false;
  }
  if (expected.target === "partner") {
    return row.metadata.target === "partner"
      && row.metadata.partner_recipient_id === expected.partnerRecipientId;
  }
  return row.metadata.target === undefined
    && row.metadata.partner_recipient_id === undefined;
}

// 사용자가 해당 커플에 속하는지 + role 반환
async function verifyCoupleOwnership(
  userId: string,
  coupleId: string,
  admin = createAdminClient(),
): Promise<{
  ok: boolean;
  role: string | null;
  partnerRecipientId: string | null;
}> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (
    profileError
    || profile?.couple_id !== coupleId
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return { ok: false, role: null, partnerRecipientId: null };
  }

  // Service-role writes bypass RLS, so a profile pointer alone is not an
  // authorization boundary. Require the current sealed roster slot as well;
  // this fails closed when a former member's profile is temporarily stale.
  const { data: couple, error: coupleError } = await admin
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  if (
    coupleError
    || (profile.role === "bride" && couple?.bride_id !== userId)
    || (profile.role === "groom" && couple?.groom_id !== userId)
  ) {
    return { ok: false, role: null, partnerRecipientId: null };
  }
  return {
    ok: true,
    role: profile.role,
    partnerRecipientId: profile.role === "bride"
      ? couple.groom_id ?? null
      : couple.bride_id ?? null,
  };
}

export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_POST_BODY_BYTES)) {
      return postJson(
        { error: "요청 데이터가 너무 큽니다.", code: "REQUEST_TOO_LARGE" },
        413,
      );
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return postJson({ error: "인증이 필요합니다.", code: "AUTH_REQUIRED" }, 401);
    }
    if (!isTrustedMutationRequest(request)) {
      return postJson(
        {
          error: "요청 출처를 확인할 수 없습니다.",
          code: "UNTRUSTED_MUTATION_REQUEST",
        },
        403,
      );
    }

    const rawBody = await readBoundedUtf8Text(request, MAX_POST_BODY_BYTES);
    if (!rawBody.ok) {
      return postJson(
        {
          error: rawBody.reason === "too_large"
            ? "요청 데이터가 너무 큽니다."
            : "요청을 읽을 수 없습니다.",
          code: rawBody.reason === "too_large"
            ? "REQUEST_TOO_LARGE"
            : "INVALID_REQUEST_BODY",
        },
        rawBody.reason === "too_large" ? 413 : 400,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.text) as unknown;
    } catch {
      return postJson(
        { error: "잘못된 요청입니다.", code: "INVALID_REQUEST_BODY" },
        400,
      );
    }
    if (
      !isRecord(body)
      || Object.keys(body).some((key) => !POST_BODY_KEYS.has(key))
    ) {
      return postJson(
        { error: "허용되지 않은 요청 필드가 있습니다.", code: "INVALID_REQUEST_BODY" },
        400,
      );
    }

    const coupleId = isUuid(body.coupleId)
      ? body.coupleId.toLowerCase()
      : null;
    const clientRequestId = isUuid(body.clientRequestId)
      ? body.clientRequestId.toLowerCase()
      : null;
    const requestedVisibility = parseVisibility(body.requestedVisibility);
    const target: DeliveryTarget = body.target === undefined || body.target === "ai"
      ? "ai"
      : body.target === "partner"
        ? "partner"
        : "ai";
    if (
      !coupleId
      || !clientRequestId
      || !requestedVisibility
      || (body.target !== undefined && body.target !== "ai" && body.target !== "partner")
      || !isValidMessageContent(body.content)
    ) {
      return postJson(
        { error: "메시지 요청 형식이 올바르지 않습니다.", code: "INVALID_MESSAGE_REQUEST" },
        400,
      );
    }
    const content = body.content;

    const admin = createAdminClient();
    const ownership = await verifyCoupleOwnership(user.id, coupleId, admin);
    if (!ownership.ok || (ownership.role !== "bride" && ownership.role !== "groom")) {
      return postJson(
        { error: "현재 커플 대화 권한이 없습니다.", code: "CHAT_SCOPE_DENIED" },
        403,
      );
    }
    const senderRole: CoupleRole = ownership.role;
    if (target === "partner" && !ownership.partnerRecipientId) {
      return postJson(
        { error: "연결된 상대방을 확인하지 못했어요.", code: "PARTNER_NOT_LINKED" },
        409,
      );
    }
    if (target === "partner" && requestedVisibility !== "shared") {
      return postJson(
        { error: "상대방에게 보내는 메시지는 함께 대화에서만 보낼 수 있어요.", code: "PARTNER_VISIBILITY_INVALID" },
        400,
      );
    }

    // This deterministic policy must run before rate limiting, attachment path
    // handling, durable writes, Realtime visibility, or any provider request.
    const deliveryPlan = planAmoraCrisisDelivery({
      userText: content,
      requestedVisibility,
      target,
      senderRole,
    });
    if (deliveryPlan.disposition === "local_safety_hold") {
      let rawDisclosurePersisted: boolean | null = null;
      let rawDisclosureVisibility: ChatVisibility | null = null;
      try {
        const existingResult = await admin
          .from("chat_messages")
          .select(CHAT_USER_ROW_SELECT)
          .eq("couple_id", coupleId)
          .eq("metadata->>client_request_id", clientRequestId)
          .maybeSingle();
        if (!existingResult.error) {
          if (!existingResult.data) {
            rawDisclosurePersisted = false;
          } else if (isBoundSafetyRetryRow(existingResult.data, {
            coupleId,
            userId: user.id.toLowerCase(),
            senderRole,
            content,
            clientRequestId,
            target,
            partnerRecipientId: target === "partner"
              ? ownership.partnerRecipientId
              : null,
          })) {
            rawDisclosurePersisted = true;
            rawDisclosureVisibility = parseVisibility(existingResult.data.visibility);
          }
        }
      } catch {
        // Time-critical guidance must still render. Null explicitly means that
        // the server could not truthfully confirm the earlier persistence state.
      }
      return postJson({
        outcome: "ephemeral_safety",
        effectiveVisibility: deliveryPlan.effectiveVisibility,
        safetyPrivacyRedirected: deliveryPlan.safetyPrivacyRedirected,
        partnerDeliveryHeld: deliveryPlan.partnerDeliveryHeld,
        safetyResolution: deliveryPlan.safetyResolution,
        classification: deliveryPlan.classification?.kind ?? null,
        response: deliveryPlan.response,
        rawDisclosurePersisted,
        ...(rawDisclosureVisibility
          ? { rawDisclosureVisibility }
          : {}),
      });
    }

    const ownPrivateVisibility: ChatVisibility = `${senderRole}_private`;
    const effectiveVisibility = deliveryPlan.effectiveVisibility;
    if (
      effectiveVisibility !== "shared"
      && effectiveVisibility !== ownPrivateVisibility
    ) {
      return postJson(
        { error: "비공개 대화 권한이 없습니다.", code: "CHAT_VISIBILITY_DENIED" },
        403,
      );
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey(`chat:messages:post:${target}`, request, user.id),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }

    // W2 privacy routing intentionally discards a shared-action confirmation:
    // safety context may be stored privately, but must not execute shared state.
    const confirmedActionId = deliveryPlan.disposition === "private_safety_route"
      ? null
      : target === "partner"
        ? body.confirmedActionId === undefined
          ? null
          : undefined
      : body.confirmedActionId === undefined
        ? null
        : isUuid(body.confirmedActionId)
          ? body.confirmedActionId.toLowerCase()
          : undefined;
    if (
      confirmedActionId === undefined
      || (confirmedActionId !== null && effectiveVisibility !== "shared")
    ) {
      return postJson(
        { error: "확인된 변경 요청 형식이 올바르지 않습니다.", code: "INVALID_CONFIRMED_ACTION" },
        400,
      );
    }

    // A stale client can upload before learning that the server classified the
    // text as W2. Never bind those attachment paths to the private safety row;
    // the client uses the authoritative redirect response to delete its upload.
    const imagePaths = deliveryPlan.disposition === "private_safety_route"
      ? []
      : parseImagePaths(body.imagePaths, coupleId, user.id.toLowerCase());
    if (!imagePaths) {
      return postJson(
        { error: "첨부 이미지 경로가 올바르지 않습니다.", code: "INVALID_IMAGE_PATHS" },
        400,
      );
    }
    let requestedProviderAttachmentCount: number | null = null;
    if (body.providerAttachmentCount !== undefined) {
      if (
        !Number.isSafeInteger(body.providerAttachmentCount)
        || (body.providerAttachmentCount as number) < 0
        || (body.providerAttachmentCount as number) > MAX_IMAGE_PATHS
      ) {
        return postJson(
          {
            error: "첨부파일 개수 정보가 올바르지 않습니다.",
            code: "INVALID_PROVIDER_ATTACHMENT_COUNT",
          },
          400,
        );
      }
      requestedProviderAttachmentCount = body.providerAttachmentCount as number;
    }
    let providerAttachmentManifest: ProviderAttachmentManifestEntry[] | null = null;
    if (
      deliveryPlan.disposition !== "private_safety_route"
      && body.providerAttachmentManifest !== undefined
    ) {
      providerAttachmentManifest = parseProviderAttachmentManifest(
        body.providerAttachmentManifest,
      );
      if (
        providerAttachmentManifest === null
        || target !== "ai"
        || requestedProviderAttachmentCount === null
        || requestedProviderAttachmentCount < 1
        || providerAttachmentManifest.length !== requestedProviderAttachmentCount
      ) {
        return postJson(
          {
            error: "첨부파일 결합 정보가 올바르지 않습니다.",
            code: "INVALID_PROVIDER_ATTACHMENT_MANIFEST",
          },
          400,
        );
      }
    }
    if (
      target === "ai"
      && deliveryPlan.disposition !== "private_safety_route"
      && providerAttachmentManifest === null
      && (
        (requestedProviderAttachmentCount ?? 0) > 0
        || (requestedProviderAttachmentCount === null && imagePaths.length > 0)
      )
    ) {
      return postJson(
        {
          error: "이 탭의 첨부 전송 방식이 오래되었습니다. 페이지를 새로고침한 뒤 새 메시지로 다시 첨부해 주세요.",
          code: "CLIENT_UPGRADE_REQUIRED",
          retryable: false,
          retryPolicy: "new_message",
        },
        409,
      );
    }
    if (
      target === "ai"
      && deliveryPlan.disposition !== "private_safety_route"
      && requestedProviderAttachmentCount !== null
      && imagePaths.length > requestedProviderAttachmentCount
    ) {
      return postJson(
        {
          error: "첨부파일 개수 정보가 저장 경로와 일치하지 않습니다.",
          code: "INVALID_PROVIDER_ATTACHMENT_COUNT",
        },
        400,
      );
    }
    if (providerAttachmentManifest !== null) {
      const imageStorage = admin.storage.from("chat-image");
      const storageBinding = await verifyChatImageObjectBindings({
        coupleId,
        senderId: user.id.toLowerCase(),
        clientRequestId,
        manifest: providerAttachmentManifest.map((entry) => ({
          mediaType: entry.media_type,
          byteLength: entry.byte_length,
          sha256: entry.sha256,
        })),
        imagePaths,
        readObject: async (path, expected) => {
          try {
            const { data: info, error: infoError } = await imageStorage.info(path);
            if (infoError || !info) {
              return {
                ok: false,
                reason: isMissingStorageObject(infoError) ? "missing" : "unavailable",
              } as const;
            }
            if (
              info.size !== expected.byteLength
              || info.contentType !== expected.mediaType
            ) {
              return { ok: false, reason: "mismatch" } as const;
            }
            const { data: stream, error: downloadError } = await imageStorage
              .download(path)
              .asStream();
            if (downloadError || !stream) {
              return {
                ok: false,
                reason: isMissingStorageObject(downloadError)
                  ? "missing"
                  : "unavailable",
              } as const;
            }
            return {
              ok: true,
              stream,
              byteLength: info.size,
              mediaType: info.contentType,
            } as const;
          } catch {
            return { ok: false, reason: "unavailable" } as const;
          }
        },
      });
      if (!storageBinding.ok && storageBinding.reason === "path_mismatch") {
        return postJson(
          {
            error: "첨부 이미지 경로가 정확한 파일 바이트와 일치하지 않습니다. 파일을 다시 첨부해 주세요.",
            code: "INVALID_PROVIDER_ATTACHMENT_IMAGE_PATH_BINDING",
          },
          400,
        );
      }
      if (!storageBinding.ok && storageBinding.reason === "object_unavailable") {
        return postJson(
          {
            error: "첨부 이미지를 안전하게 확인하지 못했습니다. 잠시 후 같은 요청으로 다시 시도해 주세요.",
            code: "PROVIDER_ATTACHMENT_STORAGE_UNAVAILABLE",
            retryable: true,
            retryPolicy: "same_request",
          },
          503,
        );
      }
      if (!storageBinding.ok) {
        return postJson(
          {
            error: "저장된 첨부 이미지가 보낼 파일과 일치하지 않습니다. 새 메시지로 다시 첨부해 주세요.",
            code: "PROVIDER_ATTACHMENT_STORAGE_BINDING_MISMATCH",
            retryable: false,
            retryPolicy: "new_message",
          },
          409,
        );
      }
    }
    const providerAttachmentCount = requestedProviderAttachmentCount === null
      ? null
      : target === "partner" || deliveryPlan.disposition === "private_safety_route"
        ? 0
        : requestedProviderAttachmentCount;
    const providerAttachmentState: ProviderAttachmentState | null =
      requestedProviderAttachmentCount === null
        ? null
        : target === "partner"
          ? "none"
          : deliveryPlan.disposition === "private_safety_route"
            ? requestedProviderAttachmentCount > 0
              ? "discarded_by_safety_policy"
              : "none"
            : (providerAttachmentCount ?? 0) > 0
              ? "present"
              : "none";
    const aiResponseRequested = requestedProviderAttachmentCount === null
      ? null
      : target === "ai";

    const metadata: Record<string, unknown> = {
      client_request_id: clientRequestId,
      ...(target === "partner"
        ? {
            target: "partner",
            partner_recipient_id: ownership.partnerRecipientId,
          }
        : {}),
      ...(imagePaths.length > 0 ? { imagePaths } : {}),
      ...(providerAttachmentCount === null
        ? {}
        : {
            amora_ingest_contract_version:
              providerAttachmentManifest === null ? 1 : 2,
            ai_response_requested: aiResponseRequested,
            provider_attachment_state: providerAttachmentState,
            provider_attachment_count: providerAttachmentCount,
            ...(providerAttachmentManifest === null
              ? {}
              : { provider_attachment_manifest: providerAttachmentManifest }),
          }),
      ...(confirmedActionId
        ? { confirmed_amora_action_id: confirmedActionId }
        : {}),
    };
    const expected: ExpectedUserRow = {
      coupleId,
      userId: user.id.toLowerCase(),
      senderRole,
      content,
      clientRequestId,
      target,
      partnerRecipientId: target === "partner"
        ? ownership.partnerRecipientId
        : null,
      visibility: effectiveVisibility,
      confirmedActionId,
      imagePaths,
      providerAttachmentCount,
      providerAttachmentState,
      providerAttachmentManifest,
      aiResponseRequested,
    };
    const insertPayload = {
      couple_id: coupleId,
      sender_id: expected.userId,
      sender_type: senderRole,
      role: "user",
      content,
      metadata,
      visibility: effectiveVisibility,
    };

    let inserted: unknown = null;
    let insertError: unknown = null;
    try {
      const result = await admin
        .from("chat_messages")
        .insert(insertPayload)
        .select(CHAT_USER_ROW_SELECT)
        .single();
      inserted = result.data;
      insertError = result.error;
    } catch (error) {
      insertError = error;
    }

    if (!insertError && isBoundCanonicalUserRow(inserted, expected)) {
      return postJson(
        {
          outcome: "persisted",
          reused: false,
          effectiveVisibility,
          safetyPrivacyRedirected: deliveryPlan.safetyPrivacyRedirected,
          ...(deliveryPlan.disposition === "private_safety_route"
            ? { safetyResolution: deliveryPlan.safetyResolution }
            : {}),
          message: inserted,
        },
        201,
      );
    }

    let reconciled: unknown = null;
    let reconcileError: unknown = null;
    try {
      const result = await admin
        .from("chat_messages")
        .select(CHAT_USER_ROW_SELECT)
        .eq("couple_id", coupleId)
        .eq("metadata->>client_request_id", clientRequestId)
        .maybeSingle();
      reconciled = result.data;
      reconcileError = result.error;
    } catch (error) {
      reconcileError = error;
    }

    if (!reconcileError && reconciled) {
      if (!isBoundCanonicalUserRow(reconciled, expected)) {
        return postJson(
          {
            error: "같은 요청 식별자가 다른 메시지에 이미 사용되었습니다.",
            code: "USER_MESSAGE_REQUEST_CONFLICT",
            retryable: false,
            retryPolicy: "new_message",
          },
          409,
        );
      }
      return postJson({
        outcome: "persisted",
        reused: true,
        effectiveVisibility,
        safetyPrivacyRedirected: deliveryPlan.safetyPrivacyRedirected,
        ...(deliveryPlan.disposition === "private_safety_route"
          ? { safetyResolution: deliveryPlan.safetyResolution }
          : {}),
        message: reconciled,
      });
    }

    console.error("[chat messages POST] persistence outcome unavailable", {
      insertCode: safeErrorCode(insertError),
      reconcileCode: safeErrorCode(reconcileError),
    });
    return postJson(
      {
        error: "메시지 저장 결과를 안전하게 확인하지 못했습니다.",
        code: "USER_MESSAGE_PERSISTENCE_UNKNOWN",
        retryable: true,
        retryPolicy: "same_request",
      },
      503,
    );
  } catch (error) {
    console.error("[chat messages POST] unexpected failure", {
      code: safeErrorCode(error),
    });
    return postJson(
      {
        error: "메시지를 안전하게 처리하지 못했습니다.",
        code: "USER_MESSAGE_INGEST_FAILED",
        retryable: true,
        retryPolicy: "same_request",
      },
      503,
    );
  }
}

type ClearMode =
  | "view_reset_shared"     // 본인 화면만 정리 (함께 대화 탭) — 안전
  | "delete_shared"         // 둘 다 새로 시작 (함께 대화) — 양쪽 영향
  | "view_reset_private"    // 본인 화면만 정리 (나만 상담)
  | "delete_private";       // 비공개 기록 삭제 (본인만)

// "새 채팅" — clearMode 따라 분기
export async function DELETE(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isDemo = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));

    if (!user && !isDemo) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    if (isDemo) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json(
        {
          error: "요청 출처를 확인할 수 없습니다.",
          code: "UNTRUSTED_MUTATION_REQUEST",
        },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const limited = checkRateLimit(rateLimitKey("chat:messages:delete", request, user!.id), {
      maxRequests: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const coupleId = isUuid(body.coupleId) ? body.coupleId : null;
    const rawMode = typeof body.mode === "string" ? (body.mode as ClearMode) : undefined;

    if (!coupleId) {
      return NextResponse.json({ error: "coupleId가 필요합니다." }, { status: 400 });
    }

    // Backward compat: mode 없으면 옛 방식 (본인 화면만 정리 — 가장 안전한 default)
    const mode: ClearMode = rawMode ?? "view_reset_shared";

    if (mode === "delete_private") {
      // This authenticated RPC derives auth.uid(), current role and visibility
      // while holding the membership and private-memory scope locks.
      const { data, error } = await supabase.rpc(
        "hard_delete_current_user_private_chat",
        { p_couple_id: coupleId },
      );
      if (error) {
        const denied = error.code === "42501";
        if (!denied) {
          console.error("private chat hard delete RPC failed", {
            code: error.code ?? null,
          });
        }
        return NextResponse.json(
          {
            error: denied
              ? "이 대화를 삭제할 권한이 없습니다."
              : "비공개 대화를 안전하게 삭제하지 못했어요. 다시 시도해 주세요.",
            code: denied
              ? "PRIVATE_CHAT_DELETE_SCOPE_DENIED"
              : "PRIVATE_CHAT_DELETE_FAILED",
          },
          {
            status: denied ? 403 : 503,
            headers: PRIVATE_NO_STORE_HEADERS,
          },
        );
      }
      if (
        !isRecord(data)
        || data.success !== true
        || typeof data.cleared_at !== "string"
        || typeof data.deleted_messages !== "number"
      ) {
        console.error("private chat hard delete RPC returned an invalid result");
        return NextResponse.json(
          {
            error: "비공개 대화 삭제 결과를 확인하지 못했어요.",
            code: "PRIVATE_CHAT_DELETE_INVALID_RESULT",
          },
          { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          success: true,
          mode,
          deleted: data.deleted_messages,
          clearedAt: data.cleared_at,
        },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const { ok } = await verifyCoupleOwnership(user!.id, coupleId);
    if (!ok) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const admin = createAdminClient();

    const now = new Date().toISOString();

    switch (mode) {
      case "view_reset_shared": {
        // 본인 프로필의 timestamp만 업데이트. DB의 메시지는 그대로.
        const { error } = await admin
          .from("profiles")
          .update({ shared_chat_cleared_at: now })
          .eq("id", user!.id);
        if (error) throw error;
        return NextResponse.json({ success: true, mode, clearedAt: now });
      }

      case "view_reset_private": {
        const { error } = await admin
          .from("profiles")
          .update({ private_chat_cleared_at: now })
          .eq("id", user!.id);
        if (error) throw error;
        return NextResponse.json({ success: true, mode, clearedAt: now });
      }

      case "delete_shared": {
        // 공유 기록의 실제 삭제는 양쪽 동의가 필요한 clear-request 흐름만 허용한다.
        return NextResponse.json(
          {
            error: "공유 대화 삭제 방식이 변경되었습니다. 함께 새로 시작하기를 이용해주세요.",
            code: "SHARED_HARD_DELETE_DISABLED",
          },
          { status: 410 },
        );
      }

      default:
        return NextResponse.json({ error: "잘못된 mode 값입니다." }, { status: 400 });
    }
  } catch (err) {
    console.error("메시지 삭제 에러:", err);
    return NextResponse.json(
      { error: "메시지 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
