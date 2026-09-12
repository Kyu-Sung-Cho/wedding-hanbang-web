"use client";

import Link from "next/link";
import { Bookmark, Loader2, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";

import Button from "@/components/ui/Button";
import { renderAiMarkdown } from "@/components/app/chat/renderAiMarkdown";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

type SavedNote = {
  id: string;
  messageId: string | null;
  content: string;
  sourceIsAi?: boolean;
  memo: string | null;
  savedByMe: boolean;
  createdAt: string;
};

type LoadStatus = "loading" | "ready" | "error";
type MemoConflict = { id: string; status: "needs_read" | "unavailable" }
  | { id: string; status: "ready"; memo: string | null };
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]";
const notesSchema = z.object({ notes: z.array(z.object({
  id: z.string().uuid(), messageId: z.string().uuid().nullable(),
  content: z.string().min(1).max(4_000), memo: z.string().max(500).nullable(),
  sourceIsAi: z.boolean().optional(),
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
  const [memoConflict, setMemoConflict] = useState<MemoConflict | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 저장·삭제가 거절된 이유. 불러오기 실패와 달리 목록은 그대로 두고 위에 띄운다. */
  const [actionError, setActionError] = useState<string | null>(null);
  const lifecycle = useRef(0);
  const sequence = useRef(0);
  const pending = useRef(false);
  const readPending = useRef(false);
  const notePageCursors = useRef(new Map<string, string | null>());
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
        if (!cursor) notePageCursors.current.clear();
        for (const note of body.notes) notePageCursors.current.set(note.id, cursor);
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

  const confirmCurrentMemo = useCallback(async (id: string) => {
    const generation = lifecycle.current;
    if (pending.current || readPending.current || !stillCurrent(generation) || editingId !== id || memoConflict?.id !== id) return;
    readPending.current = true;
    setBusyId(id);
    setActionError(null);
    try {
      // 같은 답변을 불러온 페이지를 한 번만 확인한다. 목록 이동을 삭제로 단정하지 않는다.
      if (!notePageCursors.current.has(id)) throw new Error("page_not_known");
      const cursor = notePageCursors.current.get(id);
      const response = await fetch(`/api/amora/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("read_failed");
      const body = notesSchema.parse(await response.json());
      const matches = body.notes.filter(note => note.id === id);
      if (matches.length !== 1) throw new Error("current_note_not_verified");
      if (!stillCurrent(generation)) return;
      const latestMemo = matches[0].memo;
      setNotes(current => current.map(note => note.id === id ? { ...note, memo: latestMemo } : note));
      setMemoConflict({ id, status: "ready", memo: latestMemo });
    } catch {
      if (stillCurrent(generation)) setMemoConflict({ id, status: "unavailable" });
    } finally {
      if (stillCurrent(generation)) { readPending.current = false; setBusyId(null); }
    }
  }, [editingId, memoConflict, stillCurrent]);

  const saveMemo = useCallback(async (id: string) => {
    const generation = lifecycle.current;
    if (pending.current || readPending.current || !stillCurrent(generation) || memoDraft.length > 500) return;
    const conflict = memoConflict?.id === id ? memoConflict : null;
    if (conflict && conflict.status !== "ready") return;
    pending.current = true;
    const memo = memoDraft.trim() || null;
    setBusyId(id);
    try {
      const response = await fetch("/api/amora/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, memo: memoDraft, expectedMemo: conflict?.status === "ready" ? conflict.memo : notes.find(note => note.id === id)?.memo }),
      });
      const receipt = await response.clone().json().catch(() => null) as { updated?: unknown; id?: unknown } | null;
      if (!stillCurrent(generation)) return;
      if (response.ok && receipt?.updated === true && receipt.id === id) {
        setNotes((current) => current.map((note) => (note.id === id ? { ...note, memo } : note)));
        setEditingId(null);
        setMemoConflict(null);
        setActionError(null);
      } else {
        if (response.status === 409) setMemoConflict({ id, status: "needs_read" });
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
  }, [memoConflict, memoDraft, notes, stillCurrent]);

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
        if (editingId === id) { setEditingId(null); setMemoDraft(""); setMemoConflict(null); }
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

              {/* 확인된 AI 출처의 내부 데이터만 가리고 사용자 원문은 유지한다. */}
              <div className="mt-3 min-w-0 break-words whitespace-pre-line text-base leading-7 text-[var(--hb-text-strong)]">
                {note.sourceIsAi === true ? renderAiMarkdown(getAmoraVisibleText(note.content)) : note.content}
              </div>

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
                    className={`w-full rounded-[6px] border border-[#E8E0D8] bg-[#FAF8F5] px-3 py-2 text-base text-[var(--hb-text-strong)] placeholder:text-[var(--amora-muted)] ${focus}`}
                  />
                  <p className="mt-2 text-sm leading-6 text-[var(--hb-text-muted)]">다른 답변의 메모를 쓰려면 먼저 이 메모를 저장하거나 취소해 주세요.</p>
                  {memoConflict?.id === note.id && <div role="status" aria-busy={busyId === note.id} className="mt-3 space-y-2 rounded-[6px] border border-[#E8E0D8] bg-[#FAF8F5] p-3 text-sm leading-6">
                    {memoConflict.status === "ready" ? <>
                      <p className="font-semibold">현재 저장된 메모</p>
                      <p className="whitespace-pre-wrap break-words">{memoConflict.memo ?? "현재 저장된 메모가 없어요."}</p>
                      <p>작성 중인 내용은 위에 그대로 있어요. 현재 메모를 바꿀지 확인한 뒤 저장해 주세요.</p>
                    </> : <>
                      <p>{memoConflict.status === "unavailable" ? "현재 메모를 확인하지 못했어요. 목록이 바뀌었거나 잠시 불러올 수 없어요. 작성한 내용은 그대로 두었어요." : "작성한 내용은 그대로 두었어요. 현재 저장된 메모를 먼저 확인해 주세요."}</p>
                      {busyId === note.id && <p>현재 메모를 확인하고 있어요…</p>}
                      <Button type="button" variant="secondary" disabled={busyId !== null || loadingMore} onClick={() => void confirmCurrentMemo(note.id)} className="border-[#E8E0D8]! bg-transparent! px-3! text-[var(--amora-accent)]! hover:bg-transparent! transition-none! disabled:opacity-40! focus-visible:outline-solid! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-[var(--amora-accent)]! focus-visible:ring-0! focus-visible:ring-offset-0!">현재 메모 확인</Button>
                    </>}
                  </div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveMemo(note.id)}
                      disabled={busyId !== null || loadingMore || (memoConflict?.id === note.id && memoConflict.status !== "ready")}
                      className={`min-h-11 max-w-full rounded-[6px] bg-[var(--amora-action)] px-4 py-2 text-base font-bold whitespace-normal text-white hover:bg-[var(--amora-action-hover)] disabled:opacity-40 ${focus}`}
                    >
                      {memoConflict?.id === note.id && memoConflict.status === "ready" ? "확인한 메모 대신 내 초안 저장" : "메모 저장"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setMemoConflict(null); setActionError(null); }}
                      disabled={busyId !== null}
                      className={`min-h-11 rounded-[6px] px-4 text-base font-semibold text-[var(--hb-text-muted)] hover:text-[var(--hb-text-strong)] ${focus}`}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (pending.current || editingId !== null) return;
                    setEditingId(note.id);
                    setMemoDraft(note.memo ?? "");
                    setMemoConflict(null);
                    setActionError(null);
                  }}
                  disabled={busyId !== null || loadingMore || editingId !== null}
                  className={`mt-4 inline-flex min-h-11 items-center gap-1.5 break-words text-sm font-semibold text-[var(--amora-accent)] hover:text-[var(--amora-ink)] disabled:opacity-40 ${focus}`}
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
