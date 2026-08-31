"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Loader2, RotateCcw } from "lucide-react";

import Avatar from "@/components/community/Avatar";
import { weddingPath } from "@/lib/weddingPaths";

type BlockedProfile = {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  rank: string;
};

type BlockedUser = {
  blocked_user_id: string;
  reason_category: string | null;
  created_at: string;
  profile: BlockedProfile | null;
};

export default function BlockedUsersPage() {
  const router = useRouter();
  const [blocks, setBlocks] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const loadBlocks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/community/blocks", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        router.replace(
          `/login?redirect=${encodeURIComponent(
            weddingPath("/community/my/blocks"),
          )}`,
        );
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        blocks?: BlockedUser[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(body.blocks)) {
        setLoadError(
          body.error ?? "차단 목록을 불러오지 못했어요. 다시 시도해 주세요.",
        );
        return;
      }
      setBlocks(body.blocks);
    } catch {
      setLoadError(
        "차단 목록을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadBlocks();
  }, [loadBlocks]);

  async function unblock(blockedUserId: string) {
    if (unblockingId) return;
    setUnblockingId(blockedUserId);
    setMutationError(null);
    try {
      const response = await fetch("/api/community/blocks", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocked_user_id: blockedUserId,
          blocked: false,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setMutationError(
          body.error ?? "차단 해제를 저장하지 못했어요. 다시 시도해 주세요.",
        );
        return;
      }
      setBlocks((current) =>
        current.filter((block) => block.blocked_user_id !== blockedUserId),
      );
      setConfirmingId(null);
    } catch {
      setMutationError(
        "차단 해제를 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={weddingPath("/community/my/posts")}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] bg-white transition-colors hover:bg-[#FAF8F5]"
          aria-label="내 활동으로 돌아가기"
        >
          <ArrowLeft className="h-4 w-4 text-[var(--hb-text-strong)]" />
        </Link>
        <div>
          <h1 className="font-serif-kr text-[20px] text-[var(--hb-text-strong)]">
            차단 관리
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-[#878680]">
            이 목록은 본인에게만 보이며 연결된 파트너와도 공유하지 않아요.
          </p>
        </div>
      </div>

      <section className="mb-5 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-4">
        <p className="text-sm font-semibold text-[var(--hb-text-strong)]">
          차단은 신고와 별개예요
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--hb-text-muted)]">
          로그인한 커뮤니티에서는 서로의 활동과 새 연락을 막지만, 공개 글은
          로그아웃 주소에서 보일 수 있어요. 개인정보·괴롭힘 문제는 별도로 신고해
          운영 검토를 요청해 주세요.
        </p>
      </section>

      {mutationError ? (
        <p
          role="alert"
          className="mb-4 rounded-[6px] bg-[#fbf2f0] px-3 py-2 text-sm text-[#8F6662]"
        >
          {mutationError}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16" aria-label="차단 목록 불러오는 중">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--hb-text-muted)]" />
        </div>
      ) : loadError ? (
        <div className="rounded-[6px] border border-[#ead6d2] bg-white px-5 py-8 text-center">
          <p role="alert" className="text-sm text-[#8F6662]">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadBlocks()}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-[6px] border border-[#d8d1cc] px-4 text-sm font-semibold text-[var(--hb-text-strong)]"
          >
            <RotateCcw className="h-4 w-4" />
            다시 시도
          </button>
        </div>
      ) : blocks.length === 0 ? (
        <div className="rounded-[6px] border border-black/[0.05] bg-white px-5 py-14 text-center">
          <Ban className="mx-auto h-9 w-9 text-[var(--hb-text-muted)]/50" />
          <p className="mt-3 text-sm text-[#878680]">차단한 회원이 없어요.</p>
          <Link
            href={weddingPath()}
            className="mt-4 inline-flex min-h-10 items-center rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white"
          >
            커뮤니티로 돌아가기
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((block) => {
            const nickname = block.profile?.nickname ?? "표시할 수 없는 회원";
            const confirming = confirmingId === block.blocked_user_id;
            const unblocking = unblockingId === block.blocked_user_id;
            return (
              <article
                key={block.blocked_user_id}
                className="rounded-[6px] border border-black/[0.05] bg-white px-4 py-4"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    nickname={nickname}
                    avatarUrl={block.profile?.avatar_url ?? null}
                    size={40}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--hb-text-strong)]">
                      {nickname}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--hb-text-muted)]">
                      로그인한 커뮤니티에서 숨김
                    </p>
                  </div>
                  {!confirming ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMutationError(null);
                        setConfirmingId(block.blocked_user_id);
                      }}
                      className="min-h-10 rounded-[6px] border border-[#d8d1cc] px-3 text-xs font-semibold text-[var(--hb-text-body)]"
                    >
                      차단 해제
                    </button>
                  ) : null}
                </div>

                {confirming ? (
                  <div className="mt-4 rounded-[6px] bg-[var(--hb-surface-page)] px-3 py-3">
                    <p className="text-xs leading-relaxed text-[var(--hb-text-body)]">
                      앞으로 서로의 공개 활동이 다시 보이고 새 답글을 주고받을 수
                      있어요. 차단 중 숨겨진 과거 알림은 다시 뜨지 않아요.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={unblocking}
                        className="min-h-9 rounded-[6px] px-3 text-xs font-semibold text-[var(--hb-text-muted)] disabled:opacity-40"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => void unblock(block.blocked_user_id)}
                        disabled={unblocking}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] bg-[var(--hb-primary)] px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {unblocking ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {unblocking ? "저장 중..." : "해제하기"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
