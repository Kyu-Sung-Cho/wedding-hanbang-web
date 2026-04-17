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
      <div className="flex w-full">
        {/* 왼쪽 사이드바 */}
        <aside className="hidden lg:flex flex-col w-[260px] xl:w-[280px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] overflow-y-auto border-r border-[#F0EFED] bg-white py-5 px-3 space-y-4">
          {/* 방 정보 */}
          <div className="px-2">
            <h2 className="font-serif text-base text-[#1A1A1F] font-medium">{room?.name ?? "동기방"}</h2>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[#878680]">
              <Users className="h-3 w-3" />
              <span>{room?.member_count ?? 0}명 참여</span>
            </div>
          </div>

          <div className="h-px bg-[#F0EFED]" />

          {/* 멤버 */}
          <CohortMemberPreview roomId={roomId} memberCount={room?.member_count ?? 0} />

          {/* 주제별 카테고리 */}
          <div className="px-2">
            <h3 className="text-xs font-medium text-[#878680] mb-2 uppercase tracking-wider">주제별 보기</h3>
            <div className="flex flex-col gap-0.5">
              {COHORT_THREAD_TOPICS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-[#878680] hover:bg-[#F5F2ED] hover:text-[#1A1A1F] transition-colors text-left"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C4967E]" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-[#F0EFED]" />

          {/* 동기방 규칙 */}
          <div className="px-2">
            <h3 className="text-xs font-medium text-[#878680] mb-2 uppercase tracking-wider">규칙</h3>
            <div className="space-y-1.5 text-[11px] text-[#B5ADA3] leading-relaxed">
              <p>• 서로 존중하며 대화해주세요</p>
              <p>• 개인정보(실명, 연락처) 공유 주의</p>
              <p>• 광고/홍보성 글은 삭제됩니다</p>
              <p>• 업체 후기는 솔직하게 작성해주세요</p>
            </div>
          </div>

          <div className="mt-auto" />

          {/* 아모라 CTA */}
          <div className="mx-2 rounded-2xl bg-[#1A1A1F] p-4 text-white">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#C9A96E]" />
              <span className="text-xs font-medium">AI 아모라</span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed mb-2.5">
              가격 비교, 견적 분석, 일정 상담
            </p>
            <a
              href="/chat"
              className="block w-full text-center bg-white text-[#1A1A1F] rounded-lg py-2 text-xs font-medium hover:bg-[#FAFAF8] transition-colors"
            >
              대화하기
            </a>
          </div>
        </aside>

        {/* 가운데: 메인 콘텐츠 */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* 탭 헤더 */}
          <div className="sticky top-[72px] z-10 bg-white border-b border-[#F0EFED]">
            <div className="flex">
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
          </div>

          <div className="px-4 lg:px-6 py-4 flex-1">
            {tab === "chat" && <ChatTab roomId={roomId} toastError={toast.error} />}
            {tab === "info" && <InfoTab roomId={roomId} toastFn={toast} />}
            {tab === "timeline" && <TimelineTab roomId={roomId} toastFn={toast} />}
          </div>
        </main>

        {/* 오른쪽 사이드바 */}
        <aside className="hidden xl:flex flex-col w-[280px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] overflow-y-auto border-l border-[#F0EFED] py-5 px-3 space-y-4">
          {/* 인기글 */}
          <CohortPopularPosts roomId={roomId} />
        </aside>
      </div>
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
    <div className="flex h-[calc(100vh-140px)] flex-col">
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
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setThread("")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              thread === ""
                ? "bg-[#1A1A1F] text-white"
                : "bg-[#F5F2ED] text-[#878680] hover:bg-[#F0EFED]"
            }`}
          >
            주제 없음
          </button>
          {COHORT_THREAD_TOPICS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setThread(thread === t.key ? "" : (t.key as CohortThreadTopic))}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                thread === t.key
                  ? "bg-[#1A1A1F] text-white"
                  : "bg-[#F5F2ED] text-[#878680] hover:bg-[#F0EFED]"
              }`}
            >
              {t.label}
            </button>
          ))}
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
            src={message.author?.avatar_url ?? ""}
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
            <span className="rounded-full bg-[#F0EFED] px-1.5 py-0.5 text-[10px] text-[#878680]">
              {message.author?.rank}
            </span>
          )}
          <span className="text-[10px] text-[#B5ADA3]">
            {relativeTime(message.created_at)}
          </span>
          {message.thread_topic && (
            <span className="rounded-full bg-[#FAF8F5] px-1.5 py-0.5 text-[10px] text-[#C4967E]">
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
                <span className="text-[11px] text-[#B5ADA3]">
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
                    <p className="text-[11px] text-[#B5ADA3]">
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
        <div className="mt-4 text-[11px] text-[#B5ADA3]">
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
              <p className="mt-1 text-[11px] text-[#B5ADA3]">
                {relativeTime(ev.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────
// 왼쪽 사이드바: 동기 인기글
// ────────────────────────────────────────
function CohortPopularPosts({ roomId }: { roomId: string }) {
  const [posts, setPosts] = useState<{ id: string; title: string; upvote_count: number; comment_count: number }[]>([]);

  useEffect(() => {
    fetch(`/api/community/posts?sort=hot&limit=5`)
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((d) => setPosts(d.posts ?? []))
      .catch(() => {});
  }, [roomId]);

  const RANK_COLORS: Record<number, string> = { 0: "text-[#C9A96E]", 1: "text-[#B5ADA3]", 2: "text-[#C4967E]" };

  return (
    <div className="rounded-2xl border border-[#F0EFED] bg-white p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🔥</span>
        <h3 className="text-sm font-medium text-[#1A1A1F]">인기글</h3>
      </div>
      {posts.length === 0 ? (
        <p className="text-xs text-[#B5ADA3] py-2">아직 인기글이 없어요</p>
      ) : (
        <div className="space-y-1">
          {posts.slice(0, 5).map((p, i) => (
            <a
              key={p.id}
              href={`/community/post/${p.id}`}
              className="flex items-start gap-2.5 px-2 py-2 rounded-xl hover:bg-[#FAFAF8] transition-colors group"
            >
              <span className={`text-sm font-semibold tabular-nums shrink-0 w-5 ${RANK_COLORS[i] ?? "text-[#B5ADA3]"}`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#1A1A1F] truncate group-hover:text-[#C4967E] transition-colors">
                  {p.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#B5ADA3]">
                  <span>▲ {p.upvote_count}</span>
                  <span>💬 {p.comment_count}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// 오른쪽 사이드바: 멤버 프리뷰
// ────────────────────────────────────────
const MEMBER_GRADIENTS = [
  "from-[#C4967E] to-[#C9A96E]",
  "from-[#A8D8A8] to-[#6BBF6B]",
  "from-[#7EB8D8] to-[#5A9CC0]",
  "from-[#C9A96E] to-[#DCC9A0]",
  "from-[#D88B8B] to-[#C06B6B]",
  "from-[#B39DDB] to-[#7E57C2]",
];

function CohortMemberPreview({ roomId, memberCount }: { roomId: string; memberCount: number }) {
  const [members, setMembers] = useState<{ user_id: string; nickname: string; avatar_url?: string | null }[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("cohort_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .order("joined_at", { ascending: false })
      .limit(12)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const ids = data.map((m) => m.user_id);
        supabase
          .from("community_profiles")
          .select("user_id, nickname, avatar_url")
          .in("user_id", ids)
          .then(({ data: profiles }) => {
            setMembers(profiles ?? []);
          });
      });
  }, [roomId]);

  return (
    <div className="rounded-2xl border border-[#F0EFED] bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[#1A1A1F]">멤버</h3>
        <span className="text-xs text-[#B5ADA3]">{memberCount}명</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {members.slice(0, 12).map((m, i) => {
          const grad = MEMBER_GRADIENTS[m.nickname.charCodeAt(0) % MEMBER_GRADIENTS.length];
          return (
            <div
              key={m.user_id}
              className="flex flex-col items-center gap-1 w-[56px]"
              title={m.nickname}
            >
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-medium shadow-sm`}>
                {m.nickname[0]}
              </div>
              <span className="text-[10px] text-[#878680] truncate w-full text-center">
                {m.nickname}
              </span>
            </div>
          );
        })}
        {memberCount > 12 && (
          <div className="flex flex-col items-center gap-1 w-[56px]">
            <div className="w-9 h-9 rounded-full bg-[#F0EFED] flex items-center justify-center text-[10px] text-[#878680] font-medium">
              +{memberCount - 12}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
