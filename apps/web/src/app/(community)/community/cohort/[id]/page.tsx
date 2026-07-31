"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  TrendingUp,
  Calendar,
  Send,
  Plus,
  Sparkles,
  Link2,
  ExternalLink,
  FileText,
  Paperclip,
  ShieldCheck,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/community/Toast";
import { COHORT_THREAD_TOPICS, COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { resolveCohortThreadTopic } from "@/lib/community/cohortTopicClassifier";
import { communityPostPath } from "@/lib/community/routes";
import { uploadCommunityMedia } from "@/lib/community/uploadMedia";
import { weddingPath } from "@/lib/weddingPaths";
import {
  cohortRoomName,
  FLEX_COHORT_LABEL,
  FLEX_COHORT_SHORT_LABEL,
  isFlexibleCohort,
} from "@/utils/quarter";
import type {
  CohortRoom,
  CohortMessage,
  CohortProfileSummary,
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
type TabKey = "chat" | "info" | "timeline";
type FocusMessageRequest = { id: string; requestedAt: number };
const DIGEST_SUBTOPIC_INITIAL_LIMIT = 3;

const EVENT_LABEL: Record<CohortEventType, string> = {
  venue_booked: "결혼식장 예약",
  studio_booked: "웨딩 사진 촬영 예약",
  dress_booked: "드레스 예약",
  makeup_booked: "메이크업 예약",
  tour_done: "업체 상담 완료",
  contract_done: "계약 완료",
  invitation_sent: "초대장 전달 시작",
  progress_update: "준비 업데이트",
  wedding_done: "결혼식 완료",
};

const EVENT_ITEMS: Array<{ key: CohortEventType; label: string; helper: string }> = [
  { key: "contract_done", label: "계약 완료", helper: "견적 확정이나 계약을 마쳤어요" },
  { key: "tour_done", label: "업체 상담 완료", helper: "결혼식장이나 사진·드레스·메이크업 상담을 다녀왔어요" },
  { key: "venue_booked", label: "결혼식장 예약", helper: "결혼식장과 날짜를 확정했어요" },
  { key: "studio_booked", label: "웨딩 사진 촬영 예약", helper: "촬영 일정을 잡았어요" },
  { key: "dress_booked", label: "드레스 예약", helper: "매장 방문·드레스 선택·수선 일정을 잡았어요" },
  { key: "makeup_booked", label: "헤어·메이크업 예약", helper: "두 사람이나 부모님의 헤어·메이크업을 예약했어요" },
  { key: "invitation_sent", label: "초대장 전달 시작", helper: "종이·모바일 초대장 전달을 시작했어요" },
  { key: "progress_update", label: "준비 업데이트", helper: "체크리스트나 준비 상황을 남겨요" },
  { key: "wedding_done", label: "결혼식 완료", helper: "결혼식을 마쳤어요" },
];

const THREAD_LABEL: Record<CohortThreadTopic, string> = {
  price: "가격",
  review: "후기",
  concern: "고민",
  chat: "수다",
};

const THREAD_HELPER: Record<CohortThreadTopic, string> = {
  price: "견적·계약금·추가금·식대",
  review: "투어·상담·계약 경험",
  concern: "결정 전 질문·선택 고민",
  chat: "가벼운 안부와 잡담",
};

const CONTRACT_LABEL: Record<CohortContractCategory, string> = {
  venue: PLANNING_CATEGORY_LABELS.venue,
  studio: PLANNING_CATEGORY_LABELS.studio,
  dress: PLANNING_CATEGORY_LABELS.dress,
  makeup: PLANNING_CATEGORY_LABELS.makeup,
  snap: PLANNING_CATEGORY_LABELS.snap,
  ring: PLANNING_CATEGORY_LABELS.ring,
  honeymoon: PLANNING_CATEGORY_LABELS.honeymoon,
  other: "기타",
};

const THREAD_ITEMS = COHORT_THREAD_TOPICS.map((topic) => ({
  key: topic.key as CohortThreadTopic,
  label: THREAD_LABEL[topic.key as CohortThreadTopic],
  helper: THREAD_HELPER[topic.key as CohortThreadTopic],
}));

const CONTRACT_ITEMS = COHORT_CONTRACT_CATEGORIES.map((category) => ({
  key: category.key as CohortContractCategory,
  label: CONTRACT_LABEL[category.key as CohortContractCategory],
}));

function getRoomPeriod(room: CohortRoom | null): string {
  if (!room?.year || !room?.month) return "같은 시기";
  if (isFlexibleCohort(room.year, room.month)) return FLEX_COHORT_SHORT_LABEL;
  const quarter = Math.ceil(room.month / 3);
  return `${room.year}년 ${quarter}분기`;
}

function getRoomTitle(room: CohortRoom | null): string {
  if (!room) return "나의 결혼 동기방";
  if (isFlexibleCohort(room.year, room.month)) return FLEX_COHORT_LABEL;
  return cohortRoomName(room.year, room.month, room.room_number);
}

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
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [focusMessageRequest, setFocusMessageRequest] = useState<FocusMessageRequest | null>(null);

  // 초기 방 정보 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setIsSignedIn(Boolean(user));
      setAuthChecked(true);
      if (!user) return;

      const res = await fetch("/api/community/cohort");
      if (!res.ok) return;
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

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] px-4 text-sm font-medium text-[#928980]">
        <div className="rounded-full border border-[#e5d8ca] bg-white px-5 py-3 shadow-[0_10px_28px_rgba(50,36,17,0.06)]">
          <LoaderText />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <CohortLoginRequired roomId={roomId} />;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf8_0%,#fbf8f2_48%,#f6efe5_100%)] text-[#263832]">
      <div className="mx-auto w-[calc(100%_-_32px)] max-w-[1240px] py-5 sm:w-[calc(100%_-_48px)] sm:py-7">
        <RoomHeader room={room} />

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-5">
          <main className="min-w-0">
            <section className="overflow-hidden rounded-[22px] border border-[#e5d8ca] bg-white/88 shadow-[0_16px_38px_rgba(50,36,17,0.055)]">
              <div className="border-b border-[#e5d8ca] bg-white/70 px-3 py-3 sm:px-4">
                <div className="grid grid-cols-3 gap-2 rounded-full bg-[#f6efe5] p-1">
                  <TabButton
                    active={tab === "chat"}
                    onClick={() => setTab("chat")}
                    icon={<MessageCircle className="h-4 w-4" />}
                    label="대화"
                  />
                  <TabButton
                    active={tab === "info"}
                    onClick={() => setTab("info")}
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="등록 금액"
                  />
                  <TabButton
                    active={tab === "timeline"}
                    onClick={() => setTab("timeline")}
                    icon={<Calendar className="h-4 w-4" />}
                    label="준비 기록"
                  />
                </div>
              </div>

              <div className="p-3 sm:p-5 lg:p-6">
                {tab === "chat" && (
                  <ChatTab
                    roomId={roomId}
                    enabled={isSignedIn}
                    toastFn={toast}
                    focusMessageRequest={focusMessageRequest}
                  />
                )}
                {tab === "info" && <InfoTab roomId={roomId} enabled={isSignedIn} toastFn={toast} />}
                {tab === "timeline" && <TimelineTab roomId={roomId} enabled={isSignedIn} toastFn={toast} />}
              </div>
            </section>
          </main>

          <CohortSidePanel
            room={room}
            roomId={roomId}
            onTabChange={setTab}
            onFocusMessage={(id) => setFocusMessageRequest({ id, requestedAt: Date.now() })}
          />
        </div>
      </div>
    </div>
  );
}

