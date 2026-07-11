"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import {
  User,
  Calendar,
  Wallet,
  Heart,
  Bell,
  LogOut,
  ChevronRight,
  Copy,
  Check,
  Pencil,
  Save,
  X,
  Trash2,
  MapPin,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";
import { useNotificationPrefs } from "@/hooks/useNotifications";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database.types";
import type {
  WeddingStyle,
  PriorityItem,
  BudgetTendency,
  GuestCount,
} from "@/types/onboarding.types";

// 웨딩 스타일 4필드 선택지 — 온보딩과 동일
const STYLE_OPTIONS: { value: WeddingStyle; label: string }[] = [
  { value: "minimal", label: "미니멀" },
  { value: "classic", label: "클래식" },
  { value: "fancy", label: "화려한" },
  { value: "natural", label: "자연스러운" },
];

const PRIORITY_OPTIONS: { value: PriorityItem; label: string }[] = [
  { value: "sdm", label: "스드메" },
  { value: "venue", label: "예식장" },
  { value: "rings", label: "예물·예단" },
  { value: "honeymoon", label: "신혼여행" },
  { value: "ceremony", label: "본식 연출" },
  { value: "housing", label: "신혼집" },
];

const BUDGET_TENDENCY_OPTIONS: { value: BudgetTendency; label: string }[] = [
  { value: "saving", label: "절약형" },
  { value: "balanced", label: "가성비" },
  { value: "premium", label: "프리미엄" },
];

const GUEST_COUNT_OPTIONS: { value: GuestCount; label: string }[] = [
  { value: "under50", label: "50명 이하" },
  { value: "50to100", label: "50~100명" },
  { value: "100to200", label: "100~200명" },
  { value: "200to300", label: "200~300명" },
  { value: "over300", label: "300명 이상" },
];

async function waitForLifecycleResponse(url: string, init: RequestInit) {
  for (let attempt = 0; attempt < 360; attempt++) {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (response.status !== 202) return { response, data };
    const retryMs = typeof data.retryAfterMs === "number"
      ? Math.max(500, Math.min(5000, data.retryAfterMs))
      : 1000;
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  throw new Error("진행 중인 AI 요청 종료를 기다리는 시간이 초과되었습니다.");
}

type WeddingPreferenceState = Partial<{
  weddingStyle: WeddingStyle | null;
  priorities: PriorityItem[];
  budgetTendency: BudgetTendency | null;
  guestCount: GuestCount | null;
}>;

type ProfileUpdateResponse = {
  profile?: Profile;
  error?: string;
};

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

async function purgeLocalUserData(): Promise<void> {
  try { localStorage.clear(); } catch { /* storage unavailable */ }
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  try {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
    }
  } catch { /* cookie cleanup best effort */ }
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
  } catch { /* cache cleanup best effort */ }
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.reset(true);
  } catch { /* analytics may be disabled */ }
}

