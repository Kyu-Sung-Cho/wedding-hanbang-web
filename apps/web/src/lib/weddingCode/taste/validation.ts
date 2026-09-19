import { WEDDING_STYLE_OPTIONS, type WeddingStyleValue } from "@hanbang/shared";
import { isWeddingTasteVersion, TASTE_AVOID_OPTIONS, TASTE_DOMAIN_OPTIONS, TASTE_DOMAIN_QUESTIONS, TASTE_NEGOTIABILITY_OPTIONS, WEDDING_TASTE_VERSION, type WeddingTasteVersion } from "./constants";
import type { TasteAvoid, TasteDomain, TasteNegotiability, TasteSelection, WeddingTasteDraft } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key));
}
function isDomain(value: unknown): value is TasteDomain { return TASTE_DOMAIN_OPTIONS.some(option => option.value === value); }
function isMood(value: unknown): value is WeddingStyleValue { return WEDDING_STYLE_OPTIONS.some(option => option.value === value); }
function isAvoid(value: unknown): value is TasteAvoid { return TASTE_AVOID_OPTIONS.some(option => option.value === value); }
function isNegotiability(value: unknown): value is TasteNegotiability { return TASTE_NEGOTIABILITY_OPTIONS.some(option => option.value === value); }
function selection<T extends string>(value: unknown, isValue: (value: unknown) => value is T, max: number): TasteSelection<T> | null {
  if (!record(value)) return null;
  if (value.status === "answered") {
    if (!exactKeys(value, ["status", "values"]) || !Array.isArray(value.values)
      || value.values.length < 1 || value.values.length > max || new Set(value.values).size !== value.values.length) return null;
    const values: unknown[] = [...value.values];
    if (!values.every(isValue)) return null;
    return { status: "answered", values };
  }
  if (!exactKeys(value, ["status"])) return null;
  if (value.status === "undecided" || value.status === "no_preference" || value.status === "not_applicable" || value.status === "skipped") {
    return { status: value.status };
  }
  return null;
}
export function createEmptyWeddingTasteDraft(version: WeddingTasteVersion = WEDDING_TASTE_VERSION): WeddingTasteDraft {
  return { version, priorityDomains: { status: "skipped" }, mood: { status: "skipped" }, details: {}, avoids: { status: "skipped" }, negotiability: {} };
}
export function parseWeddingTasteDraft(value: unknown): WeddingTasteDraft | null {
  if (!record(value) || !exactKeys(value, ["version", "priorityDomains", "mood", "details", "avoids", "negotiability"])
    || !isWeddingTasteVersion(value.version) || !record(value.details) || !record(value.negotiability)) return null;
  const priorityDomains = selection(value.priorityDomains, isDomain, 2);
  const mood = selection(value.mood, isMood, 2);
  const avoids = selection(value.avoids, isAvoid, 3);
  if (!priorityDomains || !mood || !avoids) return null;
  const selected = priorityDomains.status === "answered" ? priorityDomains.values : [];
  const details: WeddingTasteDraft["details"] = {};
  for (const [domain, raw] of Object.entries(value.details)) {
    if (!isDomain(domain) || !selected.includes(domain)) return null;
    const config = TASTE_DOMAIN_QUESTIONS[domain];
    const parsed = selection(raw, (item): item is string => typeof item === "string" && config.options.some(option => option.value === item), config.max);
    if (!parsed) return null;
    details[domain] = parsed;
  }
  const negotiability: WeddingTasteDraft["negotiability"] = {};
  for (const [domain, raw] of Object.entries(value.negotiability)) {
    if (!isDomain(domain) || !selected.includes(domain) || details[domain]?.status !== "answered" || !isNegotiability(raw)) return null;
    negotiability[domain] = raw;
  }
  return { version: value.version, priorityDomains, mood, details, avoids, negotiability };
}
export function selectedTasteDomains(draft: WeddingTasteDraft): TasteDomain[] {
  return draft.priorityDomains.status === "answered" ? draft.priorityDomains.values : [];
}
export function hasWeddingTasteAnswers(draft: WeddingTasteDraft): boolean {
  return draft.priorityDomains.status !== "skipped" || draft.mood.status !== "skipped" || draft.avoids.status !== "skipped"
    || Object.values(draft.details).some(value => value.status !== "skipped");
}