function LoaderText() {
  return (
    <>
      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5d8ca] border-t-[#36534E] align-[-3px]" />
      동기방 입장 상태를 확인하고 있어요...
    </>
  );
}

function CohortLoginRequired({ roomId }: { roomId: string }) {
  const redirect = weddingPath(`/community/cohort/${roomId}`);
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf8_0%,#fbf8f2_48%,#f6efe5_100%)] px-4 py-10 sm:px-6">
      <section className="mx-auto grid max-w-[1080px] overflow-hidden rounded-[24px] border border-[#e5d8ca] bg-white shadow-[0_18px_48px_rgba(50,36,17,0.065)] md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative min-h-[280px] bg-[url('/images/amora-hero-bouquet-custom.webp')] bg-cover bg-[position:center_45%] md:order-2">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,253,248,0.04)_0%,rgba(255,253,248,0.78)_100%)] md:bg-[linear-gradient(90deg,rgba(255,253,248,0.72)_0%,rgba(255,253,248,0.05)_100%)]" />
        </div>
        <div className="p-6 sm:p-8 lg:p-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#EEF4F1] px-3 py-1.5 text-xs font-semibold text-[#36534E]">
            <LockKeyhole className="h-4 w-4" />
            로그인 필요
          </div>
          <h1 className="font-serif-kr text-[30px] font-medium leading-[1.25] text-[#263832] sm:text-[38px]">
            동기방은 로그인 후
            <br />
            입장할 수 있어요
          </h1>
          <p className="mt-4 text-[14px] font-medium leading-[1.8] text-[#635b51] sm:text-[15px]">
            같은 시기 예비부부의 가격, 후기, 계약 이야기가 오가는 공간이라 회원에게만 열어두고 있어요.
            로그인하면 내 예정일 기준 방으로 바로 연결됩니다.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link
              href={`/login?redirect=${encodeURIComponent(redirect)}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.18)] transition-colors hover:bg-[#2B423E]"
            >
              로그인하고 입장
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={weddingPath()}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#e5d8ca] bg-white px-5 text-sm font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/35"
            >
              커뮤니티로 돌아가기
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function RoomHeader({ room }: { room: CohortRoom | null }) {
  const period = getRoomPeriod(room);
  const stats = [
    { label: "참여 멤버", value: `${room?.member_count ?? 0}명` },
    { label: "누적 대화", value: `${room?.message_count ?? 0}개` },
    { label: "매칭 기준", value: period },
  ];

  return (
    <section className="rounded-[22px] border border-[#e5d8ca] bg-white/88 px-5 py-4 shadow-[0_12px_30px_rgba(50,36,17,0.045)] sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#36534E]">Cohort Lounge</p>
          <h1 className="truncate font-serif-kr text-[26px] font-medium leading-[1.25] text-[#263832] sm:text-[30px]">
            {getRoomTitle(room)}
          </h1>
          <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[#635b51]">
            같은 시기 예비부부와 실제 견적·고민·후기를 바로 나눠요.
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-3 overflow-hidden rounded-[16px] border border-[#e5d8ca] bg-[#fffdf8] lg:w-[520px]">
          {stats.map((stat, index) => (
            <div key={stat.label} className={`min-w-0 px-3 py-3 ${index > 0 ? "border-l border-[#e5d8ca]" : ""}`}>
              <div className="truncate text-[11px] font-semibold text-[#928980]">{stat.label}</div>
              <div className="mt-1 truncate text-[14px] font-bold text-[#263832]">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CohortSidePanel({
  room,
  roomId,
  onTabChange,
  onFocusMessage,
}: {
  room: CohortRoom | null;
  roomId: string;
  onTabChange: (tab: TabKey) => void;
  onFocusMessage: (messageId: string) => void;
}) {
  return (
    <aside className="grid gap-4 md:sticky md:top-20 md:max-h-[calc(100dvh-245px)] md:self-start md:overflow-y-auto md:pb-1 md:pr-1">
      <section className="rounded-[22px] border border-[#e5d8ca] bg-white/88 p-5 shadow-[0_12px_30px_rgba(50,36,17,0.045)]">
        <CohortDigestCard roomId={roomId} onTabChange={onTabChange} onFocusMessage={onFocusMessage} />
      </section>

      <section className="rounded-[22px] border border-[#e5d8ca] bg-white/88 p-5 shadow-[0_12px_30px_rgba(50,36,17,0.045)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif-kr text-[22px] font-medium text-[#263832]">오늘 이렇게 써보세요</h2>
          <span className="rounded-full bg-[#EEF4F1] px-3 py-1 text-[11px] font-semibold text-[#36534E]">
            {getRoomPeriod(room)}
          </span>
        </div>
        <div className="grid gap-2.5">
          {[
            { tab: "chat" as const, label: "견적 캡처 올리고 의견 받기", desc: "가격/계약 조건은 대화 탭에서 빠르게 물어보세요." },
            { tab: "info" as const, label: "익명 등록 금액 확인", desc: "5명 이상 등록된 항목만 산술 평균과 표본 수를 보여줘요." },
            { tab: "timeline" as const, label: "준비 기록 남기기", desc: "계약·투어·예약 완료를 남겨 동기들의 흐름을 같이 봐요." },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onTabChange(item.tab)}
              className="group rounded-[16px] border border-[#e5d8ca] bg-[#fffdf8] p-4 text-left transition-colors hover:border-[#36534E]/35 hover:bg-[#f6efe5]"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF4F1] text-[#36534E]">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-snug text-[#263832] group-hover:text-[#36534E]">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-[12px] font-medium leading-[1.55] text-[#635b51]">
                    {item.desc}
                  </span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[22px] border border-[#e5d8ca] bg-white/88 p-5 shadow-[0_12px_30px_rgba(50,36,17,0.045)]">
        <CohortMemberPreview roomId={roomId} memberCount={room?.member_count ?? 0} />
      </section>

      <section className="rounded-[22px] border border-[#e5d8ca] bg-white/88 p-5 shadow-[0_12px_30px_rgba(50,36,17,0.045)]">
        <CohortPopularPosts roomId={roomId} />
      </section>

      <section className="rounded-[22px] bg-[#36534E] p-5 text-white shadow-[0_16px_34px_rgba(54,83,78,0.2)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          <h2 className="font-serif-kr text-[21px] font-medium">동기방 약속</h2>
        </div>
        <ul className="mt-4 space-y-2 text-[12px] font-medium leading-[1.6] text-white/78">
          <li>실명, 연락처, 계좌번호는 공개하지 않기</li>
          <li>업체 후기는 직접 경험과 사실 중심으로 쓰기</li>
          <li>광고·홍보는 커뮤니티 정책에 맞게 표시하기</li>
        </ul>
        <Link
          href={weddingPath("/chat")}
          className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-[13px] font-semibold text-[#36534E]"
        >
          아모라에게 먼저 물어보기
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </aside>
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
      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold transition-colors sm:text-sm ${
        active
          ? "bg-[#36534E] text-white shadow-[0_8px_18px_rgba(54,83,78,0.14)]"
          : "text-[#635b51] hover:bg-white hover:text-[#36534E]"
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
  enabled,
  toastFn,
  focusMessageRequest,
}: {
  roomId: string;
  enabled: boolean;
  toastFn: ToastFnLike;
  focusMessageRequest: FocusMessageRequest | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<CohortMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CohortThreadTopic | "all">("all");
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<CohortThreadTopic | "">("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
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

    if (!enabled) {
      toastFn.error("로그인 후 동기방에 참여할 수 있어요.");
      return;
    }

    const maxSize = file.type === "image/gif" ? 6 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toastFn.error(file.type === "image/gif" ? "GIF는 6MB 이하로 올릴 수 있어요." : "이미지는 5MB 이하로 올릴 수 있어요.");
      return;
    }

    setUploading(true);
    try {
      const data = await uploadCommunityMedia(file);
      setInput((prev) => prev + (prev ? " " : "") + `[img:${data.url}] `);
    } catch (error) {
      toastFn.error(error instanceof Error ? error.message : "이미지 업로드에 실패했어요.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setCurrentUserId(null);
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setCurrentUserId(data.user?.id ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, supabase]);

  // 동기방 멤버 로드 (멘션용)
  useEffect(() => {
    if (!enabled) {
      setMembers([]);
      return;
    }
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
  }, [enabled, roomId, supabase]);

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
    if (!enabled) {
      setMessages([]);
      return;
    }
    const res = await fetch(`/api/community/cohort/${roomId}/messages`);
    const data = await res.json();
    if (res.ok) {
      setMessages(data.messages ?? []);
    }
  }, [enabled, roomId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Realtime 구독
  useEffect(() => {
    if (!enabled) return;
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
          // author 프로필 join해서 추가
          const { data: authorData } = await supabase
            .from("community_profiles")
            .select("user_id, nickname, avatar_url, rank")
            .eq("user_id", newMsg.author_id)
            .maybeSingle<CohortProfileSummary>();
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const hydratedMessage = {
              ...newMsg,
              author: authorData ?? undefined,
            };
            const tempIndex = prev.findIndex((message) => (
              message.id.startsWith("temp-") &&
              message.author_id === newMsg.author_id &&
              message.content === newMsg.content &&
              Math.abs(new Date(newMsg.created_at).getTime() - new Date(message.created_at).getTime()) < 30_000
            ));

            if (tempIndex >= 0) {
              return prev.map((message, index) => (
                index === tempIndex ? hydratedMessage : message
              ));
            }

            return [...prev, hydratedMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, supabase, roomId]);

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

  useEffect(() => {
    if (!focusMessageRequest || messages.length === 0) return;
    const container = messagesContainerRef.current;
    const target = document.getElementById(`cohort-message-${focusMessageRequest.id}`);
    if (!container || !target) return;

    setFilter("all");
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = container.scrollTop + targetRect.top - containerRect.top - 96;
    container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    setHighlightedMessageId(focusMessageRequest.id);

    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (
        current === focusMessageRequest.id ? null : current
      ));
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [focusMessageRequest, messages]);

  async function handleSend() {
    const draft = input.trim();
    if (!draft) return;
    if (!enabled) {
      toastFn.error("로그인 후 동기방에 참여할 수 있어요.");
      return;
    }

    const tempId = `temp-${typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }`;
    const optimisticMessage: CohortMessage = {
      id: tempId,
      room_id: roomId,
      author_id: currentUserId ?? "pending-user",
      content: draft.slice(0, 2000),
      thread_topic: resolveCohortThreadTopic(thread || undefined, draft),
      images: [],
      reply_to: null,
      is_deleted: false,
      created_at: new Date().toISOString(),
    };

    isNearBottomRef.current = true;
    setInput("");
    setMentionOpen(false);
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch(`/api/community/cohort/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft,
          thread_topic: thread || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: CohortMessage; error?: string };
      if (!res.ok) {
        setMessages((prev) => prev.filter((message) => message.id !== tempId));
        setInput((current) => (current.trim() ? current : draft));
        toastFn.error(data.error ?? "전송 실패");
        return;
      }
      if (data.message) {
        setMessages((prev) => {
          if (prev.some((message) => message.id === data.message?.id)) {
            return prev.filter((message) => message.id !== tempId);
          }

          let replaced = false;
          const next = prev.map((message) => {
            if (message.id !== tempId) return message;
            replaced = true;
            return data.message as CohortMessage;
          });

          return replaced ? next : [...prev, data.message as CohortMessage];
        });
      }
    } catch {
      setMessages((prev) => prev.filter((message) => message.id !== tempId));
      setInput((current) => (current.trim() ? current : draft));
      toastFn.error("네트워크 오류");
    }
  }

  async function handleReportMember(userId: string, nickname: string) {
    if (!enabled) {
      toastFn.error("로그인 후 신고할 수 있어요.");
      return;
    }

    const ok = window.confirm(`${nickname}님의 메시지를 신고할까요? 운영자가 동기방 맥락을 확인한 뒤 조치합니다.`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/community/cohort/${roomId}/members/${userId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "other" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; reviewRequired?: boolean };

      if (!res.ok) {
        toastFn.error(data.error ?? "신고 접수에 실패했어요.");
        return;
      }

      toastFn.success(
        data.reviewRequired
          ? "신고가 접수됐고 검토 필요 상태로 표시됐어요."
          : "신고가 접수됐어요."
      );
    } catch {
      toastFn.error("네트워크 오류");
    }
  }

  return (
    <div className="flex h-[calc(100dvh-245px)] min-h-[620px] max-h-[820px] flex-col">
      {/* 필터 pill */}
      <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="전체"
          helper="모든 대화를 함께 보기"
        />
        {THREAD_ITEMS.map((t) => (
          <FilterPill
            key={t.key}
            active={filter === t.key}
            onClick={() => setFilter(t.key)}
            label={t.label}
            helper={t.helper}
          />
        ))}
      </div>

      {/* 메시지 목록 */}
      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain rounded-[20px] border border-[#e5d8ca] bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] sm:p-5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full min-h-full items-center justify-center rounded-[18px] bg-[#fbf8f2] text-center text-sm font-medium leading-6 text-[#635b51]">
            아직 메시지가 없어요.
            <br />
            첫 질문이나 오늘의 준비 상황을 남겨보세요.
          </div>
        ) : (
          messages.map((m) => {
            const isMine = currentUserId !== null && m.author_id === currentUserId;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                selectedTopic={filter}
                isMine={isMine}
                highlighted={highlightedMessageId === m.id}
                onReport={isMine ? undefined : handleReportMember}
              />
            );
          })
        )}
      </div>

      {/* 입력 */}
      <div className="mt-4 shrink-0 rounded-[20px] border border-[#e5d8ca] bg-white p-3.5 sm:p-4">
        <div className="mb-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <button
            type="button"
            onClick={() => setThread("")}
            title="주제를 직접 고르지 않으면 메시지 내용으로 자동 분류돼요."
            className={`whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
              thread === ""
                ? "bg-[#36534E] text-white"
                : "bg-[#f6efe5] text-[#635b51] hover:bg-[#e5d8ca]"
            }`}
          >
            자동 분류
          </button>
          {THREAD_ITEMS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setThread(thread === t.key ? "" : (t.key as CohortThreadTopic))}
              title={`${t.label}: ${t.helper}`}
              className={`whitespace-nowrap flex-shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                thread === t.key
                  ? "bg-[#36534E] text-white"
                  : "bg-[#f6efe5] text-[#635b51] hover:bg-[#e5d8ca]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1 min-w-0 w-full">
            {mentionOpen && filteredMembers.length > 0 && (
              <div className="absolute bottom-full mb-2 left-0 w-60 max-h-60 overflow-y-auto bg-white rounded-xl shadow-lg border border-[#e5d8ca] z-20">
                {filteredMembers.slice(0, 5).map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => selectMention(m)}
                    className="w-full text-left px-3 py-2 hover:bg-[#f6efe5] flex items-center gap-2 text-sm"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#36534E] flex items-center justify-center text-white text-[10px]">
                      {m.nickname[0]}
                    </div>
                    <span className="text-[#263832]">{m.nickname}</span>
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
              rows={3}
              className="h-[82px] max-h-[82px] min-h-[82px] w-full resize-none overflow-y-auto rounded-[16px] border border-transparent bg-[#f6efe5] px-4 py-3.5 text-[0.9375rem] leading-relaxed text-[#263832] outline-none transition-colors [field-sizing:fixed] placeholder:text-[#B5ADA3] focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/20 sm:text-sm"
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
          <div className="flex gap-2 sm:min-h-[82px]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex flex-1 items-center justify-center rounded-[16px] bg-[#f6efe5] px-3 py-3 text-[#635b51] transition-colors hover:bg-[#e5d8ca] disabled:opacity-50 sm:flex-none sm:py-0"
              title="이미지 첨부"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[16px] bg-[#f6efe5] px-3 py-3 text-xs font-medium text-[#635b51] transition-colors hover:bg-[#e5d8ca] sm:flex-none sm:py-0 sm:text-sm"
              title="커뮤니티 글 공유"
            >
              <Link2 className="h-4 w-4" />
              <span>글 공유</span>
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-[16px] bg-[#36534E] px-4 py-3 text-white shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] transition-all hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] disabled:opacity-50 sm:flex-none sm:py-0"
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
  helper,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  helper?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={helper}
      aria-label={helper ? `${label}: ${helper}` : label}
      className={`group whitespace-nowrap flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all ${
        active
          ? "bg-[#36534E] text-white border-[#36534E]"
          : "bg-white text-[#635b51] border-[#e5d8ca] hover:bg-[#f6efe5]"
      }`}
    >
      <span>{label}</span>
      {helper && label !== "전체" && (
        <span className={`ml-1 hidden text-[11px] font-medium sm:inline ${
          active ? "text-white/78" : "text-[#928980] group-hover:text-[#635b51]"
        }`}>
          {helper}
        </span>
      )}
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
        <Link
          key={`p${match.index}`}
          href={communityPostPath(postId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2.5 my-1 px-3.5 py-2.5 bg-white border border-[#e5d8ca] rounded-lg hover:border-[#36534E]/40 hover:bg-[#f6efe5] transition-colors group max-w-full"
        >
          <FileText className="w-4 h-4 text-[#36534E] shrink-0" />
          <span className="flex flex-col min-w-0">
            <span className="text-[11px] text-[#635b51] uppercase tracking-widest font-medium">커뮤니티 글</span>
            <span className="font-serif-kr text-base text-[#263832] group-hover:text-[#36534E] line-clamp-1">
              {postTitle}
            </span>
          </span>
          <ExternalLink className="w-3.5 h-3.5 text-[#B5ADA3] group-hover:text-[#36534E] shrink-0 ml-1" />
        </Link>
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
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#36534E]/10 text-[#36534E] font-medium"
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

function MessageBubble({
  message,
  selectedTopic = "all",
  isMine = false,
  highlighted = false,
  onReport,
}: {
  message: CohortMessage;
  selectedTopic?: CohortThreadTopic | "all";
  isMine?: boolean;
  highlighted?: boolean;
  onReport?: (userId: string, nickname: string) => void;
}) {
  const nickname = message.author?.nickname ?? "익명";
  const initial = nickname[0] ?? "?";
  const displayTopic = resolveCohortThreadTopic(message.thread_topic, message.content);
  const isDimmed = selectedTopic !== "all" && displayTopic !== selectedTopic;
  return (
    <div
      id={`cohort-message-${message.id}`}
      className={`scroll-mt-24 rounded-[18px] p-1 transition-all duration-300 ${
        highlighted ? "bg-[#fff4d8] shadow-[0_0_0_2px_rgba(181,131,66,0.24)]" : "bg-transparent"
      }`}
    >
      <div
        className={`flex gap-3 transition-opacity duration-200 ${
        isMine ? "justify-end" : "justify-start"
      } ${
        isDimmed ? "opacity-40" : "opacity-100"
      }`}
      >
      {!isMine && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-xs font-medium text-white">
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
      )}
      <div className={`min-w-0 ${isMine ? "max-w-[86%] text-right sm:max-w-[76%]" : "flex-1"}`}>
        <div className={`flex items-center gap-1.5 flex-wrap ${isMine ? "justify-end" : "justify-start"}`}>
          {!isMine && <span className="text-sm font-medium text-[#263832]">{nickname}</span>}
          <span className="text-xs text-[#928980]">
            {relativeTime(message.created_at)}
          </span>
          {!isMine && onReport && (
            <button
              type="button"
              onClick={() => onReport(message.author_id, nickname)}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-[#928980] transition-colors hover:bg-[#f6efe5] hover:text-[#36534E]"
              title="이 멤버 신고"
            >
              신고
            </button>
          )}
        </div>
        <div
          className={`mt-1 inline-block max-w-full whitespace-pre-wrap rounded-[16px] px-3.5 py-2.5 text-left text-sm leading-relaxed ${
            isMine
              ? "bg-[#EEF4F1] text-[#263832]"
              : "bg-[#fbf8f2] text-[#263832]"
          }`}
        >
          {renderMessageContent(message.content)}
        </div>
      </div>
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
        <div className="p-6 border-b border-[#e5d8ca]">
          <h3 className="font-serif-kr text-2xl text-[#263832] mb-4">글 공유하기</h3>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목으로 검색하거나 인기글에서 선택"
            className="w-full px-4 py-3 bg-[#f6efe5] rounded-xl text-base outline-none focus:ring-2 focus:ring-[#36534E]/30"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-[#635b51] py-8">불러오는 중...</div>
          ) : posts.length === 0 ? (
            <div className="text-center text-[#635b51] py-8">결과가 없어요</div>
          ) : (
            <div className="space-y-2">
              {posts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelect({ id: p.id, title: p.title });
                    onClose();
                  }}
                  className="w-full text-left p-4 rounded-xl hover:bg-[#f6efe5] transition-colors group"
                >
                  <div className="font-serif-kr text-lg text-[#263832] group-hover:text-[#36534E] line-clamp-1">
                    {p.title}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-[#635b51]">
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
  enabled,
  toastFn,
}: {
  roomId: string;
  enabled: boolean;
  toastFn: ToastFnLike;
}) {
  const [stats, setStats] = useState<CohortStat[]>([]);
  const [contracts, setContracts] = useState<CohortContract[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setStats([]);
      setContracts([]);
      return;
    }
    const res = await fetch(`/api/community/cohort/${roomId}/contracts`);
    const data = await res.json();
    if (res.ok) {
      setStats(data.stats ?? []);
      setContracts(data.contracts ?? []);
    }
  }, [enabled, roomId]);

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
      <div className="mb-4 rounded-[18px] border border-[#e5d8ca] bg-[#fffdf8] p-4 sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 className="font-serif-kr text-[22px] font-medium text-[#263832]">동기방 익명 등록 금액</h2>
          <p className="mt-1 text-[13px] font-medium leading-6 text-[#635b51]">
            견적서나 계약서의 기본금·추가금·조건을 만원 단위로 등록하면,
            업체명은 숨기고 5명 이상 쌓인 항목의 산술 평균과 표본 수만 보여줘요. 시장 전체의 시세는 아니에요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!enabled) {
              toastFn.error("로그인 후 계약 정보를 등록할 수 있어요.");
              return;
            }
            setModalOpen(true);
          }}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.18)] transition-colors hover:bg-[#2B423E] sm:mt-0 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          내 견적/계약 등록
        </button>
      </div>

      <div className="mb-4 grid gap-2.5 md:grid-cols-3">
        {[
          { step: "1", title: "업체·분야 선택", desc: "결혼식장, 사진 촬영, 드레스처럼 비교할 항목을 골라요." },
          { step: "2", title: "기본금·추가금 입력", desc: "계약금이 아니라 총 견적 기준으로 만원 단위만 적어요." },
          { step: "3", title: "5명 이상이면 등록 평균 공개", desc: "개별 견적이 드러나지 않도록 표본 수와 산술 평균만 보여요." },
        ].map((item) => (
          <div key={item.step} className="rounded-[16px] border border-[#e5d8ca] bg-white px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF4F1] text-[12px] font-bold text-[#36534E]">
                {item.step}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#263832]">{item.title}</p>
                <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#635b51]">{item.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 카테고리별 카드 */}
      <div className="grid gap-3 md:grid-cols-2">
        {CONTRACT_ITEMS.map((cat) => {
          const stat = statByCat[cat.key];
          const sample = stat?.sample_size ?? 0;
          const enough = sample >= 5;
          return (
            <div
              key={cat.key}
              className="rounded-[18px] border border-[#e5d8ca] bg-white p-4 transition-colors hover:border-[#36534E]/30 sm:p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-serif-kr text-xl font-medium text-[#263832] sm:text-2xl">
                  {cat.label}
                </h3>
                <span className="rounded-full bg-[#fbf8f2] px-3 py-1 text-xs font-semibold text-[#928980] sm:text-sm">
                  {sample}명 등록
                </span>
              </div>
              {enough && stat ? (
                <div>
                  <p className="text-xs sm:text-sm text-[#635b51]">
                    우리 동기 등록 평균 {cat.label} 기본금
                  </p>
                  <p className="mt-1.5 font-serif-kr text-2xl sm:text-3xl font-light text-[#263832] break-words">
                    {stat.avg_base_price.toLocaleString()}만원
                    <span className="ml-2 text-xs sm:text-sm font-sans text-[#928980] font-normal">
                      ({sample}명)
                    </span>
                  </p>
                  {stat.avg_extra_price > 0 && (
                    <p className="mt-1.5 text-xs sm:text-sm text-[#635b51]">
                      추가금 평균 {stat.avg_extra_price.toLocaleString()}만원
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-2 flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-[#B89785] shrink-0 mt-0.5" />
                    <p className="text-xs sm:text-sm text-[#635b51] leading-relaxed">
                      아직 5명 이상 등록되지 않았어요. 데이터가 더 쌓이기 전에는 비교값을 만들지 않아요.
                    </p>
                  </div>
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
        <h3 className="mb-1 font-serif-kr text-[22px] font-medium text-[#263832]">
          내 견적·계약 정보 등록
        </h3>
        <p className="mb-4 text-[12px] font-medium leading-5 text-[#635b51]">
          업체명은 다른 사람에게 보이지 않고, 평균 통계 계산에만 사용돼요.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#878680]">업체명 (공개 안 됨)</label>
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="예) XX스튜디오"
              className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[#878680]">카테고리</label>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as CohortContractCategory)
              }
              className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
            >
              {CONTRACT_ITEMS.map((c) => (
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
                className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
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
                className="w-full rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[#878680]">포함/미포함 메모 (선택)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="예) 원본 포함, 헬퍼비 별도"
              className="w-full resize-none rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
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
            className="flex-1 rounded-xl bg-[#36534E] px-4 py-2.5 text-sm text-white transition-colors hover:bg-[#2B423E] disabled:opacity-60"
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
  enabled,
  toastFn,
}: {
  roomId: string;
  enabled: boolean;
  toastFn: ToastFnLike;
}) {
  const [events, setEvents] = useState<CohortTimelineEvent[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    const res = await fetch(`/api/community/cohort/${roomId}/timeline`);
    const data = await res.json();
    if (res.ok) {
      setEvents(data.events ?? []);
    } else {
      toastFn.error(data.error ?? "준비 기록을 불러오지 못했어요.");
    }
  }, [enabled, roomId, toastFn]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadEvents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEvents]);

  function openModal() {
    if (!enabled) {
      toastFn.error("로그인 후 준비 기록을 남길 수 있어요.");
      return;
    }
    setModalOpen(true);
  }

  return (
    <div>
      <div className="mb-4 rounded-[18px] border border-[#e5d8ca] bg-[#fffdf8] p-4 sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 className="font-serif-kr text-[22px] font-medium text-[#263832]">준비 기록</h2>
          <p className="mt-1 text-[13px] font-medium leading-6 text-[#635b51]">
            계약·투어·예약처럼 완료한 일을 남기면, 같은 시기 커플들의 준비 흐름을 참고할 수 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.18)] transition-colors hover:bg-[#2B423E] sm:mt-0 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          기록 추가
        </button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-[18px] border border-[#e5d8ca] bg-white p-8 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#EEF4F1] text-[#36534E]">
            <Calendar className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold text-[#263832]">아직 준비 기록이 없어요.</p>
          <p className="mt-1 text-[13px] font-medium leading-6 text-[#635b51]">
            첫 계약, 투어 완료, 예약 완료를 남기면 이 방의 준비 흐름이 만들어져요.
          </p>
          <button
            type="button"
            onClick={openModal}
            className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#e5d8ca] bg-[#fffdf8] px-4 text-[13px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/35"
          >
            <Plus className="h-4 w-4" />
            첫 기록 남기기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const nickname = ev.user?.nickname ?? "익명";
            const initial = nickname[0] ?? "?";
            const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;
            return (
              <div
                key={ev.id}
                className="flex items-start gap-3 rounded-[18px] border border-[#e5d8ca] bg-white p-4 sm:p-5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-xs font-medium text-white">
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
                  <p className="text-sm text-[#263832] leading-relaxed">
                    {nickname}님이{" "}
                    <span className="font-medium text-[#36534E]">{label}</span>
                    을 남겼어요.
                  </p>
                  {ev.description && (
                    <p className="mt-1 text-xs sm:text-sm text-[#635b51]">{ev.description}</p>
                  )}
                  <p className="mt-1.5 text-xs text-[#928980]">
                    {relativeTime(ev.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <TimelineEventModal
          roomId={roomId}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            loadEvents();
            toastFn.success("준비 기록이 추가됐어요.");
          }}
          onError={(m) => toastFn.error(m)}
        />
      )}
    </div>
  );
}

function TimelineEventModal({
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
  const [eventType, setEventType] = useState<CohortEventType>("contract_done");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/community/cohort/${roomId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: eventType,
          description: description.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        onError(data.error ?? "준비 기록을 저장하지 못했어요.");
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
      <div className="w-full max-w-lg rounded-2xl border border-[#F0EFED] bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
        <h3 className="mb-1 font-serif-kr text-[22px] font-medium text-[#263832]">
          준비 기록 추가
        </h3>
        <p className="mb-4 text-[12px] font-medium leading-5 text-[#635b51]">
          완료한 일을 짧게 남기면 동기들이 준비 순서를 참고할 수 있어요.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {EVENT_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setEventType(item.key)}
              className={`rounded-[14px] border px-3 py-3 text-left transition-colors ${
                eventType === item.key
                  ? "border-[#36534E] bg-[#EEF4F1] text-[#263832]"
                  : "border-[#e5d8ca] bg-[#fffdf8] text-[#635b51] hover:border-[#36534E]/35"
              }`}
            >
              <span className="block text-[13px] font-semibold">{item.label}</span>
              <span className="mt-1 block text-[11px] font-medium leading-[1.5] text-[#635b51]">
                {item.helper}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-[#878680]">메모 (선택)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="예) 오늘 B드레스샵 계약 완료, 원본 포함 조건으로 확정"
            className="w-full resize-none rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
          />
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
            className="flex-1 rounded-xl bg-[#36534E] px-4 py-2.5 text-sm text-white transition-colors hover:bg-[#2B423E] disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

type CohortDigestPeriod = "today" | "week";

type CohortDigest = {
  period: CohortDigestPeriod;
  generatedAt: string;
  messageCount: number;
  imageCount: number;
  lead: string;
  topicBreakdown: Array<{
    topic: CohortThreadTopic;
    label: string;
    count: number;
  }>;
  subtopics?: Array<{
    id: string;
    label: string;
    title?: string;
    group: "price" | "vendor" | "schedule" | "relationship" | "prep";
    groupLabel: string;
    count: number;
    participantCount?: number;
    questionCount: number;
    keywords: string[];
    primaryMessageId?: string | null;
    messageIds?: string[];
    sample: string;
    summary: string;
    action: string;
  }>;
  highlights: string[];
  questions: Array<{
    topic: CohortThreadTopic;
    label: string;
    text: string;
  }>;
  nextActions: string[];
  empty: boolean;
};

const DIGEST_TOPIC_STYLE: Record<CohortThreadTopic, string> = {
  price: "bg-[#EEF4F1] text-[#36534E]",
  review: "bg-[#f6efe5] text-[#795252]",
  concern: "bg-[#fff7e8] text-[#8a6428]",
  chat: "bg-[#f5f2ed] text-[#635b51]",
};

type CohortDigestSubtopic = NonNullable<CohortDigest["subtopics"]>[number];

const DIGEST_SUBTOPIC_DOT: Record<CohortDigestSubtopic["group"], string> = {
  price: "bg-[#36534E]",
  vendor: "bg-[#9d6b62]",
  schedule: "bg-[#6b8a78]",
  relationship: "bg-[#b28342]",
  prep: "bg-[#928980]",
};

function CohortDigestCard({
  roomId,
  onTabChange,
  onFocusMessage,
}: {
  roomId: string;
  onTabChange: (tab: TabKey) => void;
  onFocusMessage: (messageId: string) => void;
}) {
  const [period, setPeriod] = useState<CohortDigestPeriod>("today");
  const [digest, setDigest] = useState<CohortDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubtopics, setShowAllSubtopics] = useState(false);

  const loadDigest = useCallback(async (keepPrevious = false) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/community/cohort/${encodeURIComponent(roomId)}/digest?period=${period}`);
      const data = (await res.json().catch(() => ({}))) as Partial<CohortDigest> & { error?: string };

      if (!res.ok || data.error) {
        setError(data.error || "요약을 불러오지 못했어요.");
        if (!keepPrevious) setDigest(null);
        return;
      }

      setDigest(data as CohortDigest);
    } catch {
      setError("요약을 불러오지 못했어요.");
      if (!keepPrevious) setDigest(null);
    } finally {
      setLoading(false);
    }
  }, [period, roomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadDigest();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDigest]);

  useEffect(() => {
    setShowAllSubtopics(false);
  }, [period, roomId]);

  const totalCount = digest?.topicBreakdown.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const subtopics = digest?.subtopics ?? [];
  const visibleSubtopics = showAllSubtopics ? subtopics : subtopics.slice(0, DIGEST_SUBTOPIC_INITIAL_LIMIT);
  const canExpandSubtopics = subtopics.length > DIGEST_SUBTOPIC_INITIAL_LIMIT;
  const hiddenSubtopicCount = Math.max(subtopics.length - DIGEST_SUBTOPIC_INITIAL_LIMIT, 0);
  const highlights = digest?.highlights ?? [];

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#36534E]">
            오늘/이번주 흐름
          </p>
          <h3 className="font-serif-kr text-[22px] font-medium text-[#263832]">동기방 요약</h3>
          <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#928980]">
            전체 흐름을 먼저 잡고, 대표 이야기만 눌러서 바로 이어서 봐요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadDigest(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5d8ca] bg-[#fffdf8] text-[#36534E] transition-colors hover:border-[#36534E]/35"
          aria-label="동기방 요약 새로고침"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-[#f6efe5] p-1">
        {[
          { key: "today" as const, label: "오늘" },
          { key: "week" as const, label: "이번주" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setPeriod(item.key)}
            className={`min-h-9 rounded-full text-[12px] font-semibold transition-colors ${
              period === item.key
                ? "bg-white text-[#36534E] shadow-[0_6px_16px_rgba(50,36,17,0.08)]"
                : "text-[#635b51] hover:text-[#36534E]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && !digest ? (
        <div className="space-y-2">
          <div className="h-4 w-4/5 animate-pulse rounded-full bg-[#f6efe5]" />
          <div className="h-4 w-2/3 animate-pulse rounded-full bg-[#f6efe5]" />
          <div className="h-20 animate-pulse rounded-[16px] bg-[#fbf8f2]" />
        </div>
      ) : error && !digest ? (
        <div className="rounded-[16px] border border-[#e5d8ca] bg-[#fffdf8] px-4 py-5 text-center">
          <p className="text-sm font-semibold text-[#263832]">요약을 잠시 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => loadDigest()}
            className="mt-3 inline-flex min-h-9 items-center justify-center rounded-full border border-[#e5d8ca] px-4 text-[12px] font-semibold text-[#36534E]"
          >
            다시 시도
          </button>
        </div>
      ) : digest?.empty ? (
        <div className="rounded-[16px] border border-[#e5d8ca] bg-[#fffdf8] p-4">
          <p className="text-sm font-semibold text-[#263832]">{digest.lead}</p>
          <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#635b51]">
            견적, 투어 후기, 오늘 한 준비를 하나만 남겨도 다음 사람이 따라오기 쉬워져요.
          </p>
          <button
            type="button"
            onClick={() => onTabChange("chat")}
            className="mt-4 inline-flex min-h-9 items-center justify-center rounded-full bg-[#36534E] px-4 text-[12px] font-semibold text-white"
          >
            첫 대화 남기기
          </button>
        </div>
      ) : digest ? (
        <div className="space-y-4">
          <div className="rounded-[16px] border border-[#e5d8ca] bg-[#fffdf8] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-[1.6] text-[#263832]">{digest.lead}</p>
              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#36534E]">
                {digest.messageCount}개
              </span>
            </div>

            {digest.topicBreakdown.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {digest.topicBreakdown.map((item) => {
                  const pct = totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0;
                  return (
                    <span
                      key={item.topic}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${DIGEST_TOPIC_STYLE[item.topic]}`}
                    >
                      {item.label} {item.count}개{pct > 0 ? ` · ${pct}%` : ""}
                    </span>
                  );
                })}
              </div>
            )}

            {highlights.length > 0 && (
              <div className="mt-3 border-t border-[#efe5d9] pt-3">
                <p className="mb-2 text-[12px] font-semibold text-[#36534E]">핵심 포인트</p>
                <ul className="space-y-1.5">
                  {highlights.slice(0, 3).map((highlight) => (
                    <li key={highlight} className="flex gap-2 text-[12px] font-medium leading-[1.55] text-[#635b51]">
                      <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#36534E]" />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {visibleSubtopics.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-[13px] font-semibold text-[#263832]">대표 이야기</h4>
                <span className="text-[11px] font-medium text-[#928980]">
                  {showAllSubtopics ? `전체 ${subtopics.length}개` : "상위 3개"}
                </span>
              </div>
              <ul className="overflow-hidden rounded-[16px] border border-[#e5d8ca] bg-white">
                {visibleSubtopics.map((item) => {
                  const title = item.title ?? item.label;
                  const canFocus = Boolean(item.primaryMessageId);

                  return (
                    <li
                      key={item.id}
                      className="border-b border-[#efe5d9] last:border-b-0"
                    >
                      <button
                        type="button"
                        disabled={!canFocus}
                        onClick={() => {
                          if (!item.primaryMessageId) return;
                          onTabChange("chat");
                          onFocusMessage(item.primaryMessageId);
                        }}
                        className="group flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors enabled:hover:bg-[#fbf8f2] disabled:cursor-default"
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DIGEST_SUBTOPIC_DOT[item.group]}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <strong className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#263832]">
                              {title}
                            </strong>
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="rounded-full bg-[#f6efe5] px-2 py-0.5 text-[10px] font-semibold text-[#36534E]">
                                {item.participantCount ?? 1}명 · {item.count}회
                              </span>
                              {canFocus && (
                                <ArrowRight className="h-3.5 w-3.5 text-[#b5ada3] transition-colors group-hover:text-[#36534E]" />
                              )}
                            </div>
                          </div>
                          <p className="mt-1 line-clamp-1 text-[11px] font-medium text-[#928980]">
                            {item.label}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {canExpandSubtopics && (
                  <li className="border-t border-[#efe5d9] bg-[#fffdf8]">
                    <button
                      type="button"
                      onClick={() => setShowAllSubtopics((value) => !value)}
                      className="flex min-h-10 w-full items-center justify-center gap-1.5 px-3 text-[12px] font-semibold text-[#36534E] transition-colors hover:bg-[#fbf8f2]"
                      aria-expanded={showAllSubtopics}
                    >
                      {showAllSubtopics ? (
                        <>
                          간단히 보기
                          <ChevronUp className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          더 보기 {hiddenSubtopicCount}개
                          <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onTabChange("chat")}
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#e5d8ca] bg-white text-[12px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/35"
            >
              대화 보기
            </button>
            <button
              type="button"
              onClick={() => onTabChange("info")}
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-[#36534E] text-[12px] font-semibold text-white"
            >
              등록 금액
            </button>
          </div>
        </div>
      ) : null}
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-serif-kr text-[22px] font-medium text-[#263832]">동기들이 많이 본 글</h3>
        <Link href={weddingPath("/community?sort=hot")} className="text-[12px] font-semibold text-[#36534E]">
          더보기
        </Link>
      </div>
      {posts.length === 0 ? (
        <p className="rounded-[14px] bg-[#fbf8f2] px-4 py-5 text-center text-sm font-medium text-[#635b51]">
          아직 인기글이 없어요
        </p>
      ) : (
        <ul className="space-y-3.5">
          {posts.slice(0, 5).map((p, i) => (
            <li key={p.id} className="group">
              <Link href={communityPostPath(p.id)} className="flex items-start gap-3 rounded-[14px] border border-[#e5d8ca] bg-[#fffdf8] p-3 transition-colors hover:border-[#36534E]/35 hover:bg-[#f6efe5]">
                <span className={`mt-0.5 shrink-0 font-serif-kr text-xl italic leading-none text-[#36534E] ${
                  i === 0 ? "" : i === 1 ? "opacity-75" : i === 2 ? "opacity-55" : "opacity-35"
                }`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm text-[#263832] group-hover:text-[#36534E] transition-colors line-clamp-2 leading-snug">
                    {p.title}
                  </h4>
                  <p className="text-xs text-[#928980] mt-1">
                    ▲ {p.upvote_count} &middot; 💬 {p.comment_count}
                  </p>
                </div>
              </Link>
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
  "from-[#36534E] to-[#2B423E]",
  "from-[#4E6A62] to-[#36534E]",
  "from-[#6D806E] to-[#36534E]",
  "from-[#9A8F72] to-[#36534E]",
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
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-serif-kr text-[22px] font-medium text-[#263832]">함께 준비 중</h3>
          <p className="mt-1 text-[12px] font-medium text-[#928980]">최근 입장한 동기들</p>
        </div>
        <span className="rounded-full bg-[#EEF4F1] px-3 py-1 text-xs font-semibold text-[#36534E]">{memberCount}명</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {members.slice(0, 8).map((m) => {
          const grad = MEMBER_GRADIENTS[m.nickname.charCodeAt(0) % MEMBER_GRADIENTS.length];
          return (
            <div
              key={m.user_id}
              className="flex flex-col items-center gap-1 w-12"
              title={m.nickname}
            >
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-medium shadow-sm`}>
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  m.nickname[0]
                )}
              </div>
              <span className="text-[10px] text-[#635b51] truncate w-full text-center">
                {m.nickname}
              </span>
            </div>
          );
        })}
        {members.length === 0 && (
          <div className="w-full rounded-[14px] bg-[#fbf8f2] px-4 py-5 text-center text-sm font-medium text-[#635b51]">
            멤버 정보를 불러오는 중이에요.
          </div>
        )}
        {memberCount > 8 && (
          <div className="flex flex-col items-center gap-1 w-12">
            <div className="w-9 h-9 rounded-full bg-[#f6efe5] flex items-center justify-center text-xs text-[#635b51] font-medium">
              +{memberCount - 8}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
