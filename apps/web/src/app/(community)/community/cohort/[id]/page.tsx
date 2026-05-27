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
  Link2,
  ExternalLink,
  FileText,
  Paperclip,
  Flag,
  X,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/community/Toast";
import { COHORT_THREAD_TOPICS, COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import { monthToQuarter } from "@/utils/quarter";
import type {
  CohortRoom,
  CohortMessage,
  CohortContract,
  CohortStat,
  CohortTimelineEvent,
  CohortThreadTopic,
  CohortContractCategory,
  CohortEventType,
  ReportReason,
} from "@/types/community.types";

// ────────────────────────────────────────
// 상수
// ────────────────────────────────────────
const TAB_KEYS = ["chat", "info", "events"] as const;
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
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const roomName = formatCohortRoomName(room);

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
    <div className="min-h-screen bg-[#f8f4f1]">
      <div className="flex w-full max-w-[1920px] mx-auto">
        {/* 왼쪽 사이드바 */}
        <aside className="hidden xl:flex flex-col w-72 2xl:w-80 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r border-[#eadfc9] bg-[#f8f4f1] pt-7 pb-5 px-5 z-40">
          {/* 방 정보 */}
          <div className="mb-5 px-2">
            <p className="mb-2 text-[11px] font-medium text-[#928980] uppercase tracking-widest">
              WEDDING HANBANG
            </p>
            <h2 className="font-serif-kr text-[28px] leading-tight text-[#071629] mb-1 break-words">
              {roomName}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-[#5d6879]">
              <Users className="h-3.5 w-3.5" />
              <span>{room?.member_count ?? 0}명 참여</span>
            </div>
          </div>

          {/* 멤버 */}
          <div className="px-1 mb-5">
            <CohortMemberPreview
              roomId={roomId}
              memberCount={room?.member_count ?? 0}
              onProfileOpen={setProfileUserId}
            />
          </div>

          {/* 주제별 카테고리 */}
          <div className="px-1 mb-5">
            <h3 className="px-2 text-[11px] font-medium uppercase tracking-wider text-[#928980] mb-2">주제별 보기</h3>
            <div className="flex flex-col gap-0.5">
              {COHORT_THREAD_TOPICS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#5d6879] hover:bg-white hover:text-[#9d6f36] transition-colors duration-200 text-left"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#9d6f36] opacity-70" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 동기방 규칙 */}
          <div className="px-1 mb-5 border-t border-[#eadfc9]/50 pt-4">
            <h3 className="px-2 text-[11px] font-medium uppercase tracking-wider text-[#928980] mb-2">규칙</h3>
            <div className="px-2 space-y-1.5 text-xs text-[#5d6879] leading-relaxed">
              <p>• 서로 존중하며 대화해주세요</p>
              <p>• 개인정보(실명, 연락처) 공유 주의</p>
              <p>• 광고/홍보성 글은 삭제됩니다</p>
              <p>• 업체 후기는 솔직하게 작성해주세요</p>
            </div>
          </div>

          <div className="mt-auto pt-4" />

          {/* 아모라 CTA */}
          <div className="mx-1 rounded-xl bg-gradient-to-br from-[#9d6f36] to-[#102a4d] p-4 text-white shadow-[0_4px_14px_0_rgba(6,26,52,0.2)]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[#dee6c4]" />
              <span className="font-serif-kr text-base">AI 아모라</span>
            </div>
            <p className="text-xs text-white/70 leading-relaxed mb-3">
              가격 비교·견적 분석·일정 상담
            </p>
            <a
              href="/chat"
              className="block w-full text-center bg-white text-[#9d6f36] rounded-lg py-2 text-sm font-medium hover:bg-[#fffdf7] transition-colors"
            >
              대화하기
            </a>
          </div>
        </aside>

        {/* 가운데: 메인 콘텐츠 */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* 모바일/태블릿용 방 이름 헤더 */}
          <div className="xl:hidden px-4 sm:px-6 pt-4 pb-2 bg-[#f8f4f1]">
            <h2 className="font-serif-kr text-xl sm:text-2xl text-[#071629] mb-1 break-words">
              {roomName}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-[#5d6879]">
              <Users className="h-3.5 w-3.5" />
              <span>{room?.member_count ?? 0}명 참여</span>
            </div>
            <div className="mt-3 rounded-xl bg-white/70 p-3 shadow-[0_4px_18px_rgb(0,0,0,0.03)]">
              <CohortMemberPreview
                roomId={roomId}
                memberCount={room?.member_count ?? 0}
                onProfileOpen={setProfileUserId}
                compact
              />
            </div>
          </div>

          {/* 탭 헤더 */}
          <div className="sticky top-16 z-10 bg-white border-b border-[#eadfc9]">
            <div className="flex px-4 sm:px-5 xl:px-6 2xl:px-8 max-w-[1120px] mx-auto w-full">
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
                active={tab === "events"}
                onClick={() => setTab("events")}
                icon={<Calendar className="h-4 w-4" />}
                label="이벤트"
              />
            </div>
          </div>

          <div className="px-4 sm:px-5 xl:px-6 2xl:px-8 py-5 sm:py-6 flex-1">
            <div className="max-w-[1120px] mx-auto">
              {tab === "chat" && (
                <ChatTab
                  roomId={roomId}
                  toastError={toast.error}
                  onProfileOpen={setProfileUserId}
                />
              )}
              {tab === "info" && <InfoTab roomId={roomId} toastFn={toast} />}
              {tab === "events" && <EventsTab roomId={roomId} toastFn={toast} />}
            </div>
          </div>
        </main>

        {/* 오른쪽 사이드바 — 커뮤니티 메인과 동일 폭 */}
        <aside className="hidden 2xl:flex flex-col w-72 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-l border-[#eadfc9] p-6 bg-[#f8f4f1]">
          <CohortPopularPosts roomId={roomId} />
        </aside>
      </div>
      <CohortProfileModal
        roomId={roomId}
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        toastFn={toast}
      />
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
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3.5 text-sm font-medium tracking-wide transition-colors ${
        active
          ? "border-[#9d6f36] text-[#9d6f36]"
          : "border-transparent text-[#5d6879] hover:text-[#9d6f36]"
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
  onProfileOpen,
}: {
  roomId: string;
  toastError: (msg: string) => void;
  onProfileOpen: (userId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<CohortMessage[]>([]);
  const [filter, setFilter] = useState<CohortThreadTopic | "all">("all");
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<CohortThreadTopic | "">("");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  // 사용자가 직접 위로 스크롤한 상태인지 — 위에 올라가 있으면 새 메시지 들어와도 자동 스크롤 안 함
  const isNearBottomRef = useRef(true);
  // 최초 메시지 로드 직후 1회만 즉시 바닥으로 (페이지 스크롤은 절대 건드리지 않음)
  const hasInitialScrolledRef = useRef(false);

  // 멘션 관련
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [members, setMembers] = useState<{ user_id: string; nickname: string }[]>([]);
  const [cursorPos, setCursorPos] = useState(0);

  function insertPostTag(post: { id: string; title: string }) {
    const tag = `[post:${post.id}|${post.title}]`;
    setInput((prev) => prev + (prev ? " " : "") + tag + " ");
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toastError("이미지는 10MB 이하여야 합니다");
      return;
    }

    setUploading(true);
    try {
      const fileName = `${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage
        .from("community-images")
        .upload(`cohort/${fileName}`, file);

      if (error || !data) {
        toastError("이미지 업로드 실패");
        return;
      }

      const { data: urlData } = supabase.storage
        .from("community-images")
        .getPublicUrl(data.path);

      setInput((prev) => prev + (prev ? " " : "") + `[img:${urlData.publicUrl}] `);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // 동기방 멤버 로드 (멘션용)
  useEffect(() => {
    (async () => {
      const { data: memberRows } = await supabase
        .from("cohort_members")
        .select("user_id")
        .eq("room_id", roomId)
        .eq("is_active", true);
      if (!memberRows) return;
      const ids = memberRows.map((m) => m.user_id);
      if (ids.length === 0) return;
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname")
        .in("user_id", ids);
      setMembers((profiles ?? []) as { user_id: string; nickname: string }[]);
    })();
  }, [roomId, supabase]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);
    const pos = e.target.selectionStart ?? value.length;
    setCursorPos(pos);

    const textBefore = value.slice(0, pos);
    const mentionMatch = textBefore.match(/@(\S*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  }

  function selectMention(member: { user_id: string; nickname: string }) {
    const textBefore = input.slice(0, cursorPos);
    const textAfter = input.slice(cursorPos);
    const newTextBefore = textBefore.replace(
      /@\S*$/,
      `@[${member.nickname}|${member.user_id}] `
    );
    setInput(newTextBefore + textAfter);
    setMentionOpen(false);
  }

  const filteredMembers = members.filter(
    (m) =>
      !mentionQuery ||
      m.nickname.toLowerCase().includes(mentionQuery.toLowerCase())
  );

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

  // 컨테이너 내부 스크롤 위치 추적 — 바닥 근처 여부 캐시
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 120;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // 자동 스크롤 — 페이지 전체는 절대 건드리지 않음.
  // 이전 사고: bottomRef.scrollIntoView({behavior:"smooth"}) 가 컨테이너+페이지
  // 양쪽을 모두 끌어내려서 첫 진입 시 페이지가 가장 하단에 도착해 있는 문제 발생.
  // (이슈 #7) 해결: 컨테이너 el.scrollTop 만 직접 조작 → 페이지 영향 없음.
  //   1) 첫 로드 1회 — 즉시 바닥
  //   2) 이후 새 메시지 — 사용자가 바닥 근처일 때만 스무스 스크롤
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || messages.length === 0) return;

    if (!hasInitialScrolledRef.current) {
      hasInitialScrolledRef.current = true;
      el.scrollTop = el.scrollHeight; // 즉시
      return;
    }

    if (isNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
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
    <div className="flex h-[calc(100vh-180px)] sm:h-[calc(100vh-160px)] flex-col">
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
      <div
        ref={messagesContainerRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-xl bg-white p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#5d6879]">
            아직 메시지가 없어요. 첫 메시지를 남겨보세요.
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onProfileOpen={onProfileOpen}
            />
          ))
        )}
      </div>

      {/* 입력 */}
      <div className="mt-3 rounded-xl bg-white p-3 sm:p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="mb-2.5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <button
            type="button"
            onClick={() => setThread("")}
            className={`whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
              thread === ""
                ? "bg-[#9d6f36] text-white"
                : "bg-[#fff8ec] text-[#5d6879] hover:bg-[#eadfc9]"
            }`}
          >
            주제 없음
          </button>
          {COHORT_THREAD_TOPICS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setThread(thread === t.key ? "" : (t.key as CohortThreadTopic))}
              className={`whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                thread === t.key
                  ? "bg-[#9d6f36] text-white"
                  : "bg-[#fff8ec] text-[#5d6879] hover:bg-[#eadfc9]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0 w-full">
            {mentionOpen && filteredMembers.length > 0 && (
              <div className="absolute bottom-full mb-2 left-0 w-60 max-h-60 overflow-y-auto bg-white rounded-xl shadow-lg border border-[#eadfc9] z-20">
                {filteredMembers.slice(0, 5).map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => selectMention(m)}
                    className="w-full text-left px-3 py-2 hover:bg-[#fff8ec] flex items-center gap-2 text-sm"
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#9d6f36] to-[#102a4d] flex items-center justify-center text-white text-[10px]">
                      {m.nickname[0]}
                    </div>
                    <span className="text-[#071629]">{m.nickname}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="메시지 입력... (@멘션 가능)"
              rows={2}
              className="w-full resize-none rounded-xl bg-[#fff8ec] px-3 py-2.5 text-[0.9375rem] sm:text-sm text-[#071629] outline-none focus:ring-2 focus:ring-[#9d6f36]/30 placeholder:text-[#B5ADA3]"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
          {/* 액션 버튼 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 sm:flex-none flex items-center justify-center rounded-xl bg-[#fff8ec] hover:bg-[#eadfc9] py-2.5 sm:py-0 px-3 text-[#5d6879] transition-colors disabled:opacity-50"
              title="이미지 첨부"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex-1 sm:flex-none flex items-center gap-1.5 justify-center rounded-xl bg-[#fff8ec] hover:bg-[#eadfc9] py-2.5 sm:py-0 px-3 text-[#5d6879] text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
              title="커뮤니티 글 공유"
            >
              <Link2 className="h-4 w-4" />
              <span>글 공유</span>
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9d6f36] to-[#102a4d] py-2.5 sm:py-0 px-4 text-white shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span className="sm:hidden text-sm font-medium">전송</span>
            </button>
          </div>
        </div>
      </div>

      <PostPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={insertPostTag}
      />
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
      className={`whitespace-nowrap flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all ${
        active
          ? "bg-[#9d6f36] text-white border-[#9d6f36]"
          : "bg-white text-[#5d6879] border-[#eadfc9] hover:bg-[#fff8ec]"
      }`}
    >
      {label}
    </button>
  );
}

function renderMessageContent(text: string): React.ReactNode {
  const regex = /(\[post:[a-f0-9-]+\|[^\]]+\]|\[img:[^\]]+\]|@\[[^|]+\|[a-f0-9-]+\])/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>
      );
    }

    const token = match[0];

    if (token.startsWith("[post:")) {
      const inner = token.slice(6, -1); // 제거 [post: 와 ]
      const sepIdx = inner.indexOf("|");
      const postId = inner.slice(0, sepIdx);
      const postTitle = inner.slice(sepIdx + 1);
      parts.push(
        <a
          key={`p${match.index}`}
          href={`/community/post/${postId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2.5 my-1 px-3.5 py-2.5 bg-white border border-[#eadfc9] rounded-lg hover:border-[#9d6f36]/40 hover:bg-[#fff8ec] transition-colors group max-w-full"
        >
          <FileText className="w-4 h-4 text-[#9d6f36] shrink-0" />
          <span className="flex flex-col min-w-0">
            <span className="text-[11px] text-[#5d6879] uppercase tracking-widest font-medium">커뮤니티 글</span>
            <span className="font-serif-kr text-base text-[#071629] group-hover:text-[#9d6f36] line-clamp-1">
              {postTitle}
            </span>
          </span>
          <ExternalLink className="w-3.5 h-3.5 text-[#B5ADA3] group-hover:text-[#9d6f36] shrink-0 ml-1" />
        </a>
      );
    } else if (token.startsWith("[img:")) {
      const url = token.slice(5, -1);
      parts.push(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`i${match.index}`}
          src={url}
          alt=""
          className="my-1 max-h-80 rounded-lg"
        />
      );
    } else if (token.startsWith("@[")) {
      const inner = token.slice(2, -1); // 제거 @[ 와 ]
      const sepIdx = inner.indexOf("|");
      const nickname = inner.slice(0, sepIdx);
      parts.push(
        <span
          key={`m${match.index}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#9d6f36]/10 text-[#9d6f36] font-medium"
        >
          @{nickname}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts.length > 0 ? parts : text;
}

function formatCohortRoomName(room: CohortRoom | null): string {
  if (!room) return "동기방";
  const quarter = monthToQuarter(room.month);
  const roomSuffix = room.room_number > 1 ? ` ${room.room_number}방` : "";
  return `${room.year}년 ${quarter}분기 결혼 동기${roomSuffix}`;
}

function rankIcon(rank?: string | null) {
  const icons: Record<string, string> = {
    sprout: "새싹",
    preparing: "체크",
    expert: "별",
    master: "왕관",
    senior: "하트",
  };
  return rank ? icons[rank] ?? "배지" : null;
}

function MessageBubble({
  message,
  onProfileOpen,
}: {
  message: CohortMessage;
  onProfileOpen: (userId: string) => void;
}) {
  const nickname = message.author?.nickname ?? "익명";
  const initial = nickname[0] ?? "?";
  const rank = rankIcon(message.author?.rank);
  const profileUserId = message.author?.user_id ?? message.author_id;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onProfileOpen(profileUserId)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-xs font-medium text-white ring-offset-2 transition hover:ring-2 hover:ring-[#9d6f36]/30 focus:outline-none focus:ring-2 focus:ring-[#9d6f36]/40"
        title={`${nickname} 프로필 보기`}
      >
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
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onProfileOpen(profileUserId)}
            className="text-sm font-medium text-[#071629] transition hover:text-[#9d6f36] focus:outline-none focus:text-[#9d6f36]"
          >
            {nickname}
          </button>
          {rank && (
            <span className="rounded-full bg-[#fff8ec] px-1.5 py-0.5 text-[10px] text-[#9d6f36]" title={message.author?.rank}>
              {rank}
            </span>
          )}
          <span className="text-xs text-[#928980]">
            {relativeTime(message.created_at)}
          </span>
          {message.thread_topic && (
            <span className="rounded-full bg-[#9d6f36]/10 px-2 py-0.5 text-[11px] text-[#9d6f36]">
              {COHORT_THREAD_TOPICS.find((t) => t.key === message.thread_topic)
                ?.label ?? message.thread_topic}
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-[#071629] leading-relaxed">
          {renderMessageContent(message.content)}
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// 글 공유 모달 (커뮤니티 글 선택)
// ────────────────────────────────────────
type PostPickerItem = {
  id: string;
  title: string;
  category?: string;
  comment_count?: number;
};

function PostPickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (post: { id: string; title: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<PostPickerItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const url = query
        ? `/api/community/search?q=${encodeURIComponent(query)}&limit=20`
        : `/api/community/posts?sort=hot&limit=20`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : { posts: [] }))
        .then((d) => setPosts(d.posts ?? []))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#eadfc9]">
          <h3 className="font-serif-kr text-2xl text-[#071629] mb-4">글 공유하기</h3>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목으로 검색하거나 인기글에서 선택"
            className="w-full px-4 py-3 bg-[#fff8ec] rounded-xl text-base outline-none focus:ring-2 focus:ring-[#9d6f36]/30"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-[#5d6879] py-8">불러오는 중...</div>
          ) : posts.length === 0 ? (
            <div className="text-center text-[#5d6879] py-8">결과가 없어요</div>
          ) : (
            <div className="space-y-2">
              {posts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelect({ id: p.id, title: p.title });
                    onClose();
                  }}
                  className="w-full text-left p-4 rounded-xl hover:bg-[#fff8ec] transition-colors group"
                >
                  <div className="font-serif-kr text-lg text-[#071629] group-hover:text-[#9d6f36] line-clamp-1">
                    {p.title}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-[#5d6879]">
                    {p.category && <span>{p.category}</span>}
                    {p.category && <span>·</span>}
                    <span>💬 {p.comment_count ?? 0}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
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
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9d6f36] to-[#102a4d] px-4 py-3 text-sm font-medium text-white shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all"
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
              className="rounded-xl bg-white p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
            >
              <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-serif-kr text-xl sm:text-2xl text-[#071629]">
                  {cat.label}
                </h3>
                <span className="text-xs sm:text-sm text-[#928980]">
                  {sample}명 등록
                </span>
              </div>
              {enough && stat ? (
                <div>
                  <p className="text-xs sm:text-sm text-[#5d6879]">
                    우리 동기 평균 {cat.label} 기본금
                  </p>
                  <p className="mt-1.5 font-serif-kr text-2xl sm:text-3xl font-light text-[#071629] break-words">
                    {stat.avg_base_price.toLocaleString()}만원
                    <span className="ml-2 text-xs sm:text-sm font-sans text-[#928980] font-normal">
                      ({sample}명)
                    </span>
                  </p>
                  {stat.avg_extra_price > 0 && (
                    <p className="mt-1.5 text-xs sm:text-sm text-[#5d6879]">
                      추가금 평균 {stat.avg_extra_price.toLocaleString()}만원
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-2 flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-[#C9A96E] shrink-0 mt-0.5" />
                    <p className="text-xs sm:text-sm text-[#5d6879] leading-relaxed">
                      아직 우리 동기 데이터가 부족해요. 등록하면 우리끼리의 평균이 나와요.
                    </p>
                  </div>
                  {NATIONAL_AVG[cat.key as CohortContractCategory] > 0 && (
                    <p className="text-xs sm:text-sm text-[#5d6879]">
                      전국 평균:{" "}
                      <span className="font-medium text-[#071629]">
                        {NATIONAL_AVG[
                          cat.key as CohortContractCategory
                        ].toLocaleString()}
                        만원
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {contracts.length > 0 && (
        <div className="mt-4 text-xs text-[#928980] text-center">
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
            className="flex-1 rounded-xl bg-[#9d6f36] px-4 py-2.5 text-sm text-white transition-colors hover:bg-[#102a4d] disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// 이벤트 탭
// ────────────────────────────────────────
function EventsTab({
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
        toastFn.error(data.error ?? "이벤트 로드 실패");
      }
    })();
  }, [roomId, toastFn]);

  if (events.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-sm text-[#5d6879] shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        아직 이벤트가 없어요.
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
            className="flex items-start gap-3 rounded-xl bg-white p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-xs font-medium text-white">
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
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#071629] leading-relaxed">
                예신{nickname}가{" "}
                <span className="font-medium text-[#9d6f36]">{label}</span>{" "}
                완료!
              </p>
              {ev.description && (
                <p className="mt-1 text-xs sm:text-sm text-[#5d6879]">{ev.description}</p>
              )}
              <p className="mt-1.5 text-xs text-[#928980]">
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
// 동기방 멤버 공개 프로필
// ────────────────────────────────────────
type CohortPublicProfilePayload = {
  profile: {
    user_id: string;
    nickname: string;
    avatar_url: string | null;
    rank: string | null;
    wedding_year: number | null;
    wedding_month: number | null;
    wedding_completed: boolean;
    post_count: number;
    comment_count: number;
    total_upvotes_received: number;
    created_at: string;
  };
  posts: Array<{
    id: string;
    title: string;
    category: string;
    created_at: string;
    upvote_count: number;
    comment_count: number;
  }>;
};

const REPORT_REASON_OPTIONS: Array<{ value: ReportReason; label: string }> = [
  { value: "spam", label: "스팸/도배" },
  { value: "abuse", label: "비방/공격" },
  { value: "ad", label: "광고/홍보" },
  { value: "inappropriate", label: "부적절한 내용" },
  { value: "other", label: "기타" },
];

const POST_CATEGORY_LABEL: Record<string, string> = {
  is_normal: "정상인가요?",
  tour_review: "후기",
  tips_v2: "꿀팁",
  ama: "선배 Q&A",
  free: "자유",
};

function CohortProfileModal({
  roomId,
  userId,
  onClose,
  toastFn,
}: {
  roomId: string;
  userId: string | null;
  onClose: () => void;
  toastFn: ToastFnLike;
}) {
  const [payload, setPayload] = useState<CohortPublicProfilePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("abuse");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setPayload(null);
    setReportOpen(false);
    setDescription("");
    setLoading(true);

    fetch(`/api/community/profiles/${encodeURIComponent(userId)}?room_id=${encodeURIComponent(roomId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "프로필을 불러올 수 없습니다.");
        if (!cancelled) setPayload(data as CohortPublicProfilePayload);
      })
      .catch((err: Error) => {
        if (!cancelled) toastFn.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [roomId, userId, toastFn]);

  async function submitReport() {
    if (!userId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/community/cohort/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, description }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toastFn.error(data.error ?? "신고 접수에 실패했습니다.");
        return;
      }
      toastFn.success(
        data.reviewRequired
          ? "신고가 접수됐고 관리자 검토 기준에 도달했어요."
          : "신고가 접수됐어요. 5명 이상 신고 시 관리자 검토 목록에 올라갑니다."
      );
      setReportOpen(false);
      setDescription("");
    } catch {
      toastFn.error("네트워크 오류로 신고하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!userId) return null;

  const profile = payload?.profile;
  const nickname = profile?.nickname ?? "멤버";
  const initial = nickname[0] ?? "?";
  const quarterLabel =
    profile?.wedding_year && profile?.wedding_month
      ? `${profile.wedding_year}년 ${monthToQuarter(profile.wedding_month)}분기`
      : "결혼 시기 미공개";
  const rank = rankIcon(profile?.rank);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#eadfc9] px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#928980]">
              공개 프로필
            </p>
            <h3 className="mt-1 font-serif-kr text-2xl text-[#071629]">
              {nickname}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[#928980] transition hover:bg-[#fff8ec] hover:text-[#071629]"
            title="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#5d6879]">
            <Loader2 className="h-5 w-5 animate-spin text-[#9d6f36]" />
            불러오는 중...
          </div>
        ) : profile ? (
          <div className="max-h-[75vh] overflow-y-auto p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-lg font-medium text-white">
                {profile.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  initial
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-serif-kr text-xl text-[#071629]">{nickname}</p>
                  {rank && (
                    <span className="rounded-full bg-[#fff8ec] px-2 py-1 text-xs text-[#9d6f36]">
                      {rank}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-[#5d6879]">{quarterLabel} 동기</p>
                <p className="mt-1 text-xs text-[#928980]">
                  공개 글과 커뮤니티 활동만 보여요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen((v) => !v)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#eadfc9] px-4 py-2 text-sm font-medium text-[#5d6879] transition hover:border-red-300 hover:text-red-600"
              >
                <Flag className="h-4 w-4" />
                신고
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                { label: "공개 글", value: profile.post_count },
                { label: "댓글", value: profile.comment_count },
                { label: "받은 추천", value: profile.total_upvotes_received },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-[#fff8ec] px-3 py-3 text-center">
                  <p className="font-serif-kr text-xl text-[#071629]">{item.value ?? 0}</p>
                  <p className="mt-1 text-xs text-[#928980]">{item.label}</p>
                </div>
              ))}
            </div>

            {reportOpen && (
              <div className="mt-5 rounded-xl border border-red-100 bg-red-50/40 p-4">
                <p className="text-sm font-medium text-[#071629]">이 멤버 신고하기</p>
                <p className="mt-1 text-xs text-[#5d6879]">
                  같은 동기방 멤버의 신고가 5건 이상 모이면 관리자 검토 대상이 됩니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {REPORT_REASON_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setReason(option.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        reason === option.value
                          ? "bg-red-600 text-white"
                          : "bg-white text-[#5d6879] hover:text-red-600"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="상황을 간단히 적어주세요. 실명·연락처는 쓰지 마세요."
                  rows={3}
                  className="mt-3 w-full resize-none rounded-xl border border-red-100 bg-white px-3 py-2 text-sm text-[#071629] outline-none focus:ring-2 focus:ring-red-200"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="rounded-xl border border-[#eadfc9] px-4 py-2 text-sm text-[#5d6879]"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={submitReport}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    신고 접수
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="font-serif-kr text-lg text-[#071629]">최근 공개 글</h4>
                <span className="text-xs text-[#928980]">
                  공개 글만 표시
                </span>
              </div>
              {payload.posts.length === 0 ? (
                <div className="rounded-xl bg-[#fff8ec] p-5 text-center text-sm text-[#5d6879]">
                  아직 공개 글이 없어요.
                </div>
              ) : (
                <div className="space-y-2">
                  {payload.posts.map((post) => (
                    <a
                      key={post.id}
                      href={`/community/post/${post.id}`}
                      className="block rounded-xl border border-[#eadfc9] p-4 transition hover:border-[#9d6f36] hover:bg-[#fffdf7]"
                    >
                      <div className="flex items-center gap-2 text-xs text-[#928980]">
                        <span className="rounded-full bg-[#fff8ec] px-2 py-0.5 text-[#9d6f36]">
                          {POST_CATEGORY_LABEL[post.category] ?? post.category}
                        </span>
                        <span>{relativeTime(post.created_at)}</span>
                      </div>
                      <p className="mt-2 line-clamp-1 font-serif-kr text-lg text-[#071629]">
                        {post.title}
                      </p>
                      <p className="mt-1 text-xs text-[#5d6879]">
                        추천 {post.upvote_count ?? 0} · 댓글 {post.comment_count ?? 0}
                      </p>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-[#5d6879]">
            프로필을 불러오지 못했어요.
          </div>
        )}
      </div>
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
    <div>
      <h3 className="font-serif-kr text-xl text-[#071629] mb-4 border-b border-[#eadfc9] pb-2">
        🔥 인기글
      </h3>
      {posts.length === 0 ? (
        <p className="text-sm text-[#5d6879] py-2">아직 인기글이 없어요</p>
      ) : (
        <ul className="space-y-3.5">
          {posts.slice(0, 5).map((p, i) => (
            <li key={p.id} className="group cursor-pointer">
              <a href={`/community/post/${p.id}`} className="flex items-start space-x-2.5">
                <span className={`font-serif-kr italic text-xl leading-none mt-0.5 shrink-0 text-[#9d6f36] ${
                  i === 0 ? "" : i === 1 ? "opacity-70" : i === 2 ? "opacity-50" : "opacity-30"
                }`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm text-[#071629] group-hover:text-[#9d6f36] transition-colors line-clamp-2 leading-snug">
                    {p.title}
                  </h4>
                  <p className="text-xs text-[#928980] mt-1">
                    ▲ {p.upvote_count} &middot; 💬 {p.comment_count}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
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

function CohortMemberPreview({
  roomId,
  memberCount,
  onProfileOpen,
  compact = false,
}: {
  roomId: string;
  memberCount: number;
  onProfileOpen: (userId: string) => void;
  compact?: boolean;
}) {
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
    <div>
      <div className="flex items-center justify-between mb-2.5 px-2">
        <h3 className="text-[11px] font-medium text-[#928980] uppercase tracking-wider">멤버</h3>
        <span className="text-xs text-[#5d6879]">{memberCount}명</span>
      </div>
      <div className={`flex gap-2 px-1 ${compact ? "overflow-x-auto pb-1" : "flex-wrap"}`}>
        {members.slice(0, 8).map((m) => {
          const grad = MEMBER_GRADIENTS[m.nickname.charCodeAt(0) % MEMBER_GRADIENTS.length];
          return (
            <button
              key={m.user_id}
              type="button"
              onClick={() => onProfileOpen(m.user_id)}
              className={`${compact ? "w-14 flex-shrink-0" : "w-16"} flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#9d6f36]/25`}
              title={m.nickname}
            >
              <div className={`h-11 w-11 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-sm font-medium shadow-sm`}>
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.avatar_url}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  m.nickname[0]
                )}
              </div>
              <span className="w-full truncate text-center text-[11px] text-[#5d6879]">
                {m.nickname}
              </span>
            </button>
          );
        })}
        {memberCount > 8 && (
          <div className={`${compact ? "w-14 flex-shrink-0" : "w-16"} flex flex-col items-center gap-1 px-1 py-1.5`}>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#fff8ec] text-xs font-medium text-[#5d6879]">
              +{memberCount - 8}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