export default function SettingsPage() {
  const { profile, partner, couple, journey, isDemo, signOut, updateJourney, updateProfile } = useAuthStore();
  const { prefs: notifications, togglePref: toggleNotification } = useNotificationPrefs();
  const [copied, setCopied] = useState(false);
  const [coupleCode, setCoupleCode] = useState("");
  const [isFullyLinked, setIsFullyLinked] = useState(false);
  const [requiresRelinkConfirmation, setRequiresRelinkConfirmation] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [coupleCodeError, setCoupleCodeError] = useState("");

  // 휴대폰 번호 (알림톡/문자 케어 채널 준비)
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneConsent, setPhoneConsent] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);

  useEffect(() => {
    setPhoneInput(profile?.phone ?? "");
    setPhoneConsent(Boolean(profile?.phone_care_consented_at));
  }, [profile?.phone, profile?.phone_care_consented_at]);

  const phoneDirty =
    (profile?.phone ?? "") !== phoneInput.replace(/[^0-9]/g, "") ||
    Boolean(profile?.phone_care_consented_at) !== phoneConsent;

  async function savePhone() {
    if (isDemo || phoneSaving) return;
    setPhoneSaving(true);
    setPhoneMessage(null);
    try {
      await updateProfile({
        phone: phoneInput,
        phone_care_consent: phoneInput.replace(/[^0-9]/g, "") ? phoneConsent : false,
      });
      setPhoneMessage("저장했어요.");
    } catch (err) {
      setPhoneMessage(err instanceof Error ? err.message : "저장에 실패했어요.");
    } finally {
      setPhoneSaving(false);
      window.setTimeout(() => setPhoneMessage(null), 4000);
    }
  }

  // 수정 모드
  const [editingName, setEditingName] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [editingVenue, setEditingVenue] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [venueInput, setVenueInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [showResetWeddingModal, setShowResetWeddingModal] = useState(false);
  const [resetWeddingConfirmText, setResetWeddingConfirmText] = useState("");
  const [resettingWedding, setResettingWedding] = useState(false);
  const [resetWeddingError, setResetWeddingError] = useState("");
  const [comingSoonToast, setComingSoonToast] = useState("");
  const [draftPrefs, setDraftPrefs] = useState<WeddingPreferenceState>({});
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [journeySaveError, setJourneySaveError] = useState("");

  useEffect(() => {
    if (!couple) return;

    if (isDemo) {
      setCoupleCode(couple.invite_code ?? "WH-DEMO01");
      setIsFullyLinked(Boolean(couple.bride_id && couple.groom_id));
      return;
    }

    fetch("/api/couple/code")
      .then((r) => r.json())
      .then((d) => {
        if (d.inviteCode) setCoupleCode(d.inviteCode);
        if (d.isFullyLinked) setIsFullyLinked(true);
        setRequiresRelinkConfirmation(d.requiresRelinkConfirmation === true);
      })
      .catch(() => {});
  }, [couple, isDemo]);

  const handleCopy = () => {
    if (!coupleCode) return;
    navigator.clipboard.writeText(coupleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    setRegenerating(true);
    setCoupleCodeError("");
    try {
      if (isDemo) {
        setCoupleCode(`WH-DEMO${Math.floor(Math.random() * 90 + 10)}`);
        return;
      }

      const res = await fetch("/api/couple/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmLegacyRelink: requiresRelinkConfirmation }),
      });
      const data = await res.json();
      if (res.ok && data.inviteCode) {
        setCoupleCode(data.inviteCode);
        setRequiresRelinkConfirmation(false);
      } else {
        setCoupleCodeError(data.error ?? "초대 코드를 만들지 못했습니다.");
      }
    } catch {
      setCoupleCodeError("초대 코드를 만들지 못했습니다.");
    } finally {
      setRegenerating(false);
    }
  };

  // 이름 저장
  const saveName = async () => {
    if (!nameInput.trim()) return;
    setSaving(true);
    setNameError("");
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameInput.trim(),
          sync_community_nickname: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ProfileUpdateResponse;
      if (!res.ok) {
        setNameError(data.error ?? "이름 저장에 실패했습니다.");
        return;
      }
      if (data.profile) {
        useAuthStore.setState({ profile: data.profile });
        useCommunityStore.getState().applyOwnNickname(data.profile.id, data.profile.name);
      }
      setEditingName(false);
    } catch {
      setNameError("이름 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // 날짜 저장
  const saveDate = async () => {
    setSaving(true);
    setJourneySaveError("");
    const saved = await updateJourney({ wedding_date: dateInput || null });
    setSaving(false);
    if (saved) setEditingDate(false);
    else setJourneySaveError("결혼 예정일을 저장하지 못했습니다. 입력값을 유지했으니 다시 시도해주세요.");
  };

  // 예산 저장
  const saveBudget = async () => {
    const value = parseInt(budgetInput) * 10000;
    if (isNaN(value) || value <= 0) return;
    setSaving(true);
    setJourneySaveError("");
    const saved = await updateJourney({ total_budget: value });
    setSaving(false);
    if (saved) setEditingBudget(false);
    else setJourneySaveError("예산을 저장하지 못했습니다. 입력값을 유지했으니 다시 시도해주세요.");
  };

  // 예식장 저장 — 빈 문자열은 null로 (미정 상태)
  const saveVenue = async () => {
    setSaving(true);
    setJourneySaveError("");
    const saved = await updateJourney({ venue: venueInput.trim() || null });
    setSaving(false);
    if (saved) setEditingVenue(false);
    else setJourneySaveError("예식장을 저장하지 못했습니다. 입력값을 유지했으니 다시 시도해주세요.");
  };

  // 웨딩 스타일 선호도 — journey.progress.__preferences 안에 저장됨.
  // progress 자체는 다른 체크리스트 항목들도 들어있으므로 머지해서 PATCH.
  // 칩 클릭 즉시 저장 (편집 모드 없음).
  const prefs = (journey?.progress as Record<string, unknown> | undefined)?.__preferences as
    | {
        weddingStyle?: WeddingStyle | null;
        priorities?: PriorityItem[];
        budgetTendency?: BudgetTendency | null;
        guestCount?: GuestCount | null;
      }
    | undefined;

  useEffect(() => {
    setDraftPrefs(prefs ?? {});
  }, [prefs]);

  const updatePreferences = async (
    partial: Partial<{
      weddingStyle: WeddingStyle | null;
      priorities: PriorityItem[];
      budgetTendency: BudgetTendency | null;
      guestCount: GuestCount | null;
    }>
  ) => {
    const currentProgress = (journey?.progress ?? {}) as Record<string, unknown>;
    const nextPrefs = { ...draftPrefs, ...partial };
    setDraftPrefs(nextPrefs);
    setPreferenceSaving(true);
    try {
      const saved = await updateJourney({
        progress: { ...currentProgress, __preferences: nextPrefs } as never,
      });
      if (!saved) {
        setDraftPrefs(prefs ?? {});
        setJourneySaveError("웨딩 스타일을 저장하지 못했습니다. 이전 값으로 되돌렸어요.");
      }
    } catch {
      setDraftPrefs(prefs ?? {});
    } finally {
      setPreferenceSaving(false);
    }
  };

  const togglePriority = async (value: PriorityItem) => {
    const cur = draftPrefs.priorities ?? [];
    const next = cur.includes(value) ? cur.filter((p) => p !== value) : [...cur, value];
    await updatePreferences({ priorities: next });
  };

  const DELETE_REASONS = [
    { value: "unsatisfied", label: "서비스 불만족" },
    { value: "alternative", label: "다른 서비스 이용" },
    { value: "wedding_done", label: "결혼 준비 완료" },
    { value: "privacy", label: "개인정보 우려" },
    { value: "low_usage", label: "사용 빈도 낮음" },
    { value: "other", label: "기타" },
  ];

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "탈퇴합니다" || !deleteReason) return;
    setDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch("/api/auth/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status !== 202) {
        setDeleteError(data.error ?? "계정 삭제에 실패했습니다.");
        return;
      }

      try {
        await createClient().auth.signOut();
      } catch {
        // The durable server job is already queued. Continue with local purge
        // even if remote session revocation is temporarily unavailable.
      }
      useAuthStore.getState().reset();
      await purgeLocalUserData();
      window.location.href = "/login";
    } catch {
      setDeleteError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  };

  const handleResetWedding = async () => {
    if (resetWeddingConfirmText !== "초기화합니다") return;
    setResettingWedding(true);
    setResetWeddingError("");

    try {
      const { response: res, data } = await waitForLifecycleResponse("/api/couple/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: resetWeddingConfirmText }),
      });

      if (!res.ok) {
        setResetWeddingError(data.error ?? "초기화에 실패했습니다.");
        return;
      }

      document.cookie = "onboarding_complete=; path=/; max-age=0";
      window.location.href = "/onboarding";
    } catch {
      setResetWeddingError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setResettingWedding(false);
    }
  };

  const userName = profile?.name ?? "사용자";
  const userEmail = profile?.email ?? "";
  const userRole = profile?.role === "bride" ? "신부" : profile?.role === "groom" ? "신랑" : "";
  const initials = userName.slice(0, 2).toUpperCase();

  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;
  const dateStr = weddingDate
    ? `${weddingDate.getFullYear()}년 ${weddingDate.getMonth() + 1}월 ${weddingDate.getDate()}일`
    : "날짜 미정";
  const totalBudget = journey?.total_budget ?? 0;
  const budgetStr = totalBudget > 0
    ? `₩${(totalBudget / 10000).toLocaleString()}만원`
    : "미설정";
  const venue = journey?.venue ?? null;
  const venueStr = venue && venue.trim().length > 0 ? venue : "미정";

  const partnerName = partner?.name;
  const partnerRole = partner?.role === "bride" ? "신부" : partner?.role === "groom" ? "신랑" : "";

  return (
    <div className="max-w-[700px] mx-auto bg-[#FAFAF8]">
      {/* 페이지 제목 */}
      <h1 className="font-serif-kr text-4xl font-light text-[#1A1A1F] mb-6 animate-fade-in">설정</h1>

      {/* 프로필 카드 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 mb-6"
      >
        <div className="flex items-center gap-5 mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center shadow-[0_8px_24px_rgba(121,82,82,0.2)]">
            <span className="font-display text-3xl text-white font-light">{initials}</span>
          </div>
          <div className="flex-1">
            {editingName ? (
              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => {
                      setNameInput(e.target.value);
                      setNameError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && saveName()}
                    className="px-3 py-2 rounded-lg bg-[#F6F3F2] text-lg text-[#1A1A1F] outline-none focus:ring-2 focus:ring-[#795252]/30 w-[170px]"
                    autoFocus
                  />
                  <button onClick={saveName} disabled={saving} className="w-9 h-9 rounded-lg bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-5 h-5" />
                  </button>
                  <button onClick={() => { setEditingName(false); setNameError(""); }} className="w-9 h-9 rounded-lg bg-[#F6F3F2] flex items-center justify-center text-[#504444]">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {nameError && <p className="mt-2 text-sm text-[#9A3F3F]">{nameError}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="font-serif-kr text-2xl font-light text-[#1A1A1F]">{userName}</h2>
                {userRole && (
                  <span className="text-sm px-2.5 py-1 rounded-full bg-[#795252]/10 text-[#795252] font-medium">
                    {userRole}
                  </span>
                )}
                <button
                  onClick={() => { setNameInput(userName); setNameError(""); setEditingName(true); }}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
            <p className="text-base text-[#504444] font-light mt-1">{userEmail}</p>
          </div>
        </div>

        {journeySaveError && (
          <p className="mb-4 rounded-xl border border-[#E4B7B7] bg-[#FFF5F5] px-4 py-3 text-sm text-[#9A3F3F]" role="alert">
            {journeySaveError}
          </p>
        )}

        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1 max-lg:grid-cols-2">
          {/* 결혼 예정일 */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[#F6F3F2]">
            <Calendar className="w-6 h-6 text-[#795252] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#B5ADA3]">결혼 예정일</p>
              {editingDate ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="px-2.5 py-1.5 rounded-md bg-white text-base text-[#1A1A1F] outline-none focus:ring-2 focus:ring-[#795252]/30"
                    autoFocus
                  />
                  <button onClick={saveDate} disabled={saving} className="w-7 h-7 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingDate(false)} className="w-7 h-7 rounded-md bg-white flex items-center justify-center text-[#504444]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[17px] font-medium text-[#1A1A1F]">{dateStr}</p>
                  <button
                    onClick={() => { setDateInput(journey?.wedding_date ?? ""); setEditingDate(true); }}
                    className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 예식장 — 온보딩에서 입력되는 값이지만 설정에서 양쪽이 같이 보고 수정할 수 있게 노출 */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[#F6F3F2]">
            <MapPin className="w-6 h-6 text-[#795252] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#B5ADA3]">예식장</p>
              {editingVenue ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="text"
                    value={venueInput}
                    onChange={(e) => setVenueInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveVenue()}
                    placeholder="예: 더 라움, 호텔 A"
                    className="min-w-0 flex-1 px-2.5 py-1.5 rounded-md bg-white text-base text-[#1A1A1F] outline-none focus:ring-2 focus:ring-[#795252]/30 placeholder:text-[#B5ADA3]"
                    autoFocus
                  />
                  <button onClick={saveVenue} disabled={saving} className="w-7 h-7 shrink-0 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingVenue(false)} className="w-7 h-7 shrink-0 rounded-md bg-white flex items-center justify-center text-[#504444]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[17px] font-medium text-[#1A1A1F] truncate">{venueStr}</p>
                  <button
                    onClick={() => { setVenueInput(venue ?? ""); setEditingVenue(true); }}
                    className="w-6 h-6 shrink-0 rounded flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 설정 예산 */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[#F6F3F2]">
            <Wallet className="w-6 h-6 text-[#C9A96E] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#B5ADA3]">설정 예산</p>
              {editingBudget ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                      className="w-[90px] px-2.5 py-1.5 rounded-md bg-white text-base text-[#1A1A1F] outline-none focus:ring-2 focus:ring-[#795252]/30 text-right"
                      autoFocus
                    />
                    <span className="text-sm text-[#B5ADA3] ml-1">만원</span>
                  </div>
                  <button onClick={saveBudget} disabled={saving} className="w-7 h-7 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingBudget(false)} className="w-7 h-7 rounded-md bg-white flex items-center justify-center text-[#504444]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[17px] font-medium text-[#1A1A1F]">{budgetStr}</p>
                  <button
                    onClick={() => { setBudgetInput(String(totalBudget / 10000)); setEditingBudget(true); }}
                    className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* 웨딩 스타일 — 온보딩에서 입력되는 4필드 (스타일/우선순위/예산성향/하객수).
          한쪽이 온보딩에서 설정한 값을 코드로 따라온 파트너도 보고 수정할 수 있도록.
          칩 클릭 = 즉시 저장 (편집 모드 없음). */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.03 }}
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C4967E] to-[#9A6B62] flex items-center justify-center shadow-[0_4px_14px_rgba(196,150,126,0.2)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F]">웨딩 스타일</h3>
            <p className="text-base text-[#504444] font-light">
              아모라가 추천·예산 짤 때 쓰는 취향 정보예요
              <span className="ml-2 text-sm text-[#B5ADA3]">
                {preferenceSaving ? "저장 중..." : "선택하면 바로 저장돼요"}
              </span>
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* 스타일 */}
          <div>
            <p className="text-sm text-[#B5ADA3] mb-2">스타일</p>
            <div className="flex flex-wrap gap-2">
              {STYLE_OPTIONS.map((opt) => {
                const selected = draftPrefs.weddingStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updatePreferences({ weddingStyle: selected ? null : opt.value })}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selected
                        ? "bg-[#795252] text-white shadow-sm"
                        : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EFEAE6]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 우선순위 (다중 선택) */}
          <div>
            <p className="text-sm text-[#B5ADA3] mb-2">우선순위 <span className="text-[#B5ADA3]/70">(여러 개 선택)</span></p>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_OPTIONS.map((opt) => {
                const selected = (draftPrefs.priorities ?? []).includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => togglePriority(opt.value)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selected
                        ? "bg-[#795252] text-white shadow-sm"
                        : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EFEAE6]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 예산 성향 */}
          <div>
            <p className="text-sm text-[#B5ADA3] mb-2">예산 성향</p>
            <div className="flex flex-wrap gap-2">
              {BUDGET_TENDENCY_OPTIONS.map((opt) => {
                const selected = draftPrefs.budgetTendency === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updatePreferences({ budgetTendency: selected ? null : opt.value })}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selected
                        ? "bg-[#795252] text-white shadow-sm"
                        : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EFEAE6]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 하객 규모 */}
          <div>
            <p className="text-sm text-[#B5ADA3] mb-2">하객 규모</p>
            <div className="flex flex-wrap gap-2">
              {GUEST_COUNT_OPTIONS.map((opt) => {
                const selected = draftPrefs.guestCount === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updatePreferences({ guestCount: selected ? null : opt.value })}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selected
                        ? "bg-[#795252] text-white shadow-sm"
                        : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EFEAE6]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>

      {/* 커플 연동 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center shadow-[0_4px_14px_rgba(121,82,82,0.2)]">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F]">커플 연동</h3>
            <p className="text-base text-[#504444] font-light">파트너와 함께 준비 현황을 공유하세요</p>
          </div>
        </div>

        <div className="bg-[#F6F3F2] rounded-xl p-5">
          {requiresRelinkConfirmation && !partner && (
            <div className="mb-4 rounded-xl border border-[#D9C3AE] bg-white p-4">
              <p className="text-sm font-medium text-[#1A1A1F]">새 커플 공간으로 시작해 주세요</p>
              <p className="mt-1 text-sm leading-relaxed text-[#6F645C]">
                이전 공간의 일정·예산·대화는 새 파트너에게 공유하지 않습니다. 비어 있는 새 공간과
                새 초대 코드를 만들며, 필요한 정보는 안전하게 다시 입력할 수 있어요.
              </p>
              <button
                type="button"
                onClick={handleRegenerateCode}
                disabled={regenerating}
                className="mt-3 rounded-lg bg-[#795252] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#684545] disabled:opacity-50"
              >
                {regenerating ? "새 공간 만드는 중..." : "확인하고 새 커플 공간 만들기"}
              </button>
            </div>
          )}

          {coupleCode && !isFullyLinked && (
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#B5ADA3] mb-1">나의 커플 코드</p>
                  <p className="text-xl font-display font-medium text-[#1A1A1F] tracking-wider">{coupleCode}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white text-sm text-[#504444] shadow-sm hover:text-[#795252] transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-[#2E7D5A]" />
                        <span className="text-[#2E7D5A]">복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        복사
                      </>
                    )}
                  </button>
                </div>
              </div>
              <button
                onClick={handleRegenerateCode}
                disabled={regenerating}
                className="mt-2 text-sm text-[#B5ADA3] hover:text-[#795252] transition-colors disabled:opacity-50"
              >
                {regenerating ? "재발급 중..." : "코드 재발급"}
              </button>
            </div>
          )}

          {coupleCodeError && (
            <p className="mb-3 text-sm text-[#9B3A3A]" role="alert">{coupleCodeError}</p>
          )}

          {partner ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white shadow-sm">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center">
                <span className="text-base text-white font-medium">{partnerName?.slice(0, 2)}</span>
              </div>
              <div className="flex-1">
                <p className="text-base text-[#1A1A1F] font-medium">{partnerName}</p>
                <p className="text-sm text-[#2E7D5A]">{partnerRole} · 연동 완료</p>
              </div>
              <Check className="w-6 h-6 text-[#2E7D5A]" />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white shadow-sm">
              <div className="w-12 h-12 rounded-full bg-[#F6F3F2] flex items-center justify-center">
                <User className="w-6 h-6 text-[#B5ADA3]" />
              </div>
              <div className="flex-1">
                <p className="text-base text-[#B5ADA3] font-light">파트너 미연동</p>
                <p className="text-sm text-[#B5ADA3]/70">코드를 공유해서 파트너를 초대하세요</p>
              </div>
              <ChevronRight className="w-5 h-5 text-[#B5ADA3]" />
            </div>
          )}

          {!isDemo && (
            <button
              type="button"
              onClick={() => {
                setResetWeddingConfirmText("");
                setResetWeddingError("");
                setShowResetWeddingModal(true);
              }}
              className="mt-3 w-full flex items-center justify-between gap-3 rounded-lg border border-[#E8DDD3] bg-white px-4 py-3 text-left shadow-sm hover:border-[#C4967E]/50 transition-colors"
            >
              <span className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-[#F6F3F2] flex items-center justify-center">
                  <RotateCcw className="w-5 h-5 text-[#795252]" />
                </span>
                <span>
                  <span className="block text-base font-medium text-[#1A1A1F]">새 커플로 다시 시작</span>
                  <span className="block text-sm text-[#928980]">현재 커플 연결을 끊고 온보딩으로 돌아갑니다.</span>
                </span>
              </span>
              <ChevronRight className="w-5 h-5 text-[#B5ADA3] flex-shrink-0" />
            </button>
          )}
        </div>
      </motion.div>

      {/* 알림 설정 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center shadow-[0_4px_14px_rgba(46,125,90,0.2)]">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F]">알림 설정</h3>
        </div>

        <div className="flex flex-col gap-1">
          {/* 아모라 케어 — 서버 저장(이메일 아웃바운드), 아래 로컬 토글들과 저장소가 다름 */}
          <div className="flex items-center justify-between px-5 py-4 rounded-xl hover:bg-[#F6F3F2] transition-colors">
            <div>
              <p className="text-[17px] font-medium text-[#1A1A1F]">아모라 먼저 챙기기</p>
              <p className="text-sm text-[#B5ADA3] font-light">
                상견례·청첩장 모임 등 일정 전후에 아모라가 이메일로 먼저 안부를 물어요
              </p>
            </div>
            <button
              onClick={() => {
                if (isDemo) return;
                updateProfile({
                  care_notifications_enabled: !(profile?.care_notifications_enabled ?? true),
                }).catch(() => {});
              }}
              className={`w-12 h-7 rounded-full transition-colors relative ${
                (profile?.care_notifications_enabled ?? true)
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a]"
                  : "bg-[#B5ADA3]/30"
              }`}
            >
              <div
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-transform ${
                  (profile?.care_notifications_enabled ?? true) ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          {/* 휴대폰 번호 — 알림톡/문자 케어 채널 준비 (서버 저장) */}
          <div className="px-5 py-4 rounded-xl hover:bg-[#F6F3F2] transition-colors">
            <p className="text-[17px] font-medium text-[#1A1A1F]">휴대폰 번호</p>
            <p className="text-sm text-[#B5ADA3] font-light mb-3">
              카톡·문자 케어 오픈 시 이 번호로 아모라가 먼저 안부를 물어요 (준비 중)
            </p>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="010-1234-5678"
                disabled={isDemo}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#F6F3F2] text-[15px] text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all disabled:opacity-50"
              />
              <button
                onClick={savePhone}
                disabled={isDemo || phoneSaving || !phoneDirty}
                className="px-5 py-2.5 rounded-xl bg-[#795252] text-white text-sm font-medium disabled:opacity-40 hover:bg-[#946a6a] transition-colors flex-shrink-0"
              >
                {phoneSaving ? "저장 중" : "저장"}
              </button>
            </div>
            <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={phoneConsent}
                onChange={(e) => setPhoneConsent(e.target.checked)}
                disabled={isDemo || !phoneInput.replace(/[^0-9]/g, "")}
                className="mt-0.5 h-4 w-4 accent-[#795252]"
              />
              <span className="text-sm text-[#504444] font-light leading-relaxed">
                직접 입력한 일정 안내를 카톡·문자로 받는 것에 동의합니다
                <span className="text-[#B5ADA3]"> (언제든 여기서 해제 가능)</span>
              </span>
            </label>
            {phoneMessage && (
              <p className="mt-2 text-sm text-[#795252]">{phoneMessage}</p>
            )}
          </div>
          {[
            { key: "schedule" as const, label: "일정 알림", desc: "D-day 체크리스트 리마인더" },
            { key: "budget" as const, label: "예산 알림", desc: "예산 초과 및 변동 알림" },
            { key: "ai" as const, label: "맞춤 추천 알림", desc: "맞춤 업체 추천, 꿀팁 안내" },
            { key: "marketing" as const, label: "마케팅 알림", desc: "이벤트, 할인 정보" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between px-5 py-4 rounded-xl hover:bg-[#F6F3F2] transition-colors"
            >
              <div>
                <p className="text-[17px] font-medium text-[#1A1A1F]">{item.label}</p>
                <p className="text-sm text-[#B5ADA3] font-light">{item.desc}</p>
              </div>
              <button
                onClick={() => toggleNotification(item.key)}
                className={`w-12 h-7 rounded-full transition-colors relative ${
                  notifications[item.key] ? "bg-gradient-to-br from-[#795252] to-[#946a6a]" : "bg-[#B5ADA3]/30"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-transform ${
                    notifications[item.key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 기타 메뉴 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mb-6"
      >
        {[
          { label: "이용약관" },
          { label: "개인정보 처리방침" },
          { label: "고객센터" },
          { label: "앱 버전", value: "v1.0.0 (Beta)" },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => {
              if (!item.value) {
                setComingSoonToast(item.label);
                setTimeout(() => setComingSoonToast(""), 3000);
              }
            }}
            className="w-full flex items-center justify-between px-6 py-5 hover:bg-[#F6F3F2] transition-colors"
          >
            <span className="text-[17px] text-[#1A1A1F]">{item.label}</span>
            {item.value ? (
              <span className="text-base text-[#B5ADA3]">{item.value}</span>
            ) : (
              <ChevronRight className="w-5 h-5 text-[#B5ADA3]" />
            )}
          </button>
        ))}
        {comingSoonToast && (
          <div className="px-6 py-3 bg-amber-50">
            <p className="text-sm text-amber-700">{comingSoonToast} 페이지는 준비 중입니다.</p>
          </div>
        )}
      </motion.div>

      {/* 로그아웃 & 탈퇴 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex flex-col gap-3"
      >
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-white text-red-400 text-base font-medium shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-shadow"
        >
          <LogOut className="w-5 h-5" />
          로그아웃
        </button>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-[#B5ADA3] text-base font-light hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          계정 탈퇴
        </button>
      </motion.div>

      {/* 새 커플 시작 모달 */}
      <AnimatePresence>
        {showResetWeddingModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[420px] bg-white rounded-xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-[#F6F3F2] flex items-center justify-center">
                <RotateCcw className="w-6 h-6 text-[#795252]" />
              </div>
              <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F] text-center mb-2">
                새 커플로 다시 시작할까요?
              </h3>
              <p className="text-sm text-[#928980] text-center leading-relaxed mb-6">
                현재 커플 연결을 끊고 온보딩으로 돌아갑니다.
                <br />
                내 계정은 유지되며, 새 파트너 코드로 다시 연결할 수 있어요.
              </p>

              <label className="block text-sm text-[#504444] mb-2">
                확인을 위해 <span className="font-semibold text-[#795252]">초기화합니다</span>를 입력해주세요
              </label>
              <input
                type="text"
                value={resetWeddingConfirmText}
                onChange={(e) => {
                  setResetWeddingConfirmText(e.target.value);
                  setResetWeddingError("");
                }}
                placeholder="초기화합니다"
                className="w-full px-4 py-3 rounded-xl border border-[#E8DDD3] text-base outline-none focus:border-[#C4967E]"
              />
              {resetWeddingError && (
                <p className="mt-3 text-sm text-red-500">{resetWeddingError}</p>
              )}

              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetWeddingModal(false)}
                  className="flex-1 py-3 rounded-xl bg-[#F6F3F2] text-[#504444] font-medium hover:bg-[#EDE8E5] transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleResetWedding}
                  disabled={resetWeddingConfirmText !== "초기화합니다" || resettingWedding}
                  className="flex-1 py-3 rounded-xl bg-[#795252] text-white font-medium hover:bg-[#946a6a] transition-colors disabled:opacity-40"
                >
                  {resettingWedding ? "초기화 중..." : "다시 시작"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 계정 탈퇴 모달 */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[400px] bg-white rounded-xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>

              <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F] text-center mb-2">
                정말 탈퇴하시겠어요?
              </h3>
              <p className="text-sm text-[#B5ADA3] text-center leading-relaxed mb-6">
                본인 비공개 상담과 직접 작성한 내용은 삭제되며 계정은 복구할 수 없습니다.
                <br />
                파트너의 공동 계획·AI 답변과 법정 보존 대상 거래기록은 정해진 기간 남을 수 있습니다.
                <br />
                요청이 접수되면 바로 로그아웃되며, 삭제는 서버에서 안전하게 계속 처리됩니다.
              </p>

              {/* 탈퇴 사유 */}
              <div className="mb-5">
                <p className="text-sm text-[#504444] mb-3">탈퇴 사유를 선택해주세요</p>
                <div className="space-y-2">
                  {DELETE_REASONS.map((r) => (
                    <label key={r.value} className={`flex items-center gap-2.5 px-3 py-3 rounded-xl cursor-pointer transition-colors ${
                      deleteReason === r.value ? "bg-[#795252]/5 ring-1 ring-[#795252]/20" : "bg-[#F6F3F2] hover:bg-[#EDE7E5]"
                    }`}>
                      <input
                        type="radio"
                        name="deleteReason"
                        value={r.value}
                        checked={deleteReason === r.value}
                        onChange={() => setDeleteReason(r.value)}
                        className="w-4 h-4 accent-[#795252]"
                      />
                      <span className="text-base text-[#1A1A1F]">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <p className="text-sm text-[#504444] mb-2">
                  확인을 위해 <span className="font-semibold text-red-400">탈퇴합니다</span>를 입력해주세요
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="탈퇴합니다"
                  className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] outline-none focus:ring-2 focus:ring-red-400/40 transition-all placeholder:text-[#B5ADA3]"
                />
              </div>

              {deleteError && (
                <p className="text-sm text-red-500 text-center mb-4">{deleteError}</p>
              )}

              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "탈퇴합니다" || !deleteReason || deleting}
                className="w-full py-3 rounded-xl text-base font-medium transition-all mb-3 bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {deleting ? "삭제 요청 접수 중..." : "계정 영구 삭제"}
              </button>

              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText("");
                   setDeleteError("");
                   setDeleteReason("");
                 }}
                className="w-full py-3 rounded-xl text-base font-medium text-[#504444] hover:text-[#1A1A1F] hover:bg-[#F6F3F2] transition-all"
              >
                취소
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
