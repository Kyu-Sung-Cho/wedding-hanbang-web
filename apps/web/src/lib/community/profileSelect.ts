// Owner profile payloads still use the public actor ID. Internal auth UUIDs
// remain server-only even when the signed-in user is reading their own card.
export const COMMUNITY_PROFILE_OWNER_SELECT =
  "user_id:public_actor_id, nickname, avatar_url, wedding_year, wedding_month, wedding_completed, progress_percent, region, post_count, comment_count, total_upvotes_received, warning_count, is_suspended, created_at" as const;
