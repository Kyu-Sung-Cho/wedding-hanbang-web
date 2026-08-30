"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, Check, Loader2, X } from "lucide-react";

import { weddingPath } from "@/lib/weddingPaths";
import { useCommunityStore } from "@/stores/communityStore";

type BlockUserButtonProps = {
  userId: string;
  nickname: string;
  onBlocked?: (userId: string) => void;
  className?: string;
};

export default function BlockUserButton({
  userId,
  nickname,
  onBlocked,
  className = "",
}: BlockUserButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    setCompleted(false);
    setOpen(true);
  }

  async function blockUser() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/community/blocks", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocked_user_id: userId,
          blocked: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setError(
          body.error ??
            "차단 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }

      // Block receipts change every personalized community view. Purge before
      // rendering success so blocked content cannot flash from any cache.
      useCommunityStore.getState().purgePrivacyState();
      setCompleted(true);
      onBlocked?.(userId);
    } catch {
      setError(
        "차단 설정을 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 transition-colors hover:bg-[#FAFAF8] hover:text-[#8F6662] ${className}`}
        aria-label={`${nickname}님 차단`}
      >
        <Ban className="h-3.5 w-3.5" aria-hidden />
        차단
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`block-user-title-${userId}`}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[6px] bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#F0EFED] p-5">
              <div>
                <h2
                  id={`block-user-title-${userId}`}
                  className="text-base font-semibold text-[var(--hb-text-strong)]"
                >
                  {completed ? "차단했어요" : `${nickname}님을 차단할까요?`}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#878680]">
                  차단은 나만의 보기·연락 설정이며 신고와는 다릅니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="rounded-[6px] p-1.5 text-[#878680] hover:bg-[#FAFAF8] disabled:opacity-40"
                aria-label="차단 안내 닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {completed ? (
              <div className="p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef4f1] text-[var(--hb-text-strong)]">
                  <Check className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--hb-text-body)]">
                  로그인한 커뮤니티에서 서로의 새 글·답변·알림을 숨기고 새
                  답글과 직접 답변 요청을 막았어요.
                </p>
                <div className="mt-5 flex gap-2">
                  <Link
                    href={weddingPath("/community/my/blocks")}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[6px] border border-[#d8d1cc] px-4 text-sm font-semibold text-[var(--hb-text-body)]"
                  >
                    차단 관리
                  </Link>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="min-h-11 flex-1 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white"
                  >
                    확인
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <ul className="space-y-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
                  <li>• 로그인한 피드·검색·동기방에서 서로의 활동을 숨겨요.</li>
                  <li>• 새 답글·알림·직접 경험 답변 요청을 서로 만들 수 없어요.</li>
                  <li>• 상대에게 차단 알림이나 차단한 사람의 이름은 보내지 않아요.</li>
                </ul>
                <p className="mt-4 rounded-[6px] bg-[var(--hb-surface-page)] px-3 py-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">
                  공개 글은 로그아웃한 공개 주소에서 계속 보일 수 있어요. 공개
                  자체를 검토해야 하는 괴롭힘·개인정보 문제라면 차단과 별도로
                  신고해 주세요.
                </p>
                {error ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-[6px] bg-[#fbf2f0] px-3 py-2 text-sm leading-relaxed text-[#8F6662]"
                  >
                    {error}
                  </p>
                ) : null}
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="min-h-11 flex-1 rounded-[6px] border border-[#d8d1cc] px-4 text-sm font-semibold text-[var(--hb-text-body)] disabled:opacity-40"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={blockUser}
                    disabled={submitting}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[6px] bg-[#8F6662] px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Ban className="h-4 w-4" />
                    )}
                    {submitting ? "저장 중..." : "차단하기"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
