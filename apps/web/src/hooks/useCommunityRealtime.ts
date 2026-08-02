"use client";

/**
 * Raw Postgres Changes rows contain internal author_id values. Feed freshness
 * stays request/API driven until a column-safe broadcast payload replaces the
 * legacy publication.
 */
export function useCommunityRealtime(): void {
  return;
}
