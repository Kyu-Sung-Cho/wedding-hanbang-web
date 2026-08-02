/**
 * Explicit projections for authenticated/private API responses.
 *
 * Keeping these lists closed prevents a future database migration from
 * silently adding a sensitive column to an existing API response.
 */
export const COUPLE_PRIVATE_SELECT =
  "id, invite_code, bride_id, groom_id, membership_sealed_at, created_at, updated_at" as const;

export const WEDDING_JOURNEY_PRIVATE_SELECT =
  "id, couple_id, wedding_date, venue, total_budget, progress, created_at, updated_at" as const;

export const VENDOR_BOOKING_PRIVATE_SELECT =
  "id, vendor_id, couple_id, product_id, booking_date, booking_time, booking_type, bride_name, groom_name, contact_phone, status, contract_status, payment_status, amount, is_paid, memo, created_at, updated_at" as const;

export const VENDOR_MESSAGE_PRIVATE_SELECT =
  "id, vendor_id, customer_id, server_provenance_version, sender_type, content, is_read, booking_id, created_at" as const;

export const CONGRATULATORY_MONEY_PRIVATE_SELECT =
  "id, couple_id, guest_name, amount, side, relation, method, memo, received_at, created_at, updated_at" as const;

export const CHAT_MESSAGE_CLIENT_SELECT =
  "id, couple_id, sender_id, sender_type, role, content, metadata, visibility, created_at" as const;
