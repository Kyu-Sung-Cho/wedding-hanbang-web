"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
  BrainCircuit,
  ShieldCheck,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";
import { useNotificationPrefs } from "@/hooks/useNotifications";
import type { Profile } from "@/types/database.types";
import type {
  WeddingStyle,
  PriorityItem,
  BudgetTendency,
  GuestCount,
} from "@/types/onboarding.types";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { CONTACT } from "@/lib/constants/contact";
import {
  resolveCoupleConnectionState,
  type CoupleConnectionState,
  WEDDING_BUDGET_TENDENCY_OPTIONS,
  WEDDING_GUEST_COUNT_OPTIONS,
  WEDDING_PRIORITY_OPTIONS,
  WEDDING_STYLE_OPTIONS,
} from "@hanbang/shared";

// 웨딩 스타일 4필드 선택지 — 온보딩과 동일
const STYLE_OPTIONS: readonly { value: WeddingStyle; label: string }[] =
  WEDDING_STYLE_OPTIONS;
const PRIORITY_OPTIONS: readonly { value: PriorityItem; label: string }[] =
  WEDDING_PRIORITY_OPTIONS;
const BUDGET_TENDENCY_OPTIONS: readonly {
  value: BudgetTendency;
  label: string;
}[] = WEDDING_BUDGET_TENDENCY_OPTIONS;
const GUEST_COUNT_OPTIONS: readonly { value: GuestCount; label: string }[] =
  WEDDING_GUEST_COUNT_OPTIONS;

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

