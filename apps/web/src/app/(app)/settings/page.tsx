"use client";

import { useState, useEffect } from "react";
import {
  ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE,
  parseAccountDeletionIntakeCapability,
} from "@/lib/account/deletionIntake";
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
import TodayOnePreferenceControl from "@/components/app/TodayOnePreferenceControl";
import InviteCodePanel from "@/components/invite/InviteCodePanel";
import { ACCOUNT_DELETION_FACTS } from "@hanbang/shared/constants";
import {
  describeCoupleInviteWindow,
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

/** 재발급이 실패했을 때. 코드가 사라진 이유를 말하고 다음 행동을 준다. */
const REGENERATE_FAILED =
  "초대 코드를 다시 만들지 못했어요. 연결 상태를 다시 불러오는 중이에요 — 잠시 뒤 화면을 확인해 주세요.";

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
  const [coupleConnection, setCoupleConnection] = useState<CoupleConnectionState>(() =>
    resolveCoupleConnectionState(null),
  );
  /**
   * 커플 연결 조회가 어디쯤인지.
   *
   * `resolveCoupleConnectionState(null)` 은 "모름"(`unavailable`)을 돌려준다. 그런데 그
   * 값 하나로 **불러오는 중 · 응답이 이상함 · 요청이 실패함**을 전부 그렸다. 그래서
   * 파트너가 아직 없는 사람이 설정을 열면, 조회가 끝나기도 전에 「연결 상태를 확인하지
   * 못했어요 · 고객지원에 문의」가 먼저 인사했다. 첫날 사용자가 가장 먼저 하는 일이
   * 배우자 초대인데 그 문에 사실이 아닌 오류가 붙어 있던 셈이다.
   *
   * 모바일 설정에는 이 구분이 이미 있다. 같은 모양으로 셋을 가른다.
   */
  const [connectionLookup, setConnectionLookup] =
    useState<"loading" | "ready" | "failed">("loading");
  const [connectionRetryNonce, setConnectionRetryNonce] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  /** 재발급이 거절된 이유. 코드가 화면에서 사라진 이유를 말해 준다. */
  const [regenerateError, setRegenerateError] = useState("");

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
  /**
   * 자동 탈퇴 접수가 열려 있는가. 서버가 판정해 `/api/auth/me` 의 capabilities 로 내려준다.
   *
   * **모르는 동안(null)에는 닫힌 것으로 그린다.** 열려 있다고 잘못 그리면 사용자가
   * 확인 문구까지 친 뒤에 거부당하고, 닫혔다고 잘못 그리면 안내가 한 번 더 뜰 뿐이다.
   */
  const [deletionIntakeOpen, setDeletionIntakeOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    let cancelled = false;

    fetch("/api/auth/me", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        setDeletionIntakeOpen(
          parseAccountDeletionIntakeCapability(
            (payload as { capabilities?: unknown } | null)?.capabilities,
          ),
        );
      })
      .catch(() => {
        // 판정을 못 읽었으면 닫힌 것으로 둔다(초기값 그대로).
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isDemo]);

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

    if (!couple) {
      setCoupleConnection(resolveCoupleConnectionState(null, context));
      return;
    }

    if (isDemo) {
      setCoupleConnection(resolveCoupleConnectionState({
        inviteCode: couple.invite_code ?? "WH-DEMO01",
        isFullyLinked: Boolean(couple.bride_id && couple.groom_id),
        isMembershipSealed: Boolean(couple.membership_sealed_at),
        inviteCodeExpiresAt: null,
        inviteCodeReissued: false,
      }, context));
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // Clear any retained invite immediately. Local partner/seal evidence can
    // still identify linked or sealed states while the privileged API loads.
    setCoupleConnection(resolveCoupleConnectionState(null, context));
    setConnectionLookup("loading");

    fetch("/api/couple/code", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error("COUPLE_CONNECTION_LOOKUP_FAILED");
        if (!cancelled) {
          setCoupleConnection(resolveCoupleConnectionState(payload, context));
          setConnectionLookup("ready");
        }
      })
      .catch(() => {
        // Fail closed: never restore a previously displayed invite code.
        // 다만 **실패했다는 사실은 말한다.** 조용히 "모름" 화면으로 두면 사용자는
        // 자기 커플이 잘못됐다고 읽는다.
        if (!cancelled) setConnectionLookup("failed");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [couple, isDemo, partner, connectionRetryNonce]);

  const phase = coupleConnection.phase;
  const coupleCode = coupleConnection.inviteCode;
  const inviteWindowNotice = describeCoupleInviteWindow(coupleConnection);
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
        setCoupleConnection(resolveCoupleConnectionState(payload));
        setRegenerateError("");
      } else {
        // A join can win the race after this screen loaded. Remove the old
        // code immediately and let the next canonical GET reveal the phase.
        //
        // **그 GET 을 실제로 부른다.** 예전에는 이 주석이 적힌 대로 되지 않았다 —
        // 코드만 지우고 조회를 다시 걸지 않아, 멀쩡한 코드가 화면에서 사라진 채
        // 「연결 상태를 확인하지 못했어요 · 고객지원에 문의」만 남았다.
        setCoupleConnection(resolveCoupleConnectionState(null, {
          partnerPresent: Boolean(partner),
          membershipSealedAt: couple?.membership_sealed_at,
        }));
        setRegenerateError(
          typeof (payload as { error?: unknown } | null)?.error === "string"
            ? String((payload as { error: string }).error)
            : REGENERATE_FAILED,
        );
        setConnectionRetryNonce((value) => value + 1);
      }
    } catch {
      setCoupleConnection(resolveCoupleConnectionState(null, {
        partnerPresent: Boolean(partner),
        membershipSealedAt: couple?.membership_sealed_at,
      }));
      setRegenerateError(REGENERATE_FAILED);
      setConnectionRetryNonce((value) => value + 1);
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
    // 자동 접수가 닫혀 있으면 사유도 확인 문구도 묻지 않는다 — 지워지지 않을 일에
    // 파기 확인 절차를 시키는 것은 사용자를 헛수고시키는 것이다. 그때 이 요청은
    // 서버가 안내(503 + supportEmail)를 돌려주게 하는 용도이고, 아무것도 지우지 않는다.
    if (
      deletionIntakeOpen === true
      && (deleteConfirmText !== "탈퇴합니다" || !deleteReason)
    ) {
      return;
    }
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
  // 중립 준비 공간에서는 role이 항상 채워지지만 사용자가 고른 값이 아니다.
  // 빈 문자열 폴백은 role이 null일 때만 발동하므로 여기서는 죽은 코드다.
  const usesNeutralMembers = couple?.member_model_version === 2;
  const userRole = usesNeutralMembers
    ? ""
    : profile?.role === "bride" ? "신부" : profile?.role === "groom" ? "신랑" : "";
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
  const partnerRole = usesNeutralMembers
    ? ""
    : partner?.role === "bride" ? "신부" : partner?.role === "groom" ? "신랑" : "";

  return (
    <div className="max-w-[700px] mx-auto bg-[#FAFAF8]">
      {/* 페이지 제목 */}
      <h1 className="font-serif-kr text-4xl font-light text-[var(--hb-text-strong)] mb-6 animate-fade-in">설정</h1>

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
        className="bg-white rounded-xl shadow-[var(--shadow-raised)] p-8 mb-6"
      >
        <div className="flex items-center gap-5 mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center shadow-[var(--shadow-raised)]">
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
                    className="px-3 py-2 rounded-lg bg-[var(--hb-surface-hover)] text-lg text-[var(--hb-text-strong)] outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)] w-[170px]"
                    autoFocus
                  />
                  <button onClick={saveName} disabled={saving} className="tap-area shrink-0 w-9 h-9 rounded-lg bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-5 h-5" />
                  </button>
                  <button onClick={() => { setEditingName(false); setNameError(""); }} className="tap-area shrink-0 w-9 h-9 rounded-lg bg-[var(--hb-surface-hover)] flex items-center justify-center text-[var(--hb-text-body)]">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {nameError && <p className="mt-2 text-sm text-[#9A3F3F]">{nameError}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="font-serif-kr text-2xl font-light text-[var(--hb-text-strong)]">{userName}</h2>
                {userRole && (
                  <span className="text-sm px-2.5 py-1 rounded-full bg-[rgba(54,83,78,0.10)] text-[var(--hb-accent-hover)] font-medium">
                    {userRole}
                  </span>
                )}
                <button
                  onClick={() => { setNameInput(userName); setNameError(""); setEditingName(true); }}
                  className="tap-area shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)] bg-[#f3e9df] transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
            <p className="text-base text-[var(--hb-text-body)] font-light mt-1">{userEmail}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1 max-lg:grid-cols-2">
          {/* 결혼 예정일 */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[var(--hb-surface-hover)]">
            <Calendar className="w-6 h-6 text-[var(--hb-accent-hover)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--hb-text-muted)]">결혼 예정일</p>
              {editingDate ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="px-2.5 py-1.5 rounded-md bg-white text-base text-[var(--hb-text-strong)] outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
                    autoFocus
                  />
                  <button onClick={saveDate} disabled={saving} className="tap-area shrink-0 w-7 h-7 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingDate(false)} className="tap-area shrink-0 w-7 h-7 rounded-md bg-white flex items-center justify-center text-[var(--hb-text-body)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[17px] font-medium text-[var(--hb-text-strong)]">{dateStr}</p>
                  <button
                    onClick={() => { setDateInput(journey?.wedding_date ?? ""); setEditingDate(true); }}
                    className="tap-area shrink-0 w-6 h-6 rounded flex items-center justify-center text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 결혼식장 — 온보딩 값이며 두 사람이 함께 확인하고 수정할 수 있다. */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[var(--hb-surface-hover)]">
            <MapPin className="w-6 h-6 text-[var(--hb-accent-hover)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--hb-text-muted)]">결혼식장</p>
              {editingVenue ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="text"
                    value={venueInput}
                    onChange={(e) => setVenueInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveVenue()}
                    placeholder="예: 결혼식장 이름"
                    className="min-w-0 flex-1 px-2.5 py-1.5 rounded-md bg-white text-base text-[var(--hb-text-strong)] outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)] placeholder:text-[var(--hb-text-muted)]"
                    autoFocus
                  />
                  <button onClick={saveVenue} disabled={saving} className="tap-area w-7 h-7 shrink-0 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingVenue(false)} className="tap-area w-7 h-7 shrink-0 rounded-md bg-white flex items-center justify-center text-[var(--hb-text-body)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[17px] font-medium text-[var(--hb-text-strong)] truncate">{venueStr}</p>
                  <button
                    onClick={() => { setVenueInput(venue ?? ""); setEditingVenue(true); }}
                    className="tap-area w-6 h-6 shrink-0 rounded flex items-center justify-center text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 설정 예산 */}
          <div className="flex items-center gap-3 p-5 rounded-xl bg-[var(--hb-surface-hover)]">
            <Wallet className="w-6 h-6 text-[var(--hb-accent-hover)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--hb-text-muted)]">설정 예산</p>
              {editingBudget ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                      className="w-[90px] px-2.5 py-1.5 rounded-md bg-white text-base text-[var(--hb-text-strong)] outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)] text-right"
                      autoFocus
                    />
                    <span className="text-sm text-[var(--hb-text-muted)] ml-1">만원</span>
                  </div>
                  <button onClick={saveBudget} disabled={saving} className="tap-area shrink-0 w-7 h-7 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingBudget(false)} className="tap-area shrink-0 w-7 h-7 rounded-md bg-white flex items-center justify-center text-[var(--hb-text-body)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[17px] font-medium text-[var(--hb-text-strong)]">{budgetStr}</p>
                  <button
                    onClick={() => { setBudgetInput(String(totalBudget / 10000)); setEditingBudget(true); }}
                    className="tap-area shrink-0 w-6 h-6 rounded flex items-center justify-center text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)] transition-colors"
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
        className="bg-white rounded-xl shadow-[var(--shadow-raised)] p-8 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#C4967E] to-[#9A6B62] flex items-center justify-center shadow-[var(--shadow-raised)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-serif-kr text-2xl font-light text-[var(--hb-text-strong)]">웨딩 스타일</h3>
            <p className="text-base text-[var(--hb-text-body)] font-light">
              아모라가 추천·예산 짤 때 쓰는 취향 정보예요
              <span className="ml-2 text-sm text-[var(--hb-text-muted)]">
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
            <p className="text-sm text-[var(--hb-text-muted)] mb-2">스타일</p>
            <div className="flex flex-wrap gap-2">
              {STYLE_OPTIONS.map((opt) => {
                const selected = draftPrefs.weddingStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updatePreferences({ weddingStyle: selected ? null : opt.value })}
                    className={`px-4 py-2 rounded-[6px] text-sm font-medium transition-all ${
                      selected
                        ? "bg-[var(--hb-primary)] text-white shadow-sm"
                        : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] hover:bg-[#EFEAE6]"
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
            <p className="text-sm text-[var(--hb-text-muted)] mb-2">우선순위 <span className="text-[var(--hb-text-muted)]/70">(여러 개 선택)</span></p>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_OPTIONS.map((opt) => {
                const selected = (draftPrefs.priorities ?? []).includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => togglePriority(opt.value)}
                    className={`px-4 py-2 rounded-[6px] text-sm font-medium transition-all ${
                      selected
                        ? "bg-[var(--hb-primary)] text-white shadow-sm"
                        : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] hover:bg-[#EFEAE6]"
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
            <p className="text-sm text-[var(--hb-text-muted)] mb-2">예산 성향</p>
            <div className="flex flex-wrap gap-2">
              {BUDGET_TENDENCY_OPTIONS.map((opt) => {
                const selected = draftPrefs.budgetTendency === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updatePreferences({ budgetTendency: selected ? null : opt.value })}
                    className={`px-4 py-2 rounded-[6px] text-sm font-medium transition-all ${
                      selected
                        ? "bg-[var(--hb-primary)] text-white shadow-sm"
                        : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] hover:bg-[#EFEAE6]"
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
            <p className="text-sm text-[var(--hb-text-muted)] mb-2">하객 규모</p>
            <div className="flex flex-wrap gap-2">
              {GUEST_COUNT_OPTIONS.map((opt) => {
                const selected = draftPrefs.guestCount === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updatePreferences({ guestCount: selected ? null : opt.value })}
                    className={`px-4 py-2 rounded-[6px] text-sm font-medium transition-all ${
                      selected
                        ? "bg-[var(--hb-primary)] text-white shadow-sm"
                        : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] hover:bg-[#EFEAE6]"
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

      {/* 커플 연결 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="bg-white rounded-xl shadow-[var(--shadow-raised)] p-8 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center shadow-[var(--shadow-raised)]">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-serif-kr text-2xl font-light text-[var(--hb-text-strong)]">커플 연결</h3>
            <p className="text-base text-[var(--hb-text-body)] font-light">파트너와 함께 준비 현황을 공유하세요</p>
          </div>
        </div>

        <div className="bg-[var(--hb-surface-hover)] rounded-xl p-5">
          {/* 코드가 보이는 유일한 조건은 `awaiting_partner`다. 연결이 끝나면
              /api/couple/code가 inviteCode: null을 주고 패널도 함께 사라진다 —
              패널 자체도 코드가 없으면 아무것도 그리지 않는다(이중 잠금). */}
          {phase === "awaiting_partner" && coupleCode && (
            <div className="mb-3">
              {/* 코드를 보내는 그 화면이 기한을 말해야 한다. main의 #136이 넣은
                  만료 안내를 패널 안으로 옮겨 붙인다 — 패널로 바꾸면서 그 문구를
                  통째로 지우면 실사용 코드가 경고 없이 죽는다. */}
              <InviteCodePanel
                code={coupleCode}
                variant="settings"
                notice={inviteWindowNotice}
                partnerJoinPurgeTotal={coupleConnection.partnerJoinPurgeTotal}
              />
              <button
                onClick={handleRegenerateCode}
                disabled={regenerating || !coupleConnection.canInvite}
                className="mt-2 text-sm text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)] transition-colors disabled:opacity-50"
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
                <p className="text-base text-[var(--hb-text-strong)] font-medium">{partnerName ?? "파트너"}</p>
                <p className="text-sm text-[#2E7D5A]">{partnerRole ? `${partnerRole} · ` : ""}연동 완료</p>
              </div>
              <Check className="w-6 h-6 text-[#2E7D5A]" />
            </div>
          ) : phase === "sealed_single" ? (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="w-12 h-12 flex-shrink-0 rounded-full bg-[var(--hb-surface-hover)] flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-[var(--hb-accent-hover)]" />
                </span>
                <div>
                  <p className="text-base font-medium text-[var(--hb-text-strong)]">이 커플 연결은 종료됐어요</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#746A63]">
                    연결 기록을 보호하기 위해 새 멤버를 이 커플에 초대할 수 없어요.
                    아래에서 새 커플로 다시 시작하거나 문제가 있으면 고객지원에 문의해 주세요.
                  </p>
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="mt-2 inline-flex text-sm font-medium text-[var(--hb-accent-hover)] underline underline-offset-4"
                  >
                    고객지원 문의
                  </a>
                </div>
              </div>
            </div>
          ) : phase === "awaiting_partner" ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-white shadow-sm">
              <div className="w-12 h-12 rounded-full bg-[var(--hb-surface-hover)] flex items-center justify-center">
                <User className="w-6 h-6 text-[var(--hb-text-muted)]" />
              </div>
              <div className="flex-1">
                <p className="text-base text-[var(--hb-text-body)] font-medium">파트너 초대 대기</p>
                <p className="text-sm text-[var(--hb-text-muted)]">위의 코드·링크·QR 중 편한 것으로 보내주세요</p>
              </div>
              <ChevronRight className="w-5 h-5 text-[var(--hb-text-muted)]" />
            </div>
          ) : regenerateError ? (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <p role="alert" className="text-sm leading-relaxed text-[#D95F5F]">
                {regenerateError}
              </p>
            </div>
          ) : connectionLookup === "loading" ? (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <p className="text-base font-medium text-[var(--hb-text-body)]">연결 상태를 불러오는 중이에요</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-muted)]">잠시만 기다려 주세요.</p>
            </div>
          ) : connectionLookup === "failed" ? (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <p className="text-base font-medium text-[var(--hb-text-strong)]">연결 상태를 불러오지 못했어요</p>
              <p className="mt-1 text-sm leading-relaxed text-[#746A63]">
                커플 연결이 잘못된 것은 아니에요. 연결 상태만 못 읽었으니 다시 시도해 주세요.
              </p>
              <button
                type="button"
                onClick={() => setConnectionRetryNonce((value) => value + 1)}
                className="mt-2 inline-flex text-sm font-medium text-[var(--hb-accent-hover)] underline underline-offset-4"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-[#E8DDD3] bg-white p-4 shadow-sm">
              <p className="text-base font-medium text-[var(--hb-text-strong)]">연결 상태를 확인하지 못했어요</p>
              <p className="mt-1 text-sm leading-relaxed text-[#746A63]">
                안전을 위해 새 멤버 초대는 잠시 멈췄어요. 화면을 새로고침하거나 고객지원에 문의해 주세요.
              </p>
              <a
                href={`mailto:${CONTACT.email}`}
                className="mt-2 inline-flex text-sm font-medium text-[var(--hb-accent-hover)] underline underline-offset-4"
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
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-10 h-10 shrink-0 rounded-full bg-[var(--hb-surface-hover)] flex items-center justify-center">
                  <RotateCcw className="w-5 h-5 text-[var(--hb-accent-hover)]" />
                </span>
                <span>
                  <span className="block text-base font-medium text-[var(--hb-text-strong)]">새 커플로 다시 시작</span>
                  <span className="block text-sm text-[var(--hb-text-muted)]">현재 커플 연결을 끊고 온보딩으로 돌아갑니다.</span>
                </span>
              </span>
              <ChevronRight className="w-5 h-5 text-[var(--hb-text-muted)] flex-shrink-0" />
            </button>
          )}
        </div>
      </motion.div>

      {/* 알림 설정 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="bg-white rounded-xl shadow-[var(--shadow-raised)] p-8 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center shadow-[var(--shadow-raised)]">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-serif-kr text-2xl font-light text-[var(--hb-text-strong)]">알림 설정</h3>
        </div>

        <div className="flex flex-col gap-1">
          {[
            { key: "schedule" as const, label: "일정 알림", desc: "앱 안 알림 목록에서 결혼식까지 남은 기간에 맞춰 확인할 일을 알려드려요." },
            { key: "budget" as const, label: "예산 알림", desc: "앱 안 알림 목록에서 전체 예산 범위를 정할 시점을 알려드려요." },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between px-5 py-4 rounded-xl hover:bg-[var(--hb-surface-hover)] transition-colors"
            >
              <div>
                <p className="text-[17px] font-medium text-[var(--hb-text-strong)]">{item.label}</p>
                <p className="text-sm text-[var(--hb-text-muted)] font-light">{item.desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={item.label}
                aria-checked={notifications[item.key]}
                onClick={() => toggleNotification(item.key)}
                className={`tap-area relative h-7 w-12 shrink-0 rounded-full transition-colors ${
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

        {!isDemo && <TodayOnePreferenceControl />}

        {hasLegacyCareConsent && (
          <div className="mt-5 border-t border-[#E8E0D8] px-5 pt-5">
            <p className="text-[17px] font-medium text-[var(--hb-text-strong)]">이전 이메일 수신 동의</p>
            <p className="mt-1 text-sm font-light leading-relaxed text-[var(--hb-text-muted)]">
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
        className="mb-6 overflow-hidden rounded-xl bg-white shadow-[var(--shadow-raised)]"
      >
        <Link
          {...weddingLinkProps("/settings/amora-style")}
          className="flex min-h-24 items-center gap-4 px-6 py-5 transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--hb-primary)]"
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--hb-primary)] shadow-[var(--shadow-raised)]">
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium text-[var(--hb-text-strong)]">
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
        className="mb-6 overflow-hidden rounded-xl bg-white shadow-[var(--shadow-raised)]"
      >
        <Link
          {...weddingLinkProps("/settings/amora-memory")}
          className="flex min-h-24 items-center gap-4 px-6 py-5 transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8F6662]"
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#8F6662] shadow-[var(--shadow-raised)]">
            <BrainCircuit className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium text-[var(--hb-text-strong)]">아모라가 기억하는 것</span>
            <span className="mt-0.5 block text-sm font-light leading-relaxed text-[#6D806E]">
              아모라가 무엇을 기억하는지 보고, 잘못 이해한 내용은 고치거나 지울 수 있어요
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
        className="bg-white rounded-xl shadow-[var(--shadow-raised)] overflow-hidden mb-6"
      >
        {[
          { label: "이용약관", href: "/terms" },
          { label: "개인정보 처리방침", href: "/privacy" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex w-full items-center justify-between px-6 py-5 transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#795252]/40"
          >
            <span className="text-[17px] text-[var(--hb-text-strong)]">{item.label}</span>
            <ChevronRight className="h-5 w-5 text-[var(--hb-text-muted)]" />
          </Link>
        ))}
        <a
          href={`mailto:${CONTACT.email}`}
          className="flex w-full items-center justify-between px-6 py-5 transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#795252]/40"
        >
          <span>
            <span className="block text-[17px] text-[var(--hb-text-strong)]">고객센터</span>
            <span className="mt-0.5 block text-sm text-[var(--hb-text-muted)]">{CONTACT.email}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-[var(--hb-text-muted)]" />
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
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-white text-red-400 text-base font-medium shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] transition-shadow"
        >
          <LogOut className="w-5 h-5" />
          로그아웃
        </button>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-[var(--hb-text-muted)] text-base font-light hover:text-red-400 transition-colors"
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5 py-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[420px] max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain bg-white rounded-xl p-6 sm:p-8 shadow-[var(--shadow-overlay)]"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-[var(--hb-surface-hover)] flex items-center justify-center">
                <RotateCcw className="w-6 h-6 text-[var(--hb-accent-hover)]" />
              </div>
              <h3 className="font-serif-kr text-2xl font-light text-[var(--hb-text-strong)] text-center mb-2">
                새 커플로 다시 시작할까요?
              </h3>
              {/* 되돌릴 수 없는 행동이다. 예전 문구는 "새 파트너 코드로 다시 연결할 수
                  있어요" 라고 해서 되돌릴 수 있는 일처럼 읽혔다. 끊긴 자리는 봉인되고
                  트리거가 재삽입을 영구 차단하므로 **지금 이 사람에게는 다시 돌아올 수
                  없다.** 모바일이 이미 정직하게 말한다 —
                  `apps/mobile/app/settings/index.tsx` 의 "이 작업은 되돌릴 수 없어요". */}
              <p className="text-sm text-[var(--hb-text-muted)] text-center leading-relaxed mb-6">
                현재 커플 연결과 함께 보던 준비 데이터를 분리하고 온보딩으로 돌아갑니다.
                <br />
                <span className="font-semibold text-[var(--hb-accent-hover)]">이 작업은 되돌릴 수 없어요</span>
                {" — "}지금 커플로는 다시 연결할 수 없습니다.
                <br />
                내 계정과 내가 쓴 대화는 유지돼요.
              </p>

              <label className="block text-sm text-[var(--hb-text-body)] mb-2">
                확인을 위해 <span className="font-semibold text-[var(--hb-accent-hover)]">초기화합니다</span>를 입력해주세요
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
                  className="flex-1 py-3 rounded-xl bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] font-medium bg-[#f3e9df] transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleResetWedding}
                  disabled={resetWeddingConfirmText !== "초기화합니다" || resettingWedding}
                  className="flex-1 py-3 rounded-xl bg-[var(--hb-primary)] text-white font-medium bg-[var(--hb-text-body)] transition-colors disabled:opacity-40"
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5 py-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[400px] max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain bg-white rounded-xl p-6 sm:p-8 shadow-[var(--shadow-overlay)]"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>

              <h3 className="font-serif-kr text-2xl font-light text-[var(--hb-text-strong)] text-center mb-2">
                정말 탈퇴하시겠어요?
              </h3>
              <p className="text-sm text-[var(--hb-text-muted)] text-center leading-relaxed mb-5">
                계정과 직접 소유한 데이터 삭제를 요청합니다.
              </p>

              {deletionIntakeOpen !== true && (
                <p
                  role="status"
                  className="mb-5 rounded-xl border border-[#E2D3C8] bg-[var(--hb-surface-page)] px-4 py-3 text-sm leading-relaxed text-[var(--hb-text-strong)]"
                >
                  {ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE}
                </p>
              )}

              {/* 되돌릴 수 없는 행동 앞에서는 무엇이 지워지고 무엇이 남는지
                  먼저 보여준다. 특히 "파트너 화면에는 남는다"는 사실은
                  사람이 놀라는 자리다. */}
              <div className="mb-5 rounded-xl bg-[var(--hb-surface-hover)] px-4 py-4">
                <p className="text-[13px] font-medium text-[var(--hb-text-body)] mb-2.5">
                  탈퇴하면 이렇게 돼요
                </p>
                <ul className="space-y-2">
                  {ACCOUNT_DELETION_FACTS.map((fact) => (
                    <li
                      key={fact.key}
                      className={`text-[12px] leading-[1.6] ${
                        fact.emphasis ? "font-medium text-[var(--hb-text-body)]" : "text-[var(--hb-text-muted)]"
                      }`}
                    >
                      {fact.text}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-[var(--hb-text-muted)]">
                  자세한 내용은{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
                    개인정보 처리방침
                  </a>
                  과{" "}
                  <a href="/terms" target="_blank" rel="noreferrer" className="underline">
                    이용약관
                  </a>
                  에 있어요.
                </p>
              </div>

              {deletionIntakeOpen === true && (
              <>

              {/* 탈퇴 사유 */}
              <div className="mb-5">
                <p className="text-sm text-[var(--hb-text-body)] mb-3">탈퇴 사유를 선택해주세요</p>
                <div className="space-y-2">
                  {DELETE_REASONS.map((r) => (
                    <label key={r.value} className={`flex items-center gap-2.5 px-3 py-3 rounded-xl cursor-pointer transition-colors ${
                      deleteReason === r.value ? "bg-[rgba(54,83,78,0.10)] ring-1 ring-[rgba(54,83,78,0.24)]" : "bg-[var(--hb-surface-hover)] bg-[#f3e9df]"
                    }`}>
                      <input
                        type="radio"
                        name="deleteReason"
                        value={r.value}
                        checked={deleteReason === r.value}
                        onChange={() => setDeleteReason(r.value)}
                        className="w-4 h-4 accent-[var(--hb-accent)]"
                      />
                      <span className="text-base text-[var(--hb-text-strong)]">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <p className="text-sm text-[var(--hb-text-body)] mb-2">
                  확인을 위해 <span className="font-semibold text-red-400">탈퇴합니다</span>를 입력해주세요
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="탈퇴합니다"
                  className="w-full px-4 py-3 rounded-xl bg-[var(--hb-surface-hover)] text-base text-[var(--hb-text-strong)] outline-none focus:ring-2 focus:ring-red-400/40 transition-all placeholder:text-[var(--hb-text-muted)]"
                />
              </div>
              </>
              )}

              {deleteError && (
                <p className="text-sm text-red-500 text-center mb-4">{deleteError}</p>
              )}

              <button
                onClick={handleDeleteAccount}
                disabled={
                  deleting
                  || (deletionIntakeOpen === true
                    && (deleteConfirmText !== "탈퇴합니다" || !deleteReason))
                }
                className="w-full py-3 rounded-xl text-base font-medium transition-all mb-3 bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {deleting
                  ? "요청 중..."
                  : deletionIntakeOpen === true
                    ? "계정 삭제 요청"
                    : "요청 방법 확인하기"}
              </button>

              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText("");
                  setDeleteError("");
                  setDeleteReason("");
                }}
                className="w-full py-3 rounded-xl text-base font-medium text-[var(--hb-text-body)] hover:text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)] transition-all"
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
