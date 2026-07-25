"use client";

import Link from "next/link";
import { Bookmark, Loader2, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { weddingLinkProps } from "@/lib/weddingPaths";

type SavedNote = {
  id: string;
  messageId: string | null;
  content: string;
  memo: string | null;
  savedByMe: boolean;
  createdAt: string;
};

type LoadStatus = "loading" | "ready" | "error";

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default function SavedNotesContent() {
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/amora/notes", { cache: "no-store" });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      const body = await response.json() as { notes?: SavedNote[] };
      setNotes(Array.isArray(body.notes) ? body.notes : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMemo = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch("/api/amora/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, memo: memoDraft }),
      });
      if (response.ok) {
        const memo = memoDraft.trim() ? memoDraft.trim() : null;
        setNotes((current) => current.map((note) => (note.id === id ? { ...note, memo } : note)));
        setEditingId(null);
      }
    } catch {
      // 실패하면 편집 상태를 유지해 사용자가 다시 시도할 수 있게 둔다.
    } finally {
      setBusyId(null);
    }
  }, [memoDraft]);

  const removeNote = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch("/api/amora/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (response.ok) setNotes((current) => current.filter((note) => note.id !== id));
    } catch {
      // 무시 — 목록은 그대로 남는다.
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="border-b border-[#E8E0D8] pb-6">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-[#9A6B62]">
          <Bookmark aria-hidden="true" className="h-4 w-4" />
          저장한 이야기
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#1A1A1F] sm:text-3xl">
          다시 볼 것만 모아뒀어요
        </h1>
        <p className="mt-2 text-base leading-7 text-[#928980]">
          아모라와 나눈 이야기 중 저장한 것들이에요. 대화에서 저장 버튼을 누르면
          여기 쌓입니다. 둘 중 누가 저장해도 같이 보여요.
        </p>
      </header>

      {status === "loading" ? (
        <p className="flex items-center gap-2 py-12 text-base text-[#928980]">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          불러오는 중이에요
        </p>
      ) : null}

      {status === "error" ? (
        <div className="py-12">
          <p className="text-base font-semibold text-[#1A1A1F]">지금은 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 min-h-11 rounded-xl bg-[#C4967E]/10 px-4 text-base font-bold text-[#9A6B62] hover:bg-[#C4967E]/20"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {status === "ready" && notes.length === 0 ? (
        <div className="py-14 text-center">
          <p className="text-base font-semibold text-[#1A1A1F]">아직 저장한 이야기가 없어요.</p>
          <p className="mt-2 text-base text-[#928980]">
            아모라가 한 말 아래 &ldquo;저장&rdquo;을 누르면 여기로 모여요.
          </p>
          <Link
            {...weddingLinkProps("/chat")}
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#C4967E] px-5 text-base font-bold text-white hover:bg-[#B5876F]"
          >
            아모라와 이야기하기
          </Link>
        </div>
      ) : null}

      {status === "ready" && notes.length > 0 ? (
        <ul className="mt-6 space-y-4">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-2xl border border-[#E8E0D8] bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-[#B5ADA3]">
                  {formatSavedAt(note.createdAt)}
                  {note.savedByMe ? " · 내가 저장" : " · 파트너가 저장"}
                </p>
                <button
                  type="button"
                  onClick={() => void removeNote(note.id)}
                  disabled={busyId === note.id}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm text-[#B5ADA3] hover:text-[#9A6B62] disabled:opacity-40"
                  aria-label="저장 지우기"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  지우기
                </button>
              </div>

              {/* 원문 그대로 — 우리가 줄이거나 바꾸지 않는다. */}
              <p className="mt-3 whitespace-pre-line text-base leading-7 text-[#1A1A1F]">
                {note.content}
              </p>

              {editingId === note.id ? (
                <div className="mt-4">
                  <textarea
                    value={memoDraft}
                    onChange={(event) => setMemoDraft(event.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="왜 저장했는지 적어두면 나중에 찾기 쉬워요"
                    className="w-full rounded-xl border border-[#E8E0D8] bg-[#FAF8F5] px-3 py-2 text-base text-[#1A1A1F] placeholder-[#B5ADA3] focus:border-[#C4967E]/40 focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveMemo(note.id)}
                      disabled={busyId === note.id}
                      className="min-h-11 rounded-xl bg-[#C4967E] px-4 text-base font-bold text-white hover:bg-[#B5876F] disabled:opacity-40"
                    >
                      메모 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="min-h-11 rounded-xl px-4 text-base font-semibold text-[#928980] hover:text-[#1A1A1F]"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(note.id);
                    setMemoDraft(note.memo ?? "");
                  }}
                  className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-[#9A6B62] hover:text-[#C4967E]"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  {note.memo ? note.memo : "메모 남기기"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
