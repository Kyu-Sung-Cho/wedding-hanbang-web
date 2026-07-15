"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, EyeOff, Loader2, Undo2 } from "lucide-react";
import { pathWithAuthReturn } from "@/lib/authReturnPath";
import { weddingPath } from "@/lib/weddingPaths";

interface MutedUser {
  id: string;
  nickname: string;
  mutedAt: string;
}

const MUTED_AUTHORS_PATH = "/community/my/muted";
const mutedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

function apiErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function parseMutedUsers(payload: unknown): MutedUser[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const users = (payload as { users?: unknown }).users;
  if (!Array.isArray(users)) return null;
  if (
    !users.every(
      (user) =>
        Boolean(user) &&
        typeof user === "object" &&
        !Array.isArray(user) &&
        typeof (user as { id?: unknown }).id === "string" &&
        typeof (user as { nickname?: unknown }).nickname === "string" &&
        typeof (user as { mutedAt?: unknown }).mutedAt === "string",
    )
  ) {
    return null;
  }
  return users as MutedUser[];
}

function formatMutedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "숨긴 날짜를 확인할 수 없음" : `${mutedAtFormatter.format(date)} 숨김`;
}

export default function MutedAuthorsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<MutedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [unmutingId, setUnmutingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadMutedAuthors() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/community/mutes", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);

        if (response.status === 401) {
          router.replace(pathWithAuthReturn("/login", weddingPath(MUTED_AUTHORS_PATH)));
          return;
        }
        if (!response.ok) {
          throw new Error(apiErrorMessage(payload, "숨긴 작성자 목록을 불러오지 못했습니다."));
        }

        const nextUsers = parseMutedUsers(payload);
        if (!nextUsers) throw new Error("숨긴 작성자 목록의 형식을 확인하지 못했습니다.");
        if (!cancelled) setUsers(nextUsers);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "숨긴 작성자 목록을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMutedAuthors();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadAttempt, router]);

  async function handleUnmute(user: MutedUser) {
    if (unmutingId) return;
    setUnmutingId(user.id);
    setActionError("");
    setActionSuccess("");

    try {
      const response = await fetch("/api/community/mutes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        router.replace(pathWithAuthReturn("/login", weddingPath(MUTED_AUTHORS_PATH)));
        return;
      }
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "작성자 숨김을 해제하지 못했습니다."));
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        (payload as { muted?: unknown }).muted !== false
      ) {
        throw new Error("작성자 숨김 해제 결과를 확인하지 못했습니다.");
      }

      setUsers((current) => current.filter((item) => item.id !== user.id));
      setActionSuccess(`${user.nickname}님의 글 숨김을 해제했습니다.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "작성자 숨김을 해제하지 못했습니다.",
      );
    } finally {
      setUnmutingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href={weddingPath("/community/my/posts")}
          aria-label="내 활동으로 돌아가기"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white text-[#263832] transition-colors hover:bg-[#F7F1E8]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold text-[#263832]">숨긴 작성자</h1>
          <p className="mt-1 text-[13px] font-medium text-[#7D7166]">
            숨김을 해제하면 해당 작성자의 공개 글과 과거 댓글이 다시 보입니다.
          </p>
        </div>
      </header>

      {actionSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-start gap-2 rounded-xl border border-[#C7D1C2] bg-[#F2F6F0] px-4 py-3 text-sm font-medium text-[#36534E]"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError} 목록은 변경하지 않았습니다. 다시 시도해 주세요.</span>
        </div>
      )}

      {loading ? (
        <div
          role="status"
          aria-label="숨긴 작성자 목록을 불러오는 중"
          className="flex min-h-56 items-center justify-center rounded-2xl border border-[#E5D8CA] bg-white"
        >
          <Loader2 className="h-6 w-6 animate-spin text-[#6D806E]" />
        </div>
      ) : loadError ? (
        <section
          role="alert"
          className="rounded-2xl border border-red-200 bg-white px-6 py-10 text-center shadow-sm"
        >
          <AlertTriangle className="mx-auto h-9 w-9 text-red-500" />
          <h2 className="mt-3 text-base font-semibold text-[#263832]">목록을 불러오지 못했습니다</h2>
          <p className="mt-1 text-sm leading-6 text-[#7D7166]">{loadError}</p>
          <p className="mt-1 text-xs text-[#928980]">기존 숨김 설정은 그대로 유지됩니다.</p>
          <button
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#36534E] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#2B423E]"
          >
            <Undo2 className="h-4 w-4" />
            다시 시도
          </button>
        </section>
      ) : users.length === 0 ? (
        <section className="rounded-2xl border border-[#E5D8CA] bg-white px-6 py-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F1E8] text-[#6D806E]">
            <EyeOff className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-[#263832]">숨긴 작성자가 없습니다</h2>
          <p className="mt-1 text-sm leading-6 text-[#7D7166]">
            게시글에서 숨긴 작성자가 생기면 이곳에서 확인하고 해제할 수 있습니다.
          </p>
          <Link
            href={weddingPath()}
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#36534E] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#2B423E]"
          >
            커뮤니티 둘러보기
          </Link>
        </section>
      ) : (
        <section aria-label="숨긴 작성자 목록" className="overflow-hidden rounded-2xl border border-[#E5D8CA] bg-white shadow-sm">
          <div className="border-b border-[#EFE4D7] bg-[#FBF8F2] px-5 py-4">
            <p className="text-sm font-medium leading-6 text-[#635B51]">
              작성자 숨김은 내 계정에만 적용됩니다. 해제하면 커뮤니티에서 해당 작성자의 글과 과거 댓글이 다시 보입니다.
            </p>
          </div>
          <ul className="divide-y divide-[#EFE4D7]">
            {users.map((user) => (
              <li key={user.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-[#263832]">{user.nickname}</p>
                  <time dateTime={user.mutedAt} className="mt-1 block text-xs font-medium text-[#928980]">
                    {formatMutedAt(user.mutedAt)}
                  </time>
                </div>
                <button
                  type="button"
                  onClick={() => void handleUnmute(user)}
                  disabled={unmutingId !== null}
                  aria-label={`${user.nickname} 작성자 숨김 해제`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[#36534E] transition-colors hover:bg-[#F2F6F0] disabled:cursor-wait disabled:opacity-60"
                >
                  {unmutingId === user.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Undo2 className="h-4 w-4" />
                  )}
                  {unmutingId === user.id ? "해제 중..." : "숨김 해제"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