export default function SettingsPage() {
  const {
    user,
    profile,
    partner,
    couple,
    journey,
    isDemo,
    signOut,
    updateJourney,
    updateProfile,
  } = useAuthStore();
  const { prefs: notifications, togglePref: toggleNotification } = useNotificationPrefs();
  const [copied, setCopied] = useState(false);
  const [coupleConnection, setCoupleConnection] = useState<CoupleConnectionState>(() =>
    resolveCoupleConnectionState(null),
  );
  const [regenerating, setRegenerating] = useState(false);

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
  const [journeyNotice, setJourneyNotice] = useState("");
  const [journeyError, setJourneyError] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [showResetWeddingModal, setShowResetWeddingModal] = useState(false);
  const [resetWeddingConfirmText, setResetWeddingConfirmText] = useState("");
  const [resettingWedding, setResettingWedding] = useState(false);
  const [resetWeddingError, setResetWeddingError] = useState("");
  const [draftPrefs, setDraftPrefs] = useState<WeddingPreferenceState>({});
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [revokingLegacyCareConsent, setRevokingLegacyCareConsent] = useState(false);
  const [legacyCareConsentError, setLegacyCareConsentError] = useState("");

  useEffect(() => {
    const context = {
      partnerPresent: Boolean(partner),
      membershipSealedAt: couple?.membership_sealed_at,
    };

    setCopied(false);

    if (!couple) {
      setCoupleConnection(resolveCoupleConnectionState(null, context));
      return;
    }

    if (isDemo) {
      setCoupleConnection(resolveCoupleConnectionState({
        inviteCode: couple.invite_code ?? "WH-DEMO01",
        isFullyLinked: Boolean(couple.bride_id && couple.groom_id),
        isMembershipSealed: Boolean(couple.membership_sealed_at),
      }, context));
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // Clear any retained invite immediately. Local partner/seal evidence can
    // still identify linked or sealed states while the privileged API loads.
    setCoupleConnection(resolveCoupleConnectionState(null, context));

    fetch("/api/couple/code", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error("COUPLE_CONNECTION_LOOKUP_FAILED");
        if (!cancelled) {
          setCoupleConnection(resolveCoupleConnectionState(payload, context));
        }
      })
      .catch(() => {
        // Fail closed: never restore a previously displayed invite code.
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [couple, isDemo, partner]);

  const phase = coupleConnection.phase;
  const coupleCode = coupleConnection.inviteCode;
  const hasLegacyCareConsent =
    profile?.care_notifications_enabled === true &&
    typeof profile.care_notifications_consented_at === "string" &&
    profile.care_notifications_consented_at.trim().length > 0;

  const revokeLegacyCareConsent = async () => {
    setRevokingLegacyCareConsent(true);
    setLegacyCareConsentError("");
    try {
      await updateProfile({ care_notifications_enabled: false });
    } catch {
      setLegacyCareConsentError("수신 동의를 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setRevokingLegacyCareConsent(false);
    }
  };

  const handleCopy = () => {
    if (!coupleCode) return;
    navigator.clipboard.writeText(coupleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    if (!coupleConnection.canInvite) return;

    setRegenerating(true);
    try {
      if (isDemo) {
        setCoupleConnection(resolveCoupleConnectionState({
          inviteCode: `WH-DEMO${Math.floor(Math.random() * 90 + 10)}`,
          isFullyLinked: false,
          isMembershipSealed: false,
        }));
        return;
      }

      const res = await fetch("/api/couple/code", { method: "POST" });
      const payload: unknown = await res.json().catch(() => null);
      if (res.ok) {
        const inviteCode = typeof payload === "object" && payload !== null
          ? (payload as { inviteCode?: unknown }).inviteCode
          : null;
        setCoupleConnection(resolveCoupleConnectionState({
          inviteCode,
          isFullyLinked: false,
          isMembershipSealed: false,
        }));
      } else {
        // A join can win the race after this screen loaded. Remove the old
        // code immediately and let the next canonical GET reveal the phase.
        setCoupleConnection(resolveCoupleConnectionState(null, {
          partnerPresent: Boolean(partner),
          membershipSealedAt: couple?.membership_sealed_at,
        }));
      }
    } catch {
      setCoupleConnection(resolveCoupleConnectionState(null, {
        partnerPresent: Boolean(partner),
        membershipSealedAt: couple?.membership_sealed_at,
      }));
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
    setJourneyError("");
    setJourneyNotice("");
    try {
      const result = await updateJourney({ wedding_date: dateInput || null });
      setJourneyNotice(
        result.status === "pending_partner"
          ? `${result.summary} 상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다.`
          : "결혼일을 저장했어요.",
      );
      setEditingDate(false);
    } catch (error) {
      setJourneyError(
        error instanceof Error
          ? error.message
          : "결혼일을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  // 예산 저장
  const saveBudget = async () => {
    const value = parseInt(budgetInput) * 10000;
    if (isNaN(value) || value <= 0) return;
    setSaving(true);
    setJourneyError("");
    setJourneyNotice("");
    try {
      const result = await updateJourney({ total_budget: value });
      setJourneyNotice(
        result.status === "pending_partner"
          ? `${result.summary} 상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다.`
          : "총예산을 저장했어요.",
      );
      setEditingBudget(false);
    } catch (error) {
      setJourneyError(
        error instanceof Error
          ? error.message
          : "총예산을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  // 결혼식장 저장 — 빈 문자열은 null로 (미정 상태)
  const saveVenue = async () => {
    setSaving(true);
    setJourneyError("");
    setJourneyNotice("");
    try {
      const result = await updateJourney({ venue: venueInput.trim() || null });
      setJourneyNotice(
        result.status === "pending_partner"
          ? `${result.summary} 상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다.`
          : "대표 식장을 저장했어요.",
      );
      setEditingVenue(false);
    } catch (error) {
      setJourneyError(
        error instanceof Error
          ? error.message
          : "대표 식장을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
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
    setJourneyError("");
    setJourneyNotice("");
    try {
      const result = await updateJourney({
        progress: { ...currentProgress, __preferences: nextPrefs } as never,
      });
      if (result.status === "pending_partner") {
        setDraftPrefs(prefs ?? {});
        setJourneyNotice(
          `${result.summary} 상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다.`,
        );
      }
    } catch (error) {
      setDraftPrefs(prefs ?? {});
      setJourneyError(
        error instanceof Error
          ? error.message
          : "웨딩 선호도를 저장하지 못했습니다.",
      );
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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        pending?: boolean;
      };

      if (data.pending) {
        window.alert(
          data.message
            ?? "계정 삭제 요청을 안전하게 처리 중이에요. 새 파일 업로드는 제한돼요.",
        );
        try {
          await signOut();
        } finally {
          window.location.href = "/login";
        }
        return;
      }

      if (!res.ok) {
        setDeleteError(data.error ?? "계정 삭제에 실패했습니다.");
        return;
      }

      try {
        await signOut();
      } finally {
        window.location.href = "/login";
      }
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
      const res = await fetch("/api/couple/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: resetWeddingConfirmText }),
      });
      const data = await res.json().catch(() => ({}));

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
  const userEmail = user?.email ?? profile?.email ?? "";
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

      {journeyNotice && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-[#B9D5C8] bg-[#F2F8F5] px-4 py-3 text-sm leading-6 text-[#315B49]"
        >
          {journeyNotice}
        </div>
      )}
      {journeyError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[#E5B8B8] bg-[#FFF6F6] px-4 py-3 text-sm leading-6 text-[#8C3E3E]"
        >
          {journeyError}
        </div>
      )}

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

          {/* 결혼식장 — 온보딩 값이며 두 사람이 함께 확인하고 수정할 수 있다. */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[#F6F3F2]">
            <MapPin className="w-6 h-6 text-[#795252] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#B5ADA3]">결혼식장</p>
              {editingVenue ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="text"
                    value={venueInput}
                    onChange={(e) => setVenueInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveVenue()}
                    placeholder="예: 결혼식장 이름"
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
                {isDemo
                  ? "체험에서는 저장되지 않아요"
                  : preferenceSaving
                    ? "저장 중..."
                    : "선택하면 바로 저장돼요"}
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
          {phase === "awaiting_partner" && coupleCode && (
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
                disabled={regenerating || !coupleConnection.canInvite}
                className="mt-2 text-sm text-[#B5ADA3] hover:text-[#795252] transition-colors disabled:opacity-50"
              >
                {regenerating ? "재발급 중..." : "코드 재발급"}
              </button>
            </div>
          )}

          {phase === "linked" ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white shadow-sm">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center">
                <span className="text-base text-white font-medium">{partnerName?.slice(0, 2) ?? "두 분"}</span>
              </div>
              <div className="flex-1">
                <p className="text-base text-[#1A1A1F] font-medium">{partnerName ?? "파트너"}</p>
                <p className="text-sm text-[#2E7D5A]">{partnerRole ? `${partnerRole} · ` : ""}연동 완료</p>
              </div>
              <Check className="w-6 h-6 text-[#2E7D5A]" />
            </div>
          ) : phase === "sealed_single" ? (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="w-12 h-12 flex-shrink-0 rounded-full bg-[#F6F3F2] flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-[#795252]" />
                </span>
                <div>
                  <p className="text-base font-medium text-[#1A1A1F]">이 커플 연결은 종료됐어요</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#746A63]">
                    연결 기록을 보호하기 위해 새 멤버를 이 커플에 초대할 수 없어요.
                    아래에서 새 커플로 다시 시작하거나 문제가 있으면 고객지원에 문의해 주세요.
                  </p>
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="mt-2 inline-flex text-sm font-medium text-[#795252] underline underline-offset-4"
                  >
                    고객지원 문의
                  </a>
                </div>
              </div>
            </div>
          ) : phase === "awaiting_partner" ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white shadow-sm">
              <div className="w-12 h-12 rounded-full bg-[#F6F3F2] flex items-center justify-center">
                <User className="w-6 h-6 text-[#B5ADA3]" />
              </div>
              <div className="flex-1">
                <p className="text-base text-[#504444] font-medium">파트너 초대 대기</p>
                <p className="text-sm text-[#928980]">위 코드를 파트너에게 공유해 주세요</p>
              </div>
              <ChevronRight className="w-5 h-5 text-[#B5ADA3]" />
            </div>
          ) : (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <p className="text-base font-medium text-[#1A1A1F]">연결 상태를 확인하지 못했어요</p>
              <p className="mt-1 text-sm leading-relaxed text-[#746A63]">
                안전을 위해 새 멤버 초대는 잠시 멈췄어요. 화면을 새로고침하거나 고객지원에 문의해 주세요.
              </p>
              <a
                href={`mailto:${CONTACT.email}`}
                className="mt-2 inline-flex text-sm font-medium text-[#795252] underline underline-offset-4"
              >
                고객지원 문의
              </a>
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
          {[
            { key: "schedule" as const, label: "일정 알림", desc: "앱 안 알림 목록에서 결혼식까지 남은 기간에 맞춰 확인할 일을 알려드려요." },
            { key: "budget" as const, label: "예산 알림", desc: "앱 안 알림 목록에서 전체 예산 범위를 정할 시점을 알려드려요." },
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
                type="button"
                role="switch"
                aria-label={item.label}
                aria-checked={notifications[item.key]}
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

        {hasLegacyCareConsent && (
          <div className="mt-5 border-t border-[#E8E0D8] px-5 pt-5">
            <p className="text-[17px] font-medium text-[#1A1A1F]">이전 이메일 수신 동의</p>
            <p className="mt-1 text-sm font-light leading-relaxed text-[#928980]">
              예전에 동의한 아모라 이메일 수신을 여기에서 해제할 수 있어요.
            </p>
            <button
              type="button"
              onClick={() => void revokeLegacyCareConsent()}
              disabled={revokingLegacyCareConsent}
              className="mt-3 text-sm font-medium text-[#A04A4A] underline underline-offset-4 disabled:cursor-wait disabled:opacity-50"
            >
              {revokingLegacyCareConsent ? "해제 중..." : "이메일 수신 동의 해제"}
            </button>
            {legacyCareConsentError && (
              <p role="alert" className="mt-2 text-sm text-[#A04A4A]">
                {legacyCareConsentError}
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* 개인별 아모라 도움 방식 — 커플 공용 웨딩 스타일과 분리 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.12 }}
        className="mb-6 overflow-hidden rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
      >
        <Link
          {...weddingLinkProps("/settings/amora-style")}
          className="flex min-h-24 items-center gap-4 px-6 py-5 transition-colors hover:bg-[#F7F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#36534E]"
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#36534E] shadow-[0_4px_14px_rgba(54,83,78,0.2)]">
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium text-[#243832]">
              아모라 도움 방식
            </span>
            <span className="mt-0.5 block text-sm font-light leading-relaxed text-[#6D806E]">
              추천·비교·공감·실행 중 내가 편한 순서를 직접 정해요
            </span>
          </span>
          <span className="hidden items-center gap-1 text-xs font-medium text-[#6D806E] sm:flex">
            <ShieldCheck className="h-4 w-4" />
            나만 적용
          </span>
          <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#B89785]" />
        </Link>
      </motion.div>

      {/* 아모라 기억 관리 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.13 }}
        className="mb-6 overflow-hidden rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
      >
        <Link
          {...weddingLinkProps("/settings/amora-memory")}
          className="flex min-h-24 items-center gap-4 px-6 py-5 transition-colors hover:bg-[#F7F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8F6662]"
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#8F6662] shadow-[0_4px_14px_rgba(143,102,98,0.2)]">
            <BrainCircuit className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium text-[#243832]">아모라가 기억하는 것</span>
            <span className="mt-0.5 block text-sm font-light leading-relaxed text-[#6D806E]">
              기억을 켜거나 끄고, 잘못 이해한 내용은 직접 고치거나 지울 수 있어요
            </span>
          </span>
          <span className="hidden items-center gap-1 text-xs font-medium text-[#6D806E] sm:flex">
            <ShieldCheck className="h-4 w-4" />
            내 통제
          </span>
          <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#B89785]" />
        </Link>
      </motion.div>

      {/* 기타 메뉴 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mb-6"
      >
        {[
          { label: "이용약관", href: "/terms" },
          { label: "개인정보 처리방침", href: "/privacy" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex w-full items-center justify-between px-6 py-5 transition-colors hover:bg-[#F6F3F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#795252]/40"
          >
            <span className="text-[17px] text-[#1A1A1F]">{item.label}</span>
            <ChevronRight className="h-5 w-5 text-[#B5ADA3]" />
          </Link>
        ))}
        <a
          href={`mailto:${CONTACT.email}`}
          className="flex w-full items-center justify-between px-6 py-5 transition-colors hover:bg-[#F6F3F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#795252]/40"
        >
          <span>
            <span className="block text-[17px] text-[#1A1A1F]">고객센터</span>
            <span className="mt-0.5 block text-sm text-[#928980]">{CONTACT.email}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-[#B5ADA3]" />
        </a>
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
                계정과 직접 소유한 데이터 삭제를 요청합니다.
                <br />
                안전 확인이 필요한 경우 완료까지 시간이 걸릴 수 있어요.
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
                {deleting ? "요청 중..." : "계정 삭제 요청"}
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
