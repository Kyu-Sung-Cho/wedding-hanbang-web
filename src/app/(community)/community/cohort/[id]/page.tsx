"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  Users,
  TrendingUp,
  Calendar,
  Send,
  Plus,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/community/Toast";
import { COHORT_THREAD_TOPICS, COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import type {
  CohortRoom,
  CohortMessage,
  CohortContract,
  CohortStat,
  CohortTimelineEvent,
  CohortThreadTopic,
  CohortContractCategory,
  CohortEventType,
} from "@/types/community.types";

// ────────────────────────────────────────
// 상수
// ────────────────────────────────────────
const TAB_KEYS = ["chat", "info", "timeline"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const EVENT_LABEL: Record<CohortEventType, string> = {
  venue_booked: "웨딩홀 예약",
  studio_booked: "스튜디오 예약",
  dress_booked: "드레스 예약",
  makeup_booked: "메이크업 예약",
  tour_done: "투어 완료",
  contract_done: "계약 완료",
  invitation_sent: "청첩장 발송",
  progress_update: "준비 업데이트",
  wedding_done: "결혼식 완료",
};

// 국가 평균 (샘플 부족 시 대체)
const NATIONAL_AVG: Record<CohortContractCategory, number> = {
  studio: 346,
  dress: 190,
  makeup: 85,
  venue: 1200,
  snap: 70,
  ring: 300,
  honeymoon: 500,
  other: 0,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

// ────────────────────────────────────────
// 페이지 래퍼
// ────────────────────────────────────────
export default function CohortPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#FAFAF8] text-sm text-[#878680]">
          불러오는 중...
        </div>
      }
    >
      <CohortPageInner roomId={id} />
    </Suspense>
  );
}

// ────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────
function CohortPageInner({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("chat");
  const [room, setRoom] = useState<CohortRoom | null>(null);

  // 초기 방 정보 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/community/cohort");
      const data = await res.json();
      if (!cancelled && data?.room?.id === roomId) {
        setRoom(data.room);
      } else if (!cancelled) {
        // 방 데이터가 일치 안하면 직접 조회 (멤버일 수 있음)
        const { data: r } = await supabase
          .from("cohort_rooms")
          .select("*")
          .eq("id", roomId)
          .maybeSingle();
        if (r) setRoom(r as CohortRoom);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, supabase]);

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 border-b border-[#F0EFED] bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="font-serif text-lg text-[#1A1A1F]">
            {room?.name ?? "동기방"}
          </h1>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#878680]">
            <Users className="h-3 w-3" />
            <span>{room?.member_count ?? 0}명 참여</span>
          </div>
        </div>

        {/* 탭 */}
        <div className="mx-auto flex max-w-3xl border-t border-[#F0EFED]">
          <TabButton
            active={tab === "chat"}
            onClick={() => setTab("chat")}
            icon={<MessageCircle className="h-4 w-4" />}
            label="채팅"
          />
          <TabButton
            active={tab === "info"}
            onClick={() => setTab("info")}
            icon={<TrendingUp className="h-4 w-4" />}
            label="정보판"
          />
          <TabButton
            active={tab === "timeline"}
            onClick={() => setTab("timeline")}
            icon={<Calendar className="h-4 w-4" />}
            label="타임라인"
          />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4">
        {tab === "chat" && <ChatTab roomId={roomId} toastError={toast.error} />}
        {tab === "info" && <InfoTab roomId={roomId} toastFn={toast} />}
        {tab === "timeline" && <TimelineTab roomId={roomId} toastFn={toast} />}
      </main>
    </div>
  );
}

