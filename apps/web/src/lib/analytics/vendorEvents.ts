import { z } from "zod";

import {
  EVENT_WEIGHTS,
  isClientVendorEventType,
  type ClientVendorEventType,
} from "./eventWeights";

export const VENDOR_EVENT_SURFACES = [
  "price_list",
  "price_detail",
  "combo",
  "amora",
  "amora_reco",
] as const;

export type VendorEventSurface = (typeof VENDOR_EVENT_SURFACES)[number];

export type VendorEventContext = Partial<{
  region: string;
  category: string;
  surface: string;
  wedding_month: string;
  budget_band: "under_200" | "200_300" | "300_400" | "over_400";
  referrer_host: string;
  zero_result: boolean;
}>;

const SHORT_TOKEN = /^[a-z0-9_:-]{1,64}$/i;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9.-]+$/i;
const WEDDING_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const BUDGET_BANDS = new Set([
  "under_200",
  "200_300",
  "300_400",
  "over_400",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeVendorEventContext(value: unknown): VendorEventContext {
  if (!isPlainObject(value)) return {};
  const context: VendorEventContext = {};
  if (typeof value.region === "string" && SHORT_TOKEN.test(value.region)) {
    context.region = value.region;
  }
  if (typeof value.category === "string" && SHORT_TOKEN.test(value.category)) {
    context.category = value.category;
  }
  if (typeof value.surface === "string" && SHORT_TOKEN.test(value.surface)) {
    context.surface = value.surface;
  }
  if (
    typeof value.wedding_month === "string"
    && WEDDING_MONTH.test(value.wedding_month)
  ) {
    context.wedding_month = value.wedding_month;
  }
  if (
    typeof value.budget_band === "string"
    && BUDGET_BANDS.has(value.budget_band)
  ) {
    context.budget_band = value.budget_band as VendorEventContext["budget_band"];
  }
  if (
    typeof value.referrer_host === "string"
    && HOSTNAME.test(value.referrer_host)
  ) {
    context.referrer_host = value.referrer_host.toLowerCase();
  }
  if (typeof value.zero_result === "boolean") {
    context.zero_result = value.zero_result;
  }
  return context;
}

const eventInputSchema = z.object({
  anon_id: z.uuid(),
  // Client-generated opaque UUID only. Free-form session identifiers can
  // otherwise become an analytics PII channel.
  session_id: z.uuid(),
  event_type: z.string().refine(isClientVendorEventType),
  vendor_id: z.uuid().nullable().optional().default(null),
  agency_id: z.uuid().nullable().optional().default(null),
  surface: z.enum(VENDOR_EVENT_SURFACES),
  context: z.unknown().optional().transform(sanitizeVendorEventContext),
});

const eventEnvelopeSchema = z.union([
  z.array(eventInputSchema).min(1).max(50),
  z.object({ events: z.array(eventInputSchema).min(1).max(50) })
    .transform(({ events }) => events),
]);

export type NormalizedVendorEvent = {
  anon_id: string;
  session_id: string;
  event_type: ClientVendorEventType;
  vendor_id: string | null;
  agency_id: string | null;
  surface: VendorEventSurface;
  context: VendorEventContext;
  weight: number;
};

export function normalizeVendorEventBatch(value: unknown): NormalizedVendorEvent[] {
  const result = eventEnvelopeSchema.safeParse(value);
  if (!result.success) throw new Error("EVENT_BATCH_INVALID");
  return result.data.map((event) => {
    const eventType = event.event_type as ClientVendorEventType;
    return {
      ...event,
      event_type: eventType,
      context: event.context ?? {},
      weight: EVENT_WEIGHTS[eventType],
    };
  });
}
