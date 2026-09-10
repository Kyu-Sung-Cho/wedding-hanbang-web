"use client";

import Link from "next/link";
import { Bookmark, Loader2, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

type SavedNote = {
  id: string;
  messageId: string | null;
  content: string;
  memo: string | null;
  savedByMe: boolean;
  createdAt: string;
};

type LoadStatus = "loading" | "ready" | "error";
const notesSchema = z.object({ notes: z.array(z.object({
  id: z.string().uuid(), messageId: z.string().uuid().nullable(),
  content: z.string().min(1).max(4_000), memo: z.string().max(500).nullable(),
  savedByMe: z.boolean(), createdAt: z.string(),
})).max(300), next_cursor: z.string().min(1).max(2_048).nullable().optional() });

function savedNotesScope(state: ReturnType<typeof useAuthStore.getState>) {
  if (!state.isInitialized || !state.user || state.profile?.id !== state.user.id) return "";
  return JSON.stringify([state.user.id, state.profile.couple_id, state.isDemo]);
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default function SavedNotesContent({ embedded = false }: { embedded?: boolean }) {
  const scope = useAuthStore(savedNotesScope);
  const initialized = useAuthStore(state => state.isInitialized);
  if (!scope) return <p role="status" className="px-5 py-12 text-[var(--hb-text-muted)]">{initialized ? "로그인과 커플 정보를 확인하고 있어요." : "불러오는 중이에요"}</p>;
  // 계정·커플이 바뀌면 목록뿐 아니라 작성 중인 메모와 늦게 온 응답도 분리한다.
  return <ScopedSavedNotesContent key={scope} scope={scope} embedded={embedded} />;
}

function ScopedSavedNotesContent({ scope, embedded }: { scope: string; embedded: boolean }) {
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 저장·삭제가 거절된 이유. 불러오기 실패와 달리 목록은 그대로 두고 위에 띄운다. */
  const [actionError, setActionError] = useState<string | null>(null);
  const lifecycle = useRef(0);
  const sequence = useRef(0);
  const pending = useRef(false);
  const readPending = useRef(false);
  const stillCurrent = useCallback((generation: number) => generation === lifecycle.current
    && savedNotesScope(useAuthStore.getState()) === scope, [scope]);

  const load = useCallback(async (cursor: string | null = null) => {
    if (pending.current || readPending.current) return;
    readPending.current = true;
    const generation = lifecycle.current;
    const request = ++sequence.current;
    const current = () => stillCurrent(generation) && request === sequence.current;
    if (cursor) setLoadingMore(true); else setStatus("loading");
    try {
      const response = await fetch(`/api/amora/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("read_failed");
      const body = notesSchema.parse(await response.json());
      if (cursor && body.next_cursor === cursor) throw new Error("cursor_did_not_advance");
      if (body.next_cursor && body.notes.length === 0) throw new Error("empty_cursor_page");
      if (current()) {
        setNotes(previous => cursor ? [...new Map([...previous, ...body.notes].map(note => [note.id, note])).values()] : body.notes);
        setNextCursor(body.next_cursor ?? null); setStatus("ready");
      }
    } catch {
      if (current()) setStatus("error");
    } finally {
      if (current()) { readPending.current = false; setLoadingMore(false); }
    }
  }, [stillCurrent]);

  useEffect(() => {
    void load();
    return () => { lifecycle.current += 1; sequence.current += 1; readPending.current = false; };
  }, [load]);

  /** 서버가 준 이유를 읽는다. 없으면 부르는 쪽이 준 기본 문구. */
  async function readError(response: Response, fallback: string): Promise<string> {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    return typeof data?.error === "string" && data.error.trim() ? data.error : fallback;
  }

  const saveMemo = useCallback(async (id: string) => {
    const generation = lifecycle.current;
    if (pending.current || readPending.current || !stillCurrent(generation) || memoDraft.length > 500) return;
    pending.current = true;
    const memo = memoDraft.trim() || null;
    setBusyId(id);
    try {
      const response = await fetch("/api/amora/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, memo: memoDraft, expectedMemo: notes.find(note => note.id === id)?.memo }),
      });
      const receipt = await response.clone().json().catch(() => null) as { updated?: unknown; id?: unknown } | null;
      if (!stillCurrent(generation)) return;
      if (response.ok && receipt?.updated === true && receipt.id === id) {
        setNotes((current) => current.map((note) => (note.id === id ? { ...note, memo } : note)));
        setEditingId(null);
        setActionError(null);
      } else {
        // 편집 상태는 유지하되 **왜 안 됐는지 말한다.** 예전에는 아무 신호가 없어
        // 눌러도 아무 일이 없는 것처럼 보였다. 서버는 401/403/404/500 을 문장으로 준다.
        setActionError(await readError(response, "메모를 저장하지 못했어요."));
      }
    } catch {
      if (stillCurrent(generation)) setActionError("메모 저장 여부를 확인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      pending.current = false;
      if (stillCurrent(generation)) setBusyId(null);
    }
  }, [memoDraft, notes, stillCurrent]);

  const removeNote = useCallback(async (id: string) => {
    const generation = lifecycle.current;
    if (pending.current || readPending.current || !stillCurrent(generation) || !notes.find(note => note.id === id)?.savedByMe) return;
    pending.current = true;
    setBusyId(id);
    try {
      const response = await fetch("/api/amora/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const receipt = await response.clone().json().catch(() => null) as { deleted?: unknown; id?: unknown } | null;
      if (!stillCurrent(generation)) return;
      if (response.ok && receipt?.deleted === true && receipt.id === id) {
        setNotes((current) => current.filter((note) => note.id !== id));
        window.dispatchEvent(new Event("amora-saved-notes-changed"));
        if (editingId === id) { setEditingId(null); setMemoDraft(""); }
        setActionError(null);
      } else {
        setActionError(await readError(response, "저장한 답변을 지우지 못했어요."));
      }
    } catch {
      if (stillCurrent(generation)) setActionError("삭제 여부를 확인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      pending.current = false;
      if (stillCurrent(generation)) setBusyId(null);
    }
  }, [editingId, notes, stillCurrent]);

  return (
    <div className={embedded ? "w-full min-w-0 max-w-3xl py-3" : "mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10"}>
      <header className="border-b border-[var(--amora-line)] pb-4">
        {embedded ? <h2 className="text-[16px] font-semibold text-[var(--amora-ink)]">저장한 답변</h2> : <>
        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-[#9A6B62]">
          <Bookmark aria-hidden="true" className="h-4 w-4" />
          저장한 답변
        </p>
        <h1 className="mt-2 text-[var(--hb-text-strong)]">
          다시 볼 것만 모아뒀어요
        </h1>
        </>}
        <p className="mt-2 text-[13px] leading-6 text-[var(--amora-muted)]">
          두 분이 함께 보는 참고 답변과 메모예요. 확정된 결정은 아니에요.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-[var(--amora-accent)]">
          {!embedded && <>
          <Link {...weddingLinkProps("/chat")} className="inline-flex min-h-11 items-center underline underline-offset-4">아모라 대화</Link>
          <Link {...weddingLinkProps("/chat/board")} className="inline-flex min-h-11 items-center underline underline-offset-4">준비 보드</Link>
          </>}
          <button type="button" disabled={status === "loading" || loadingMore || busyId !== null || editingId !== null} onClick={() => void load()} className="min-h-11 disabled:opacity-40">새로고침</button>
        </div>
      </header>

      {status === "loading" ? (
        <p className="flex items-center gap-2 py-12 text-base text-[var(--hb-text-muted)]">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          불러오는 중이에요
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-4 text-sm text-[#D95F5F]">
          {actionError}
        </p>
      ) : null}

      {status === "error" ? (
        <div className="py-12">
          <p className="text-base font-semibold text-[var(--hb-text-strong)]">지금은 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => void load(notes.length && nextCursor ? nextCursor : null)}
            disabled={loadingMore || busyId !== null || editingId !== null}
            className="mt-3 min-h-11 rounded-[6px] bg-[#C4967E]/10 px-4 text-base font-bold text-[#9A6B62] hover:bg-[#C4967E]/20"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {status === "ready" && notes.length === 0 && !nextCursor ? (
        <div className="py-14 text-center">
          <p className="text-base font-semibold text-[var(--hb-text-strong)]">아직 저장한 답변이 없어요.</p>
          <p className="mt-2 text-base text-[var(--hb-text-muted)]">
            함께 대화의 아모라 답변 아래 저장 버튼을 누르면 여기에 모여요.
          </p>
          <Link
            {...weddingLinkProps("/chat")}
            className="mt-5 inline-flex min-h-11 items-center rounded-[6px] bg-[#C4967E] px-5 text-base font-bold text-white hover:bg-[#B5876F]"
          >
            아모라와 이야기하기
          </Link>
        </div>
      ) : null}

      {status !== "loading" && notes.length > 0 ? (
        <ul className="mt-6 space-y-4">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-[6px] border border-[#E8E0D8] bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-[var(--hb-text-muted)]">
                  {formatSavedAt(note.createdAt)}
                  {note.savedByMe ? " · 내가 저장" : " · 파트너가 저장"}
                </p>
                {note.savedByMe && <button
                  type="button"
                  onClick={() => void removeNote(note.id)}
                  disabled={busyId !== null || loadingMore}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[6px] px-2 text-sm whitespace-nowrap text-[var(--hb-text-muted)] hover:text-[#9A6B62] disabled:opacity-40"
                  aria-label="저장 지우기"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  지우기
                </button>}
              </div>

              {/* 원문 그대로 — 우리가 줄이거나 바꾸지 않는다. */}
              <p className="mt-3 break-words whitespace-pre-line text-base leading-7 text-[var(--hb-text-strong)]">
                {note.content}
              </p>

              {editingId === note.id ? (
                <div className="mt-4">
                  <textarea
                    aria-label="저장한 답변 메모"
                    disabled={busyId !== null || loadingMore}
                    maxLength={500}
                    value={memoDraft}
                    onChange={(event) => setMemoDraft(event.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="왜 저장했는지 적어두면 나중에 찾기 쉬워요"
                    className="w-full rounded-[6px] border border-[#E8E0D8] bg-[#FAF8F5] px-3 py-2 text-base text-[var(--hb-text-strong)] placeholder-[#B5ADA3] focus:border-[#C4967E]/40 focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveMemo(note.id)}
                      disabled={busyId !== null || loadingMore}
                      className="min-h-11 rounded-[6px] bg-[#C4967E] px-4 text-base font-bold text-white hover:bg-[#B5876F] disabled:opacity-40"
                    >
                      메모 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={busyId !== null}
                      className="min-h-11 rounded-[6px] px-4 text-base font-semibold text-[var(--hb-text-muted)] hover:text-[var(--hb-text-strong)]"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (pending.current) return;
                    setEditingId(note.id);
                    setMemoDraft(note.memo ?? "");
                  }}
                  disabled={busyId !== null || loadingMore}
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 break-words text-sm font-semibold text-[#9A6B62] hover:text-[#C4967E] disabled:opacity-40"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  {note.memo ? note.memo : "메모 남기기"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {nextCursor && <div className="mt-5 text-center text-sm text-[var(--hb-text-muted)]">
        <p>{notes.length}개를 불러왔어요. 이전 답변도 이어서 볼 수 있어요.</p>
        <button type="button" disabled={status === "loading" || loadingMore || busyId !== null || editingId !== null} onClick={() => void load(nextCursor)} className="mt-2 min-h-11 rounded-[6px] border border-[#E8E0D8] px-4 font-semibold text-[#9A6B62] disabled:opacity-40">{loadingMore ? "불러오는 중…" : "이전 답변 더 보기"}</button>
      </div>}
    </div>
  );
}