// ────────────────────────────────────────
// 탭 버튼
// ────────────────────────────────────────
function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3 text-sm transition-colors ${
        active
          ? "border-[#C4967E] text-[#C4967E]"
          : "border-transparent text-[#878680] hover:text-[#1A1A1F]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ────────────────────────────────────────
// 채팅 탭
// ────────────────────────────────────────
function ChatTab({
  roomId,
  toastError,
}: {
  roomId: string;
  toastError: (msg: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<CohortMessage[]>([]);
  const [filter, setFilter] = useState<CohortThreadTopic | "all">("all");
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<CohortThreadTopic | "">("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 메시지 로드
  const loadMessages = useCallback(async () => {
    const url =
      filter === "all"
        ? `/api/community/cohort/${roomId}/messages`
        : `/api/community/cohort/${roomId}/messages?thread_topic=${filter}`;
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok) {
      setMessages(data.messages ?? []);
    }
  }, [roomId, filter]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Realtime 구독
  useEffect(() => {
    const channel = supabase
      .channel("cohort:" + roomId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cohort_messages",
          filter: "room_id=eq." + roomId,
        },
        async (payload) => {
          const newMsg = payload.new as CohortMessage;
          // 필터에 맞지 않으면 무시
          if (filter !== "all" && newMsg.thread_topic !== filter) return;
          // author 프로필 join해서 추가
          const { data: authorData } = await supabase
            .from("community_profiles")
            .select("user_id, nickname, avatar_url, rank")
            .eq("user_id", newMsg.author_id)
            .maybeSingle();
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [
              ...prev,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { ...newMsg, author: (authorData as any) ?? undefined },
            ];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId, filter]);

  // 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/community/cohort/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: input,
          thread_topic: thread || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        toastError(d.error ?? "전송 실패");
        return;
      }
      setInput("");
    } catch {
      toastError("네트워크 오류");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-200px)] flex-col">
      {/* 필터 pill */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="전체"
        />
        {COHORT_THREAD_TOPICS.map((t) => (
          <FilterPill
            key={t.key}
            active={filter === t.key}
            onClick={() => setFilter(t.key)}
            label={t.label}
          />
        ))}
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[#F0EFED] bg-white p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#B5ADA3]">
            아직 메시지가 없어요. 첫 메시지를 남겨보세요.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 */}
      <div className="mt-3 rounded-2xl border border-[#F0EFED] bg-white p-3">
        <div className="mb-2 flex gap-2">
          <select
            value={thread}
            onChange={(e) =>
              setThread(e.target.value as CohortThreadTopic | "")
            }
            className="rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-1.5 text-xs text-[#1A1A1F] outline-none"
          >
            <option value="">주제 없음</option>
            {COHORT_THREAD_TOPICS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="메시지 입력..."
            rows={2}
            className="flex-1 resize-none rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm text-[#1A1A1F] outline-none focus:border-[#C4967E]"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="flex items-center justify-center rounded-xl bg-[#1A1A1F] px-4 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-[#C4967E] bg-[#C4967E] text-white"
          : "border-[#F0EFED] bg-white text-[#878680] hover:text-[#1A1A1F]"
      }`}
    >
      {label}
    </button>
  );
}

function MessageBubble({ message }: { message: CohortMessage }) {
  const nickname = message.author?.nickname ?? "익명";
  const initial = nickname[0] ?? "?";
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C4967E] text-xs font-medium text-white">
        {message.author?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.author.avatar_url}
            alt=""
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initial
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#1A1A1F]">{nickname}</span>
          {message.author?.rank && (
            <span className="rounded-full bg-[#F0EFED] px-1.5 py-0.5 text-[23px] text-[#878680]">
              {message.author.rank}
            </span>
          )}
          <span className="text-[23px] text-[#B5ADA3]">
            {relativeTime(message.created_at)}
          </span>
          {message.thread_topic && (
            <span className="rounded-full bg-[#FAF8F5] px-1.5 py-0.5 text-[23px] text-[#C4967E]">
              {COHORT_THREAD_TOPICS.find((t) => t.key === message.thread_topic)
                ?.label ?? message.thread_topic}
            </span>
          )}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#1A1A1F]">
          {message.content}
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// 정보판 탭
// ────────────────────────────────────────
type ToastFnLike = {
  success: (m: string) => void;
  error: (m: string) => void;
};

function InfoTab({
  roomId,
  toastFn,
}: {
  roomId: string;
  toastFn: ToastFnLike;
}) {
  const [stats, setStats] = useState<CohortStat[]>([]);
  const [contracts, setContracts] = useState<CohortContract[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/community/cohort/${roomId}/contracts`);
    const data = await res.json();
    if (res.ok) {
      setStats(data.stats ?? []);
      setContracts(data.contracts ?? []);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  const statByCat = useMemo(() => {
    const map: Partial<Record<CohortContractCategory, CohortStat>> = {};
    for (const s of stats) map[s.category] = s;
    return map;
  }, [stats]);

  return (
    <div>
      {/* 등록 버튼 */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1A1A1F] px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        내 계약 정보 등록
      </button>

      {/* 카테고리별 카드 */}
      <div className="space-y-3">
        {COHORT_CONTRACT_CATEGORIES.map((cat) => {
          const stat = statByCat[cat.key as CohortContractCategory];
          const sample = stat?.sample_size ?? 0;
          const enough = sample >= 5;
          return (
            <div
              key={cat.key}
              className="rounded-2xl border border-[#F0EFED] bg-white p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-serif text-sm text-[#1A1A1F]">
                  {cat.label}
                </h3>
                <span className="text-[23px] text-[#B5ADA3]">
                  {sample}명 등록
                </span>
              </div>
              {enough && stat ? (
                <div>
                  <p className="text-xs text-[#878680]">
                    우리 동기 평균 {cat.label} 기본금
                  </p>
                  <p className="mt-1 font-serif text-2xl text-[#1A1A1F]">
                    {stat.avg_base_price.toLocaleString()}만원
                    <span className="ml-1 text-xs font-sans text-[#878680]">
                      ({sample}명 기준)
                    </span>
                  </p>
                  {stat.avg_extra_price > 0 && (
                    <p className="mt-0.5 text-xs text-[#B5ADA3]">
                      추가금 평균 {stat.avg_extra_price.toLocaleString()}만원
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-[#C9A96E]" />
                    <p className="text-xs text-[#878680]">
                      아직 우리 동기 데이터가 부족해요. 정보를 등록하면
                      우리끼리의 평균이 나와요!
                    </p>
                  </div>
                  {NATIONAL_AVG[cat.key as CohortContractCategory] > 0 && (
                    <p className="text-[23px] text-[#B5ADA3]">
                      전국 평균:{" "}
                      {NATIONAL_AVG[
                        cat.key as CohortContractCategory
                      ].toLocaleString()}
                      만원
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {contracts.length > 0 && (
        <div className="mt-4 text-[23px] text-[#B5ADA3]">
          동기방 내 총 {contracts.length}건의 계약 정보
        </div>
      )}

      {/* 모달 */}
      {modalOpen && (
        <ContractModal
          roomId={roomId}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            load();
            toastFn.success("계약 정보가 등록되었어요");
          }}
          onError={(m) => toastFn.error(m)}
        />
      )}
    </div>
  );
}

function ContractModal({
  roomId,
  onClose,
  onSaved,
  onError,
}: {
  roomId: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState<CohortContractCategory>("venue");
  const [basePrice, setBasePrice] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!vendorName.trim() || !basePrice) {
      onError("업체명과 기본금을 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/community/cohort/${roomId}/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_name: vendorName,
          category,
          base_price: Number(basePrice),
          extra_price: extraPrice ? Number(extraPrice) : undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        onError(d.error ?? "등록 실패");
        return;
      }
      onSaved();
    } catch {
      onError("네트워크 오류");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#F0EFED] bg-white p-5">
        <h3 className="mb-4 font-serif text-lg text-[#1A1A1F]">
          내 계약 정보 등록
        </h3>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#878680]">업체명</label>
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="예) XX스튜디오"
              className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#C4967E]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[#878680]">카테고리</label>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as CohortContractCategory)
              }
              className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#C4967E]"
            >
              {COHORT_CONTRACT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-[#878680]">
                기본금 (만원)
              </label>
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#C4967E]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#878680]">
                추가금 (만원)
              </label>
              <input
                type="number"
                value={extraPrice}
                onChange={(e) => setExtraPrice(e.target.value)}
                className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#C4967E]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[#878680]">메모</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#C4967E]"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-[#F0EFED] bg-white px-4 py-2.5 text-sm text-[#878680]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-[#1A1A1F] px-4 py-2.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// 타임라인 탭
// ────────────────────────────────────────
function TimelineTab({
  roomId,
  toastFn,
}: {
  roomId: string;
  toastFn: ToastFnLike;
}) {
  const [events, setEvents] = useState<CohortTimelineEvent[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/community/cohort/${roomId}/timeline`);
      const data = await res.json();
      if (res.ok) {
        setEvents(data.events ?? []);
      } else {
        toastFn.error(data.error ?? "타임라인 로드 실패");
      }
    })();
  }, [roomId, toastFn]);

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-[#F0EFED] bg-white p-8 text-center text-sm text-[#B5ADA3]">
        아직 타임라인 이벤트가 없어요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((ev) => {
        const nickname = ev.user?.nickname ?? "익명";
        const initial = nickname[0] ?? "?";
        const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;
        return (
          <div
            key={ev.id}
            className="flex items-start gap-3 rounded-2xl border border-[#F0EFED] bg-white p-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#C4967E] text-sm font-medium text-white">
              {ev.user?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ev.user.avatar_url}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                initial
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm text-[#1A1A1F]">
                예신{nickname}가{" "}
                <span className="font-medium text-[#C4967E]">{label}</span>{" "}
                완료!
              </p>
              {ev.description && (
                <p className="mt-1 text-xs text-[#878680]">{ev.description}</p>
              )}
              <p className="mt-1 text-[23px] text-[#B5ADA3]">
                {relativeTime(ev.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
