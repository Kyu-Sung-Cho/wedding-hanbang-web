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

export const VENDOR_EVENT_TYPES = Object.freeze(
  Object.keys(EVENT_WEIGHTS) as VendorEventType[],
);

export function isVendorEventType(value: unknown): value is VendorEventType {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(EVENT_WEIGHTS, value);
}
