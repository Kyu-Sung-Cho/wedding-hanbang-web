export const COMMUNITY_COMMENT_PUBLIC_SELECT =
  "id, post_id, parent_id, author_id:author_public_id, content, upvote_count, is_deleted, created_at, updated_at" as const;

// The AI endpoint keeps a compatibility fallback for deployments that do not
// yet have the optional is_ai column. Only the primary insert may request it.
export const COMMUNITY_AI_COMMENT_SELECT =
  "id, post_id, parent_id, author_id:author_public_id, content, upvote_count, is_deleted, is_ai, created_at, updated_at" as const;
