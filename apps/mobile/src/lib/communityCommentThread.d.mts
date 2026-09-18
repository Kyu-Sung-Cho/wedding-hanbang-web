import type { CommunityContentOrigin } from "./communityTrust.mjs";

export interface CommunityCommentAuthor {
  nickname: string;
  rank: string;
  role: "bride" | "groom" | "neutral" | null;
}

export interface CommunityThreadComment {
  id: string;
  author_id: string;
  /** 지운 글이면 빈 문자열이다. 원문을 들고 다니지 않는다. */
  content: string;
  created_at: string;
  content_origin: CommunityContentOrigin;
  is_deleted: boolean;
  author: CommunityCommentAuthor | null;
  /** 최상위 답변의 답글(1단계). 답글의 replies 는 항상 비어 있다. */
  replies: CommunityThreadComment[];
}

export function parseCommunityCommentThread(value: unknown): CommunityThreadComment[];
export function communityDeletedCommentLabel(isReply: boolean): string;
export function countVisibleCommunityComments(
  comments: readonly CommunityThreadComment[],
): number;
export function hideCommunityCommentsByAuthor(
  comments: readonly CommunityThreadComment[],
  authorId: string,
): { comments: CommunityThreadComment[]; removedCount: number };
