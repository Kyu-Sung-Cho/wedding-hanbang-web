/**
 * Public vendor-tag aggregate fields. Keep this allowlist explicit so a future
 * private or moderation column cannot be exposed by a service-role query.
 */
export const COMMUNITY_VENDOR_TAG_PUBLIC_SELECT =
  "id, vendor_name, category, region, mention_count, avg_rating, avg_base_price, avg_extra_price, extra_rate" as const;
