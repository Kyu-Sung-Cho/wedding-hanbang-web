export const EVENT_WEIGHTS = {
  page_view: 0,
  vendor_impression: 0,
  vendor_card_click: 1,
  vendor_detail_view: 2,
  addon_expand: 3,
  search: 1,
  filter_use: 1,
  wishlist_add: 5,
  combo_add: 8,
  combo_save: 10,
  combo_share: 6,
  budget_search: 4,
  alert_subscribe: 8,
  quote_request: 30,
} as const;

export type VendorEventType = keyof typeof EVENT_WEIGHTS;

// Browser telemetry is attacker-controlled even when the request carries a
// valid user session. Only low-signal observations may cross /api/events;
// decisions such as wishlist, combo, alert, and quote actions must be emitted
// by the server endpoint that owns the corresponding state transition.
export const CLIENT_VENDOR_EVENT_TYPES = [
  "page_view",
  "vendor_impression",
  "vendor_card_click",
  "search",
  "filter_use",
] as const satisfies readonly VendorEventType[];

export type ClientVendorEventType = (typeof CLIENT_VENDOR_EVENT_TYPES)[number];

const CLIENT_VENDOR_EVENT_TYPE_SET = new Set<VendorEventType>(
  CLIENT_VENDOR_EVENT_TYPES,
);

export const VENDOR_EVENT_TYPES = Object.freeze(
  Object.keys(EVENT_WEIGHTS) as VendorEventType[],
);

export function isVendorEventType(value: unknown): value is VendorEventType {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(EVENT_WEIGHTS, value);
}

export function isClientVendorEventType(value: unknown): value is ClientVendorEventType {
  return isVendorEventType(value) && CLIENT_VENDOR_EVENT_TYPE_SET.has(value);
}
