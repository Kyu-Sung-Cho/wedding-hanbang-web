import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { PollWithOptions } from "@/types/community.types";

const pollOptionProjectionSchema = z.object({
  id: z.string().min(1),
  poll_id: z.string().min(1),
  position: z.number().int(),
  label: z.string(),
  image_url: z.string().nullable(),
  vote_count: z.number().int().nonnegative().nullable(),
});

const pollActorProjectionSchema = z.object({
  ok: z.literal(true),
  id: z.string().min(1),
  post_id: z.string().min(1),
  version: z.coerce.number().int().min(1),
  question: z.string(),
  allow_multiple: z.boolean(),
  is_anonymous: z.boolean(),
  hide_results_until_voted: z.boolean(),
  closes_at: z.string().nullable(),
  total_voters: z.number().int().nonnegative().nullable(),
  total_votes: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
  results_hidden: z.boolean(),
  user_voted_option_ids: z.array(z.string()),
  options: z.array(pollOptionProjectionSchema),
});

const pollProjectionNotFoundSchema = z.object({
  ok: z.literal(false),
  error: z.literal("not_found"),
});

type ServiceClient = ReturnType<typeof createAdminClient>;

function unavailable(detail?: unknown): Error {
  if (detail) {
    console.error("[community.pollProjection] projection read failed:", detail);
  }
  return new Error("COMMUNITY_POLL_PROJECTION_UNAVAILABLE");
}

/**
 * 투표 수치와 현재 사용자의 선택은 service-only actor projection에서만 읽는다.
 * 호출자는 이 함수 전에 게시글 가시성과 차단 경계를 확인해야 한다.
 */
export async function getCommunityPollActorProjection(
  serviceClient: ServiceClient,
  actorId: string | null,
  pollId: string,
): Promise<PollWithOptions | null> {
  const { data, error } = await serviceClient.rpc(
    "community_get_poll_actor_projection" as never,
    {
      p_actor_id: actorId,
      p_poll_id: pollId,
    } as never,
  ) as { data: unknown; error: unknown };

  if (error) throw unavailable(error);
  if (pollProjectionNotFoundSchema.safeParse(data).success) return null;

  const parsed = pollActorProjectionSchema.safeParse(data);
  if (!parsed.success) throw unavailable(parsed.error);

  const poll = { ...parsed.data };
  Reflect.deleteProperty(poll, "ok");
  return poll;
}
