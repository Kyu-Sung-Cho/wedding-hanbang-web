import { NextRequest } from "next/server";

import {
  preflightResponderCommand,
  prepareResponderMutation,
  readResponderJsonObject,
  responderJson,
  responderRpcErrorResponse,
} from "@/lib/community/responderSupplyApi";
import {
  isRecord,
  isUuid,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;

const RESPONDER_ORIGINS = ["member", "industry_professional"] as const;
const EXPERIENCE_SCOPES = [
  "contract_terms",
  "extra_charge",
  "vendor_response",
  "cancellation_refund",
] as const;
const EXPERIENCE_PERIODS = [
  "within_3_months",
  "within_6_months",
  "within_12_months",
  "over_12_months",
] as const;
const COMMERCIAL_RELATIONSHIPS = [
  "none",
  "gift",
  "discount",
  "refund",
  "affiliate",
  "paid",
  "employee",
  "owner_or_family",
  "platform_research_compensation",
] as const;
const OPT_IN_STATUSES = ["active", "revoked"] as const;
const ELIGIBILITY_STATUSES = [
  "pending_review",
  "verified_human_experience",
  "rejected",
] as const;

const BODY_KEYS = new Set([
  "responder_origin",
  "topic",
  "experience_scope",
  "experience_period",
  "commercial_relationship",
  "has_conflict",
  "available_from",
  "available_until",
  "weekly_request_limit",
  "cooldown_hours",
  "max_open_requests",
]);

type CapacityInput = {
  responderOrigin: (typeof RESPONDER_ORIGINS)[number];
  topic: "contract_extra_cost";
  experienceScope: (typeof EXPERIENCE_SCOPES)[number];
  experiencePeriod: (typeof EXPERIENCE_PERIODS)[number];
  commercialRelationship: (typeof COMMERCIAL_RELATIONSHIPS)[number];
  hasConflict: boolean;
  availableFrom: string;
  availableUntil: string;
  weeklyRequestLimit: number;
  cooldownHours: number;
  maxOpenRequests: number;
};

type CapacityRpcResult = {
  slot_id: string;
  responder_id: string;
  topic: string;
  experience_scope: string;
  experience_period: string;
  opt_in_status: string;
  eligibility_status: string;
  available_from: string;
  available_until: string;
};

function isAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function parseTimestamp(value: unknown): { raw: string; milliseconds: number } | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  if (
    year < 2000
    || year > 2100
    || month < 1
    || month > 12
    || day < 1
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) return null;
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute
    || calendar.getUTCSeconds() !== second
  ) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? { raw: value, milliseconds } : null;
}

function parseCapacityInput(value: unknown): CapacityInput | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !BODY_KEYS.has(key))) {
    return null;
  }

  const availableFrom = parseTimestamp(value.available_from);
  const availableUntil = parseTimestamp(value.available_until);
  if (
    !isAllowed(value.responder_origin, RESPONDER_ORIGINS)
    || value.topic !== "contract_extra_cost"
    || !isAllowed(value.experience_scope, EXPERIENCE_SCOPES)
    || !isAllowed(value.experience_period, EXPERIENCE_PERIODS)
    || !isAllowed(value.commercial_relationship, COMMERCIAL_RELATIONSHIPS)
    || typeof value.has_conflict !== "boolean"
    || !availableFrom
    || !availableUntil
    || availableFrom.milliseconds >= availableUntil.milliseconds
    || availableUntil.milliseconds <= Date.now()
    || availableUntil.milliseconds - availableFrom.milliseconds > 366 * 24 * 60 * 60 * 1000
    || !isIntegerInRange(value.weekly_request_limit, 1, 7)
    || !isIntegerInRange(value.cooldown_hours, 1, 168)
    || !isIntegerInRange(value.max_open_requests, 1, 3)
  ) {
    return null;
  }

  return {
    responderOrigin: value.responder_origin,
    topic: value.topic,
    experienceScope: value.experience_scope,
    experiencePeriod: value.experience_period,
    commercialRelationship: value.commercial_relationship,
    hasConflict: value.has_conflict,
    availableFrom: availableFrom.raw,
    availableUntil: availableUntil.raw,
    weeklyRequestLimit: value.weekly_request_limit,
    cooldownHours: value.cooldown_hours,
    maxOpenRequests: value.max_open_requests,
  };
}

function isCapacityRpcResult(value: unknown, responderId: string): value is CapacityRpcResult {
  return isRecord(value)
    && isUuid(value.slot_id)
    && value.responder_id === responderId
    && value.topic === "contract_extra_cost"
    && isAllowed(value.experience_scope, EXPERIENCE_SCOPES)
    && isAllowed(value.experience_period, EXPERIENCE_PERIODS)
    && isAllowed(value.opt_in_status, OPT_IN_STATUSES)
    && isAllowed(value.eligibility_status, ELIGIBILITY_STATUSES)
    && parseTimestamp(value.available_from) !== null
    && parseTimestamp(value.available_until) !== null
    && !Object.hasOwn(value, "replayed")
    && value.opt_in_status === "active"
    && value.eligibility_status === "pending_review";
}

export async function POST(request: NextRequest) {
  try {
    const prepared = await prepareResponderMutation(request, {
      maxBodyBytes: MAX_BODY_BYTES,
      ratePrefix: "community:responder:capacity:register",
      rateLimit: { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      requireWriteAccess: true,
    });
    if (!prepared.ok) return prepared.response;

    const parsed = await readResponderJsonObject(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const input = parseCapacityInput(parsed.body);
    if (!input) {
      return responderJson(
        { code: "COMMUNITY_RESPONDER_BODY_INVALID", error: "응답 가능 범위를 확인해 주세요." },
        400,
      );
    }

    const commandPayload = {
      responder_origin: input.responderOrigin,
      topic: input.topic,
      experience_scope: input.experienceScope,
      experience_period: input.experiencePeriod,
      commercial_relationship: input.commercialRelationship,
      has_conflict: input.hasConflict,
      available_from: input.availableFrom,
      available_until: input.availableUntil,
      weekly_request_limit: input.weeklyRequestLimit,
      cooldown_hours: input.cooldownHours,
      max_open_requests: input.maxOpenRequests,
    };
    const replay = await preflightResponderCommand(
      prepared.userId,
      "register_capacity",
      prepared.idempotencyKey,
      commandPayload,
    );
    if (!replay.ok) return replay.response;
    if (replay.kind === "receipt") {
      if (!isCapacityRpcResult(replay.receipt, prepared.userId)) {
        return responderJson(
          { code: "COMMUNITY_RESPONDER_RECEIPT_UNAVAILABLE", error: "저장된 응답 가능 범위를 안전하게 확인하지 못했어요." },
          503,
          { "Retry-After": "30" },
        );
      }
      return responderJson(
        {
          slot: {
            id: replay.receipt.slot_id,
            topic: replay.receipt.topic,
            experience_scope: replay.receipt.experience_scope,
            experience_period: replay.receipt.experience_period,
            status: replay.receipt.opt_in_status,
            review_status: replay.receipt.eligibility_status,
            available_from: replay.receipt.available_from,
            available_until: replay.receipt.available_until,
          },
        },
        201,
      );
    }

    const gateResponse = await prepared.enforceMutableGates();
    if (gateResponse) return gateResponse;

    const serviceClient = replay.serviceClient;
    const { data, error } = await serviceClient.rpc(
      "community_register_responder_capacity_slot",
      {
        p_responder_id: prepared.userId,
        p_responder_origin: input.responderOrigin,
        p_topic: input.topic,
        p_experience_scope: input.experienceScope,
        p_experience_period: input.experiencePeriod,
        p_commercial_relationship: input.commercialRelationship,
        p_has_conflict: input.hasConflict,
        p_available_from: input.availableFrom,
        p_available_until: input.availableUntil,
        p_weekly_request_limit: input.weeklyRequestLimit,
        p_cooldown_hours: input.cooldownHours,
        p_max_open_requests: input.maxOpenRequests,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );

    if (error) return responderRpcErrorResponse(error);
    if (!isCapacityRpcResult(data, prepared.userId)) {
      return responderJson(
        { code: "COMMUNITY_RESPONDER_CAPACITY_SAVE_FAILED", error: "응답 가능 범위를 안전하게 저장하지 못했어요." },
        503,
        { "Retry-After": "30" },
      );
    }

    return responderJson(
      {
        slot: {
          id: data.slot_id,
          topic: data.topic,
          experience_scope: data.experience_scope,
          experience_period: data.experience_period,
          status: data.opt_in_status,
          review_status: data.eligibility_status,
          available_from: data.available_from,
          available_until: data.available_until,
        },
      },
      201,
    );
  } catch {
    console.error("[community responder capacity] unavailable");
    return responderJson(
      { code: "COMMUNITY_RESPONDER_CAPACITY_UNAVAILABLE", error: "응답 가능 범위 기능을 잠시 사용할 수 없어요." },
      503,
      { "Retry-After": "30" },
    );
  }
}
