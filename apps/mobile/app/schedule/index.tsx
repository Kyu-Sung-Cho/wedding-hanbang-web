// 체크리스트/일정 화면 — 카테고리 체크 + 일정 CRUD
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  Animated, LayoutAnimation, AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, usePathname } from "expo-router";
import {
  ChevronDown, ChevronUp, CheckCircle2, Circle,
  Plus, X, CalendarDays, Clock, Ban, RotateCcw, AlertTriangle,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { sanitizeUserFacingScheduleMemo } from "@hanbang/shared";
import {
  calculatePlanningChecklistStatus,
  mergePlanningChecklist,
  stripPlanningChecklistNotes,
  summarizePlanningChecklist,
  type PlanningChecklistStatus,
  todayYmdInKst,
  upcomingYmdInKst,
} from "@hanbang/shared/utils";
import { supabase } from "@/lib/supabase";
import { apiFetchForExpectedUser } from "@/lib/api";
import {
  actOnScheduleApproval,
  fetchScheduleApprovalInbox,
  mergeScheduleApprovalInbox,
  parseScheduleMutationSubmission,
  type ScheduleApprovalAction,
  type ScheduleApprovalRequest,
  type ScheduleMutationSubmission,
} from "@/lib/scheduleApprovalInbox.mjs";
import {
  buildScheduleProgressPatch,
  cancelScheduleEventById,
  isCancelledScheduleEvent,
  isWritableJourneyRevision,
  replaceScheduleEventById,
  restoreScheduleEventById,
  validateScheduleEventDraft,
} from "@/lib/scheduleMutation.mjs";
import {
  createScheduleSessionFence,
  type ScheduleSessionToken,
} from "@/lib/scheduleSessionFence.mjs";
import { CATEGORY_CHECKLISTS, type ChecklistItem } from "@/constants/checklists";
import {
  AppHeader,
  AppText,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

/* ───── types ───── */
// 항목 타입은 공유 템플릿의 것을 그대로 쓴다. 예전에는 여기에 복사본을 두었는데,
// 공유 쪽에 `note`(놓치기 쉬운 것 한 줄)가 생겼을 때 이 사본만 뒤처져 화면에 그릴 수
// 없었다. 같은 것을 두 벌 적어두면 반드시 한쪽이 낡는다.

interface Category {
  key: string;
  label: string;
  items: ChecklistItem[];
  status: PlanningChecklistStatus;
}

interface ScheduleEvent {
  id: string;
  date: string;
  title: string;
  time?: string;
  categoryKey?: string;
  sourceKey?: string;
  momentType?: string;
  memo?: string;
  status?: "planned" | "completed" | "cancelled";
  cancellation?: {
    cancelledAt: string;
    cancelledByProfileId: string;
    reason?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

type ScheduleMutationErrorCode =
  | "stale"
  | "active_request"
  | "target_changed"
  | "invalid_snapshot"
  | "failed";

class ScheduleMutationError extends Error {
  constructor(readonly code: ScheduleMutationErrorCode) {
    super(code);
    this.name = "ScheduleMutationError";
  }
}

type ActionUrgency = "overdue" | "urgent" | "soon" | "active";

interface WeeklyAction {
  categoryKey: string;
  categoryLabel: string;
  nextItemLabel: string;
  urgency: ActionUrgency;
  deadlineLabel: string;
  daysUntilDeadline: number | null;
  percent: number;
}

const CATEGORY_OPTIONS = [
  ...CATEGORY_CHECKLISTS.map((category) => category.label),
  "기타",
];

function applyChecklistState(
  categories: Category[],
  progress: Record<string, Record<string, boolean>>,
  categoryKey: string,
  itemId: string,
  done: boolean,
) {
  return {
    categories: categories.map((category) =>
      category.key === categoryKey
        ? {
            ...category,
            items: category.items.map((item) =>
              item.id === itemId ? { ...item, done } : item
            ),
          }
        : category
    ),
    progress: {
      ...progress,
      [categoryKey]: { ...progress[categoryKey], [itemId]: done },
    },
  };
}

/* ───── helpers ───── */
function getUpcomingDays(n: number): string[] {
  // toISOString() 은 폰에서도 UTC 라 한국 새벽 0~9시에는 어제부터 시작했다.
  return upcomingYmdInKst(n);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const wedding = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  wedding.setHours(0, 0, 0, 0);
  return Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDday(dday: number | null): string {
  if (dday === null) return "D-—";
  if (dday === 0) return "D-Day";
  return dday > 0 ? `D-${dday}` : `D+${Math.abs(dday)}`;
}

function getPhaseLabel(dday: number | null): string {
  if (dday === null) return "결혼 예정일 설정 필요";
  if (dday < 0) return "결혼식 뒤 정리";
  if (dday <= 30) return "최종 점검";
  if (dday <= 90) return "마무리 준비";
  if (dday <= 180) return "세부 준비";
  if (dday <= 300) return "핵심 계약";
  return "초기 준비";
}

function getUrgencyLabel(urgency: ActionUrgency): string {
  if (urgency === "overdue") return "기본 확인 시점 지남";
  if (urgency === "urgent") return "이번 주 확인";
  if (urgency === "soon") return "확인 시점 가까움";
  return "확인해 볼 항목";
}

function getUrgencyTone(urgency: ActionUrgency): "neutral" | "rose" | "warning" | "danger" {
  if (urgency === "overdue") return "danger";
  if (urgency === "urgent") return "warning";
  if (urgency === "soon") return "rose";
  return "neutral";
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[d.getDay()] ?? "";
}

function createEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeScheduleEvent(event: unknown): ScheduleEvent | null {
  if (
    !isRecord(event)
    || typeof event.id !== "string"
    || event.id.trim().length === 0
    || typeof event.date !== "string"
    || typeof event.title !== "string"
    || event.title.trim().length === 0
    || (
      event.memo !== undefined
      && event.memo !== null
      && typeof event.memo !== "string"
    )
    || (
      event.status !== undefined
      && event.status !== "planned"
      && event.status !== "completed"
      && event.status !== "cancelled"
    )
    || (
      event.status === "cancelled"
        ? !isCancelledScheduleEvent(event)
        : event.cancellation !== undefined
    )
  ) {
    return null;
  }

  return {
    ...(event as unknown as ScheduleEvent),
    id: event.id,
    date: event.date,
    title: event.title,
    memo: sanitizeUserFacingScheduleMemo(event.memo),
  };
}

function readScheduleEventsForDisplay(progress: Record<string, unknown>): ScheduleEvent[] {
  if (progress.__events === undefined) return [];
  if (!Array.isArray(progress.__events)) {
    throw new ScheduleMutationError("invalid_snapshot");
  }
  const events = progress.__events.map(normalizeScheduleEvent);
  if (events.some((event) => event === null)) {
    throw new ScheduleMutationError("invalid_snapshot");
  }
  const validEvents = events as ScheduleEvent[];
  if (new Set(validEvents.map((event) => event.id)).size !== validEvents.length) {
    throw new ScheduleMutationError("invalid_snapshot");
  }
  return validEvents;
}

function readScheduleEventsForMutation(progress: Record<string, unknown>): ScheduleEvent[] {
  if (progress.__events === undefined) return [];
  if (!Array.isArray(progress.__events)) {
    throw new ScheduleMutationError("invalid_snapshot");
  }
  const events = progress.__events.map(normalizeScheduleEvent);
  if (events.some((event) => event === null)) {
    throw new ScheduleMutationError("invalid_snapshot");
  }
  const validEvents = events as ScheduleEvent[];
  if (new Set(validEvents.map((event) => event.id)).size !== validEvents.length) {
    throw new ScheduleMutationError("invalid_snapshot");
  }
  return validEvents;
}

async function fetchScheduleMutationSnapshot(coupleId: string) {
  const { data: journey, error } = await supabase
    .from("wedding_journeys")
    .select("progress, state_revision")
    .eq("couple_id", coupleId)
    .single();

  if (
    error
    || !journey
    || !isWritableJourneyRevision(journey.state_revision)
  ) {
    throw new ScheduleMutationError("invalid_snapshot");
  }

  return {
    progress: isRecord(journey.progress) ? journey.progress : {},
    stateRevision: journey.state_revision,
  };
}

async function submitScheduleEvents(
  expectedUserId: string,
  expectedRevision: number,
  updatedEvents: ScheduleEvent[],
): Promise<ScheduleMutationSubmission> {
  const response = await apiFetchForExpectedUser(expectedUserId, "/api/journey", {
    method: "PATCH",
    body: JSON.stringify(
      buildScheduleProgressPatch(expectedRevision, updatedEvents),
    ),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (
      response.status === 409
      && isRecord(payload)
      && payload.code === "PLAN_CHANGE_STALE"
    ) {
      throw new ScheduleMutationError("stale");
    }
    if (
      response.status === 409
      && isRecord(payload)
      && payload.code === "PLAN_CHANGE_ACTIVE_REQUEST"
    ) {
      throw new ScheduleMutationError("active_request");
    }
    throw new ScheduleMutationError("failed");
  }
  try {
    return parseScheduleMutationSubmission(payload);
  } catch {
    throw new ScheduleMutationError("failed");
  }
}

function showActiveScheduleRequestAlert() {
  Alert.alert(
    "먼저 대기 중인 일정 변경 요청을 확인해 주세요",
    "상대가 동의·거절하거나, 보낸 사람이 요청을 철회한 뒤 다시 변경할 수 있어요.",
  );
}

/* ───── main screen ───── */
export default function ScheduleScreen() {
  const pathname = usePathname();
  const checklistOnly = pathname.startsWith("/checklist");
  const [categories, setCategories] = useState<Category[]>([]);
  const [progress, setProgress] = useState<Record<string, Record<string, boolean>>>({});
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [approvalRequests, setApprovalRequests] = useState<ScheduleApprovalRequest[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState(false);
  const [scheduleDataError, setScheduleDataError] = useState<
    "integrity" | "load" | null
  >(null);
  const [approvalBusy, setApprovalBusy] = useState<{
    requestId: string;
    action: ScheduleApprovalAction;
  } | null>(null);

  // 진행률 애니메이션
  const progressAnim = useRef(new Animated.Value(0)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const scheduleSessionFenceRef = useRef(createScheduleSessionFence()).current;
  const scheduleLoadSequenceRef = useRef(0);
  const approvalLoadSequenceRef = useRef(0);
  const approvalActionSequenceRef = useRef(0);
  const approvalBusyRef = useRef<number | null>(null);
  const approvalIdentityRef = useRef<{ ownerId: string; coupleId: string } | null>(null);
  const hasFocusedRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  // event modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formCategoryKey, setFormCategoryKey] = useState("");
  const [formMemo, setFormMemo] = useState("");
  const [saving, setSaving] = useState(false);

  const clearIdentityBoundState = useCallback((nextProfileId: string | null) => {
    approvalIdentityRef.current = null;
    approvalLoadSequenceRef.current += 1;
    approvalActionSequenceRef.current += 1;
    approvalBusyRef.current = null;
    progressAnim.stopAnimation();
    progressAnim.setValue(0);
    setProfileId(nextProfileId);
    setCoupleId(null);
    setWeddingDate(null);
    setCategories([]);
    setProgress({});
    setEvents([]);
    setExpandedKey(null);
    setApprovalRequests([]);
    setApprovalError(false);
    setScheduleDataError(null);
    setApprovalLoading(false);
    setApprovalBusy(null);
    setRefreshing(false);
    setSaving(false);
    setModalVisible(false);
    setEditingEventId(null);
    setFormTitle("");
    setFormDate("");
    setFormTime("");
    setFormCategoryKey("");
    setFormMemo("");
  }, [progressAnim]);

  const loadApprovalRequests = useCallback(async (
    identity: { ownerId: string; coupleId: string },
    options?: { silent?: boolean },
  ) => {
    const loadSequence = approvalLoadSequenceRef.current + 1;
    approvalLoadSequenceRef.current = loadSequence;
    if (!options?.silent) setApprovalLoading(true);
    try {
      const result = await fetchScheduleApprovalInbox({
        apiFetch: (path, requestOptions) => apiFetchForExpectedUser(
          identity.ownerId,
          path,
          requestOptions,
        ),
        ownerId: identity.ownerId,
        coupleId: identity.coupleId,
      });
      const activeIdentity = approvalIdentityRef.current;
      if (
        approvalLoadSequenceRef.current === loadSequence
        && activeIdentity?.ownerId === identity.ownerId
        && activeIdentity.coupleId === identity.coupleId
      ) {
        setApprovalRequests((current) => mergeScheduleApprovalInbox(
          current,
          result,
        ));
        setApprovalError(result.partial);
        // 사라진 요청이 어떻게 끝났는지 말한다. 안 말하면 파트너가 거절한
        // 화면과 승인한 화면이 똑같다 — 둘 다 카드가 없어지고 일정은 그대로다.
        //
        // 백그라운드 폴링(`silent`)에서는 띄우지 않는다. 사용자가 보고 있지
        // 않을 때 모달을 띄우면 소음이고, 이 구분은 이 함수가 이미 쓰고 있다
        // (바로 위 `setApprovalLoading`). 사용자가 직접 새로고침한 순간에만
        // 말한다. 문구는 능동 경로가 쓰는 것을 그대로 쓴다.
        if (!options?.silent) {
          const resolved = (result.resolvedOutcomes ?? []).find(
            (outcome) => outcome.status === "rejected" || outcome.status === "applied",
          );
          if (resolved?.status === "rejected") {
            Alert.alert(
              "일정 변경을 반영하지 않았어요",
              "기존 일정은 그대로 유지돼요.",
            );
          } else if (resolved?.status === "applied") {
            Alert.alert(
              "일정 변경을 반영했어요",
              "두 사람의 확인이 끝나 최신 일정에 반영됐어요.",
            );
          }
        }
      }
    } catch {
      if (approvalLoadSequenceRef.current === loadSequence) {
        setApprovalError(true);
      }
    } finally {
      if (approvalLoadSequenceRef.current === loadSequence) {
        setApprovalLoading(false);
      }
    }
  }, []);

  const rememberPendingApproval = useCallback((
    outcome: ScheduleMutationSubmission,
    sessionToken: ScheduleSessionToken,
  ) => {
    if (
      outcome.status !== "pending_partner"
      || !scheduleSessionFenceRef.isCurrent(sessionToken)
    ) return;
    setApprovalRequests((current) => [{
      requestId: outcome.requestId,
      role: "requester",
      createdAt: new Date().toISOString(),
      summary: outcome.summary,
    }, ...current.filter((request) => request.requestId !== outcome.requestId)]);
    setApprovalError(false);
    const identity = approvalIdentityRef.current;
    if (identity) {
      void loadApprovalRequests(identity, { silent: true });
    }
  }, [loadApprovalRequests, scheduleSessionFenceRef]);

  const loadData = useCallback(async () => {
    const loadSequence = scheduleLoadSequenceRef.current + 1;
    scheduleLoadSequenceRef.current = loadSequence;
    let identity: { ownerId: string; coupleId: string } | null = null;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (scheduleLoadSequenceRef.current !== loadSequence) return null;

      if (!user) {
        scheduleSessionFenceRef.setOwner(null);
        clearIdentityBoundState(null);
        return null;
      }

      if (scheduleSessionFenceRef.setOwner(user.id)) {
        clearIdentityBoundState(user.id);
      } else {
        setProfileId(user.id);
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .single();
      if (scheduleLoadSequenceRef.current !== loadSequence) return null;

      if (!profile?.couple_id) {
        scheduleSessionFenceRef.clearCouple(user.id);
        clearIdentityBoundState(user.id);
        return null;
      }

      identity = { ownerId: user.id, coupleId: profile.couple_id };
      if (scheduleSessionFenceRef.setIdentity(identity.ownerId, identity.coupleId)) {
        clearIdentityBoundState(user.id);
      }
      setProfileId(identity.ownerId);
      setCoupleId(identity.coupleId);
      approvalIdentityRef.current = identity;

      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, progress, state_revision")
        .eq("couple_id", profile.couple_id)
        .single();
      if (scheduleLoadSequenceRef.current !== loadSequence) return null;

      if (
        journeyError
        || !journey
        || !isWritableJourneyRevision(journey.state_revision)
      ) {
        throw new ScheduleMutationError("invalid_snapshot");
      }

      setWeddingDate(journey.wedding_date ?? null);
      const prog = isRecord(journey.progress) ? journey.progress : {};

      // 웹과 동일한 progress 구조:
      // progress[catKey] = { category, status, checklist: [{id, label, done}, ...], cost?, budget? }
      // CATEGORY_CHECKLISTS 상수가 소스 → DB의 checklist 배열에서 done 상태만 오버레이
      const cats: Category[] = [];
      const progMap: Record<string, Record<string, boolean>> = {};

      for (const cat of CATEGORY_CHECKLISTS) {
        const dbCatData = prog[cat.key] as {
          status?: string;
          checklist?: Array<{ id: string; label?: string; done: boolean }>;
          [key: string]: unknown;
        } | undefined;

        // DB의 checklist 배열에서 done 상태 매핑
        const dbDoneMap: Record<string, boolean> = {};
        if (dbCatData?.checklist && Array.isArray(dbCatData.checklist)) {
          for (const item of dbCatData.checklist) {
            dbDoneMap[item.id] = !!item.done;
          }
        }
        // 레거시: 플랫 구조 { meeting_01: true } 호환
        if (!dbCatData?.checklist && dbCatData && typeof dbCatData === "object") {
          for (const [k, v] of Object.entries(dbCatData)) {
            if (typeof v === "boolean") dbDoneMap[k] = v;
          }
        }

        const savedChecklist = Array.isArray(dbCatData?.checklist)
          ? dbCatData.checklist.map((item) => ({
              id: item.id,
              label: item.label ?? cat.items.find((templateItem) => templateItem.id === item.id)?.label ?? "이전 준비 항목",
              done: item.done === true,
            }))
          : Object.entries(dbDoneMap).map(([id, done]) => ({
              id,
              label: cat.items.find((item) => item.id === id)?.label ?? "이전 준비 항목",
              done,
            }));
        const checkItems = mergePlanningChecklist(cat.items, savedChecklist);
        const itemStates: Record<string, boolean> = Object.fromEntries(
          checkItems.map((item) => [item.id, item.done]),
        );
        const status: PlanningChecklistStatus = dbCatData?.status === "not_applicable"
          ? "not_applicable"
          : calculatePlanningChecklistStatus(checkItems);

        cats.push({ key: cat.key, label: cat.label, items: checkItems, status });
        progMap[cat.key] = itemStates;
      }

      setCategories(cats);
      setProgress(progMap);

      // 전체 진행률 애니메이션
      if (cats.length > 0) {
        const totalPercent = summarizePlanningChecklist(
          CATEGORY_CHECKLISTS,
          prog as Record<string, { status?: PlanningChecklistStatus; checklist?: ChecklistItem[] }>,
        ).percent;
        Animated.timing(progressAnim, {
          toValue: totalPercent,
          duration: 800,
          useNativeDriver: false,
        }).start();
      }

      // 이벤트 추출
      setEvents(readScheduleEventsForDisplay(prog));
      setScheduleDataError(null);
      return identity;
    } catch (err) {
      if (scheduleLoadSequenceRef.current !== loadSequence) return null;
      console.error("일정 로드 오류:", err);
      setEvents([]);
      setScheduleDataError(
        err instanceof ScheduleMutationError && err.code === "invalid_snapshot"
          ? "integrity"
          : "load",
      );
      return identity;
    } finally {
      if (scheduleLoadSequenceRef.current === loadSequence) {
        setLoading(false);
      }
    }
  }, [clearIdentityBoundState, progressAnim, scheduleSessionFenceRef]);

  useEffect(() => {
    loadData().then((identity) => {
      if (identity) loadApprovalRequests(identity);
    });
  }, [loadApprovalRequests, loadData]);

  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const nextOwnerId = session?.user?.id ?? null;
        if (!scheduleSessionFenceRef.setOwner(nextOwnerId)) return;

        scheduleLoadSequenceRef.current += 1;
        clearIdentityBoundState(nextOwnerId);
        if (reloadTimer !== null) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          void loadData().then((identity) => {
            if (identity) void loadApprovalRequests(identity);
          });
        }, 0);
      },
    );

    return () => {
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      subscription.unsubscribe();
    };
  }, [
    clearIdentityBoundState,
    loadApprovalRequests,
    loadData,
    scheduleSessionFenceRef,
  ]);

  // Realtime: 웹에서 체크리스트 변경 시 자동 갱신
  useEffect(() => {
    if (!coupleId) return;

    const channel = supabase.channel(`schedule:${coupleId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'wedding_journeys',
        filter: `couple_id=eq.${coupleId}`,
      }, () => {
        loadData().then((identity) => {
          if (identity) loadApprovalRequests(identity, { silent: true });
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [coupleId, loadApprovalRequests, loadData]);

  const refreshScheduleAndApprovals = useCallback(async (
    options?: { silentApproval?: boolean },
  ) => {
    const identity = await loadData();
    if (identity) {
      await loadApprovalRequests(identity, {
        silent: options?.silentApproval,
      });
    }
  }, [loadApprovalRequests, loadData]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      void refreshScheduleAndApprovals({ silentApproval: true });
    }, [refreshScheduleAndApprovals]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && previousState !== "active") {
        void refreshScheduleAndApprovals({ silentApproval: true });
      }
    });
    return () => subscription.remove();
  }, [refreshScheduleAndApprovals]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshScheduleAndApprovals({ silentApproval: true });
    } finally {
      setRefreshing(false);
    }
  }, [refreshScheduleAndApprovals]);

  /* ── 체크 토글 ── */
  async function toggleItem(categoryKey: string, itemId: string, currentDone: boolean) {
    if (categories.find((category) => category.key === categoryKey)?.status === "not_applicable") {
      Alert.alert("준비 목록에서 제외된 분야예요", "먼저 ‘다시 준비 목록에 넣기’를 눌러 주세요.");
      return;
    }
    const sessionToken = scheduleSessionFenceRef.capture();
    if (
      !coupleId
      || !profileId
      || !sessionToken
      || sessionToken.coupleId !== coupleId
      || sessionToken.ownerId !== profileId
    ) return;
    const mutationCoupleId = sessionToken.coupleId;

    const nextDone = !currentDone;
    const previousCategories = categories;
    const previousProgress = progress;

    // 레이아웃 애니메이션
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    const optimistic = applyChecklistState(
      previousCategories,
      previousProgress,
      categoryKey,
      itemId,
      nextDone,
    );
    setCategories(optimistic.categories);
    setProgress(optimistic.progress);

    // 웹과 동일한 구조로 DB 업데이트
    try {
      const snapshot = await fetchScheduleMutationSnapshot(mutationCoupleId);
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      const currentProgress = { ...snapshot.progress };
      const catTemplate = CATEGORY_CHECKLISTS.find((c) => c.key === categoryKey);
      if (!catTemplate) {
        throw new Error("category template not found");
      }

      // 기존 DB의 카테고리 데이터
      const existing = currentProgress[categoryKey] as Record<string, unknown> | undefined;
      const existingChecklist = (existing?.checklist as Array<{ id: string; label: string; done: boolean }>) ?? [];

      // 체크리스트 배열 업데이트 (없으면 상수에서 생성)
      const updatedChecklist = mergePlanningChecklist(catTemplate.items, existingChecklist).map((item) =>
        item.id === itemId ? { ...item, done: nextDone } : item,
      );

      // 전체 완료 상태 계산
      const allDone = updatedChecklist.every((i) => i.done);
      const anyDone = updatedChecklist.some((i) => i.done);
      const status = allDone ? "completed" : anyDone ? "in_progress" : "not_started";

      currentProgress[categoryKey] = {
        ...(existing ?? {}),
        category: categoryKey,
        status,
        // 항목 안내(note)는 템플릿이 소유한 제품 문구다. 사용자 행에 복제하지 않는다.
        checklist: stripPlanningChecklistNotes(updatedChecklist),
      };

      const res = await apiFetchForExpectedUser(
        sessionToken.ownerId,
        "/api/journey",
        {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: snapshot.stateRevision,
          progress_patch: { [categoryKey]: currentProgress[categoryKey] },
        }),
        },
      );
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;

      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
        if (
          res.status === 409
          && isRecord(payload)
          && payload.code === "PLAN_CHANGE_STALE"
        ) {
          throw new ScheduleMutationError("stale");
        }
        if (
          res.status === 409
          && isRecord(payload)
          && payload.code === "PLAN_CHANGE_ACTIVE_REQUEST"
        ) {
          throw new ScheduleMutationError("active_request");
        }
        throw new ScheduleMutationError("failed");
      }

      const payload: unknown = await res.json().catch(() => null);
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      let outcome: ScheduleMutationSubmission;
      try {
        outcome = parseScheduleMutationSubmission(payload);
      } catch {
        throw new ScheduleMutationError("failed");
      }
      rememberPendingApproval(outcome, sessionToken);
      if (outcome.status === "pending_partner") {
        setCategories(previousCategories);
        setProgress(previousProgress);
        Alert.alert(
          "파트너 확인을 기다리고 있어요",
          "파트너가 동의하면 체크 상태에 반영돼요.",
        );
        await loadData();
        return;
      }

      await loadData();
    } catch (error) {
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      setCategories(previousCategories);
      setProgress(previousProgress);
      if (
        error instanceof ScheduleMutationError
        && error.code === "active_request"
      ) {
        showActiveScheduleRequestAlert();
        const identity = approvalIdentityRef.current;
        if (identity) await loadApprovalRequests(identity);
      } else if (error instanceof ScheduleMutationError && error.code === "stale") {
        Alert.alert(
          "최신 상태를 다시 불러왔어요",
          "그 사이 파트너가 준비 정보를 바꿨어요. 최신 내용에서 다시 선택해 주세요.",
        );
        await loadData();
      } else {
        Alert.alert("오류", "체크 상태를 저장하지 못했어요. 다시 시도해주세요.");
      }
    }
  }

  async function toggleCategoryApplicability(categoryKey: string) {
    const sessionToken = scheduleSessionFenceRef.capture();
    if (!sessionToken || !scheduleSessionFenceRef.isCurrent(sessionToken)) return;
    try {
      const snapshot = await fetchScheduleMutationSnapshot(sessionToken.coupleId);
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      const template = CATEGORY_CHECKLISTS.find((category) => category.key === categoryKey);
      if (!template) throw new ScheduleMutationError("failed");
      const existing = isRecord(snapshot.progress[categoryKey])
        ? snapshot.progress[categoryKey]
        : {};
      const saved = Array.isArray(existing.checklist)
        ? existing.checklist.filter(isRecord).map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            label: typeof item.label === "string" ? item.label : "이전 준비 항목",
            done: item.done === true,
          })).filter((item) => item.id.length > 0)
        : [];
      const checklist = mergePlanningChecklist(template.items, saved);
      const wasSkipped = existing.status === "not_applicable";
      const nextCategory = {
        ...existing,
        category: categoryKey,
        status: wasSkipped ? calculatePlanningChecklistStatus(checklist) : "not_applicable",
        checklist: stripPlanningChecklistNotes(checklist),
      };
      const response = await apiFetchForExpectedUser(sessionToken.ownerId, "/api/journey", {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: snapshot.stateRevision,
          progress_patch: { [categoryKey]: nextCategory },
        }),
      });
      if (!response.ok) throw new ScheduleMutationError(response.status === 409 ? "stale" : "failed");
      const outcome = parseScheduleMutationSubmission(await response.json());
      rememberPendingApproval(outcome, sessionToken);
      Alert.alert(
        outcome.status === "pending_partner" ? "파트너 확인을 요청했어요" : wasSkipped ? "준비 목록에 다시 넣었어요" : "준비 목록에서 제외했어요",
        outcome.status === "pending_partner"
          ? "파트너가 동의하면 상태에 반영돼요."
          : wasSkipped
            ? "이전에 체크한 내용은 그대로 남아 있어요."
            : "진행률과 마감 알림에서 빠져요. 언제든 되돌릴 수 있어요.",
      );
      await loadData();
    } catch (error) {
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      if (error instanceof ScheduleMutationError && error.code === "active_request") {
        showActiveScheduleRequestAlert();
      } else if (error instanceof ScheduleMutationError && error.code === "stale") {
        Alert.alert("최신 상태를 다시 불러왔어요", "최신 내용에서 다시 선택해 주세요.");
      } else {
        Alert.alert("오류", "체크리스트 상태를 저장하지 못했어요. 다시 시도해 주세요.");
      }
      await loadData();
    }
  }

  function getCategoryStats(key: string) {
    const items = progress[key] ?? {};
    const total = Object.keys(items).length;
    const done = Object.values(items).filter(Boolean).length;
    const skipped = categories.find((category) => category.key === key)?.status === "not_applicable";
    return { total, done, skipped, percent: skipped || total === 0 ? 0 : Math.round((done / total) * 100) };
  }

  function getWeeklyActions(dday: number | null): WeeklyAction[] {
    if (dday !== null && dday < 0) return [];

    const actionCandidates = CATEGORY_CHECKLISTS.flatMap((template) => {
      const stats = getCategoryStats(template.key);
      if (stats.skipped || stats.percent >= 100) return [];

      if (dday !== null && dday > template.ddayStart) return [];

      const category = categories.find((c) => c.key === template.key);
      const nextItem = category?.items.find((item) => !item.done);
      const daysUntilDeadline = dday === null ? null : dday - template.ddayDeadline;

      let urgency: ActionUrgency = "active";
      if (daysUntilDeadline !== null) {
        if (daysUntilDeadline < 0) urgency = "overdue";
        else if (daysUntilDeadline <= 7) urgency = "urgent";
        else if (daysUntilDeadline <= 30) urgency = "soon";
      }

      const deadlineLabel =
        daysUntilDeadline === null
          ? "결혼식 날짜를 넣으면 기본 확인 순서를 정리해요"
          : daysUntilDeadline < 0
            ? `기본 확인 시점에서 ${Math.abs(daysUntilDeadline)}일 지났어요`
            : daysUntilDeadline === 0
              ? "오늘이 기본 확인 시점이에요"
              : `기본 확인 시점까지 ${daysUntilDeadline}일`;

      return [{
        categoryKey: template.key,
        categoryLabel: template.label,
        nextItemLabel: nextItem?.label ?? `${template.label} 체크리스트 점검`,
        urgency,
        deadlineLabel,
        daysUntilDeadline,
        percent: stats.percent,
      }];
    });

    const urgencyRank: Record<ActionUrgency, number> = {
      overdue: 0,
      urgent: 1,
      soon: 2,
      active: 3,
    };

    return actionCandidates
      .sort((a, b) => {
        const urgencyDiff = urgencyRank[a.urgency] - urgencyRank[b.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        if (a.daysUntilDeadline !== null && b.daysUntilDeadline !== null) {
          return a.daysUntilDeadline - b.daysUntilDeadline;
        }
        return a.percent - b.percent;
      })
      .slice(0, 3);
  }

  /* ── 이벤트 모달 ── */
  function openAddEventModal() {
    setEditingEventId(null);
    // 저장되는 값이다. UTC 로 읽으면 한국 새벽에 **어제 날짜로 일정이 저장된다.**
    const today = todayYmdInKst();
    setFormTitle("");
    setFormDate(today);
    setFormTime("");
    setFormCategoryKey("");
    setFormMemo("");
    setModalVisible(true);
  }

  function openEditEventModal(eventId: string) {
    const evt = events.find((event) => event.id === eventId);
    if (!evt) {
      Alert.alert(
        "일정이 바뀌었어요",
        "최신 일정 목록을 다시 불러온 뒤 선택해 주세요.",
      );
      loadData();
      return;
    }
    if (isCancelledScheduleEvent(evt)) {
      Alert.alert(
        "취소된 일정",
        "취소됨 구역에서 먼저 복원 요청한 뒤 수정해 주세요.",
      );
      return;
    }
    setEditingEventId(eventId);
    setFormTitle(evt.title);
    setFormDate(evt.date);
    setFormTime(evt.time ?? "");
    setFormCategoryKey(evt.categoryKey ?? "");
    setFormMemo(sanitizeUserFacingScheduleMemo(evt.memo) ?? "");
    setModalVisible(true);
  }

  async function saveEvent() {
    const sessionToken = scheduleSessionFenceRef.capture();
    if (
      !coupleId
      || !profileId
      || saving
      || !sessionToken
      || sessionToken.coupleId !== coupleId
      || sessionToken.ownerId !== profileId
    ) return;
    const mutationCoupleId = sessionToken.coupleId;
    const draftValidation = validateScheduleEventDraft({
      date: formDate,
      title: formTitle,
      time: formTime,
      categoryKey: formCategoryKey,
      memo: formMemo,
    });
    if (!draftValidation.ok) {
      const message = {
        draft: "일정 내용을 다시 확인해 주세요.",
        title: "일정 제목을 1자 이상 500자 이내로 입력해 주세요.",
        date: "날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.",
        time: "시간을 00:00~23:59 형식으로 입력해 주세요.",
        memo: "메모는 2,000자 이내로 입력해 주세요.",
        categoryKey: "카테고리를 다시 선택해 주세요.",
      }[draftValidation.field];
      Alert.alert("입력 확인", message);
      return;
    }

    setSaving(true);
    try {
      const snapshot = await fetchScheduleMutationSnapshot(mutationCoupleId);
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      const currentEvents = readScheduleEventsForMutation(snapshot.progress);

      const now = new Date().toISOString();
      const existingEvent = editingEventId === null
        ? null
        : currentEvents.find((event) => event.id === editingEventId) ?? null;
      if (editingEventId !== null && !existingEvent) {
        throw new ScheduleMutationError("target_changed");
      }
      if (existingEvent && isCancelledScheduleEvent(existingEvent)) {
        throw new ScheduleMutationError("target_changed");
      }
      const newEvent: ScheduleEvent = {
        ...(existingEvent ?? {}),
        id: existingEvent?.id ?? createEventId(),
        ...draftValidation.value,
        createdAt: existingEvent?.createdAt ?? now,
        updatedAt: now,
      };

      let updatedEvents: ScheduleEvent[];
      if (editingEventId !== null) {
        const mutation = replaceScheduleEventById(
          currentEvents,
          editingEventId,
          newEvent,
        );
        if (mutation.status !== "updated") {
          throw new ScheduleMutationError("target_changed");
        }
        updatedEvents = mutation.events;
      } else {
        updatedEvents = [...currentEvents, newEvent];
      }

      updatedEvents.sort((a, b) => a.date.localeCompare(b.date));

      const outcome = await submitScheduleEvents(
        sessionToken.ownerId,
        snapshot.stateRevision,
        updatedEvents,
      );
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      rememberPendingApproval(outcome, sessionToken);

      setModalVisible(false);
      setEditingEventId(null);
      if (outcome.status === "pending_partner") {
        Alert.alert(
          "파트너 확인을 기다리고 있어요",
          "파트너가 동의하면 일정에 반영돼요. 승인 전에는 기존 일정이 유지돼요.",
        );
      }
      await loadData();
    } catch (error) {
      if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
      if (
        error instanceof ScheduleMutationError
        && error.code === "active_request"
      ) {
        showActiveScheduleRequestAlert();
        const identity = approvalIdentityRef.current;
        if (identity) await loadApprovalRequests(identity);
      } else if (
        error instanceof ScheduleMutationError
        && (error.code === "stale" || error.code === "target_changed")
      ) {
        setModalVisible(false);
        setEditingEventId(null);
        Alert.alert(
          "일정이 바뀌었어요",
          "그 사이 파트너가 일정을 변경했어요. 최신 목록을 확인한 뒤 다시 시도해 주세요.",
        );
        await loadData();
      } else if (
        error instanceof ScheduleMutationError
        && error.code === "invalid_snapshot"
      ) {
        Alert.alert(
          "일정 정보를 확인해 주세요",
          "저장된 일정 중 안전하게 확인할 수 없는 항목이 있어 변경하지 않았어요.",
        );
        await loadData();
      } else {
        Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
      }
    } finally {
      if (scheduleSessionFenceRef.isCurrent(sessionToken)) {
        setSaving(false);
      }
    }
  }

  function requestEventCancellation() {
    const sessionToken = scheduleSessionFenceRef.capture();
    if (
      editingEventId === null
      || !coupleId
      || !profileId
      || saving
      || !sessionToken
      || sessionToken.coupleId !== coupleId
      || sessionToken.ownerId !== profileId
    ) return;
    const targetEventId = editingEventId;
    Alert.alert("일정 취소 요청", "이 일정의 취소를 요청할까요? 기록은 완전히 삭제되지 않아요.", [
      { text: "닫기", style: "cancel" },
      {
        text: "취소 요청 보내기",
        onPress: async () => {
          if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
          setSaving(true);
          try {
            const snapshot = await fetchScheduleMutationSnapshot(sessionToken.coupleId);
            if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
            const currentEvents = readScheduleEventsForMutation(snapshot.progress);
            const mutation = cancelScheduleEventById(
              currentEvents,
              targetEventId,
              {
                cancelledAt: new Date().toISOString(),
                cancelledByProfileId: sessionToken.ownerId,
              },
            );
            if (mutation.status !== "updated") {
              throw new ScheduleMutationError("target_changed");
            }

            const outcome = await submitScheduleEvents(
              sessionToken.ownerId,
              snapshot.stateRevision,
              mutation.events,
            );
            if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
            rememberPendingApproval(outcome, sessionToken);
            setModalVisible(false);
            setEditingEventId(null);
            if (outcome.status === "pending_partner") {
              Alert.alert(
                "취소 요청을 보냈어요",
                "파트너 승인 전 기존 일정 유지 상태예요.",
              );
            } else {
              Alert.alert(
                "일정 취소됨",
                "기록은 취소됨 구역에 남아 있고 다시 복원 요청할 수 있어요.",
              );
            }
            await loadData();
          } catch (error) {
            if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
            if (
              error instanceof ScheduleMutationError
              && error.code === "active_request"
            ) {
              showActiveScheduleRequestAlert();
              const identity = approvalIdentityRef.current;
              if (identity) await loadApprovalRequests(identity);
            } else if (
              error instanceof ScheduleMutationError
              && (error.code === "stale" || error.code === "target_changed")
            ) {
              setModalVisible(false);
              setEditingEventId(null);
              Alert.alert(
                "일정이 바뀌었어요",
                "그 사이 파트너가 일정을 변경했어요. 최신 목록을 확인해 주세요.",
              );
              await loadData();
            } else if (
              error instanceof ScheduleMutationError
              && error.code === "invalid_snapshot"
            ) {
              Alert.alert(
                "일정 정보를 확인해 주세요",
                "저장된 일정 중 안전하게 확인할 수 없는 항목이 있어 취소 요청을 보내지 않았어요.",
              );
              await loadData();
            } else {
              Alert.alert("오류", "일정 취소 요청에 실패했어요. 다시 시도해 주세요.");
            }
          } finally {
            if (scheduleSessionFenceRef.isCurrent(sessionToken)) {
              setSaving(false);
            }
          }
        },
      },
    ]);
  }

  function requestEventRestore(eventId: string) {
    const sessionToken = scheduleSessionFenceRef.capture();
    if (
      !coupleId
      || !profileId
      || saving
      || !sessionToken
      || sessionToken.coupleId !== coupleId
      || sessionToken.ownerId !== profileId
    ) return;
    Alert.alert("일정 복원 요청", "이 일정을 예정 상태로 복원할까요?", [
      { text: "닫기", style: "cancel" },
      {
        text: "복원 요청",
        onPress: async () => {
          if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
          setSaving(true);
          try {
            const snapshot = await fetchScheduleMutationSnapshot(sessionToken.coupleId);
            if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
            const currentEvents = readScheduleEventsForMutation(snapshot.progress);
            const mutation = restoreScheduleEventById(
              currentEvents,
              eventId,
              new Date().toISOString(),
            );
            if (mutation.status !== "updated") {
              throw new ScheduleMutationError("target_changed");
            }
            const outcome = await submitScheduleEvents(
              sessionToken.ownerId,
              snapshot.stateRevision,
              mutation.events,
            );
            if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
            rememberPendingApproval(outcome, sessionToken);
            if (outcome.status === "pending_partner") {
              Alert.alert(
                "복원 요청을 보냈어요",
                "파트너 승인 전에는 취소됨 상태가 유지돼요.",
              );
            } else {
              Alert.alert("일정 복원됨", "예정 상태로 복원했어요.");
            }
            await loadData();
          } catch (error) {
            if (!scheduleSessionFenceRef.isCurrent(sessionToken)) return;
            if (
              error instanceof ScheduleMutationError
              && error.code === "active_request"
            ) {
              showActiveScheduleRequestAlert();
              const identity = approvalIdentityRef.current;
              if (identity) await loadApprovalRequests(identity);
            } else if (
              error instanceof ScheduleMutationError
              && (error.code === "stale" || error.code === "target_changed")
            ) {
              Alert.alert(
                "일정이 바뀌었어요",
                "최신 목록을 확인한 뒤 다시 복원 요청해 주세요.",
              );
            } else {
              Alert.alert("오류", "일정 복원 요청에 실패했어요. 다시 시도해 주세요.");
            }
            await loadData();
          } finally {
            if (scheduleSessionFenceRef.isCurrent(sessionToken)) {
              setSaving(false);
            }
          }
        },
      },
    ]);
  }

  async function executeApprovalAction(
    request: ScheduleApprovalRequest,
    action: ScheduleApprovalAction,
    confirmedSessionToken?: ScheduleSessionToken,
  ) {
    const sessionToken = confirmedSessionToken ?? scheduleSessionFenceRef.capture();
    if (
      !coupleId
      || !profileId
      || approvalBusyRef.current !== null
      || !sessionToken
      || !scheduleSessionFenceRef.isCurrent(sessionToken)
      || sessionToken.coupleId !== coupleId
      || sessionToken.ownerId !== profileId
    ) return;

    const approvalOperationId = approvalActionSequenceRef.current + 1;
    approvalActionSequenceRef.current = approvalOperationId;
    approvalBusyRef.current = approvalOperationId;
    setApprovalBusy({ requestId: request.requestId, action });
    try {
      const result = await actOnScheduleApproval({
        apiFetch: (path, requestOptions) => apiFetchForExpectedUser(
          sessionToken.ownerId,
          path,
          requestOptions,
        ),
        coupleId: sessionToken.coupleId,
        request,
        action,
      });
      if (
        !scheduleSessionFenceRef.isCurrent(sessionToken)
        || approvalBusyRef.current !== approvalOperationId
      ) return;
      setApprovalRequests((current) => current.filter(
        (item) => item.requestId !== request.requestId,
      ));

      if (result.status === "applied") {
        Alert.alert(
          "일정 변경을 반영했어요",
          "두 사람의 확인이 끝나 최신 일정에 반영됐어요.",
        );
        await loadData();
      } else if (result.status === "rejected") {
        Alert.alert(
          "일정 변경을 반영하지 않았어요",
          "기존 일정은 그대로 유지돼요.",
        );
      } else if (result.status === "withdrawn") {
        Alert.alert(
          "보낸 요청을 철회했어요",
          "파트너가 확인하기 전 요청을 닫았고 기존 일정은 그대로예요.",
        );
      } else if (result.status === "conflict") {
        Alert.alert(
          "요청 상태가 바뀌었어요",
          "다른 기기나 파트너가 먼저 처리했을 수 있어 최신 상태를 다시 불러왔어요.",
        );
        await loadData();
      } else if (result.status === "terminal") {
        if (result.terminalStatus === "applied") await loadData();
        if (
          !scheduleSessionFenceRef.isCurrent(sessionToken)
          || approvalBusyRef.current !== approvalOperationId
        ) return;
        Alert.alert(
          result.terminalStatus === "applied"
            ? "이미 반영된 요청이에요"
            : "이미 닫힌 요청이에요",
          "최신 일정과 요청 상태를 다시 불러왔어요.",
        );
      }
    } catch {
      if (
        !scheduleSessionFenceRef.isCurrent(sessionToken)
        || approvalBusyRef.current !== approvalOperationId
      ) return;
      Alert.alert(
        "처리 상태를 확인해 주세요",
        "요청 결과를 확정하지 못했어요. 중복 처리하지 않고 최신 상태를 다시 확인할게요.",
      );
    } finally {
      if (approvalBusyRef.current === approvalOperationId) {
        approvalBusyRef.current = null;
        if (scheduleSessionFenceRef.isCurrent(sessionToken)) {
          setApprovalBusy(null);
          const identity = approvalIdentityRef.current;
          if (
            identity?.ownerId === sessionToken.ownerId
            && identity.coupleId === sessionToken.coupleId
          ) {
            await loadApprovalRequests(identity, { silent: true });
          }
        }
      }
    }
  }

  function requestApprovalAction(
    request: ScheduleApprovalRequest,
    action: ScheduleApprovalAction,
  ) {
    const sessionToken = scheduleSessionFenceRef.capture();
    if (
      !sessionToken
      || !scheduleSessionFenceRef.isCurrent(sessionToken)
      || sessionToken.coupleId !== coupleId
      || sessionToken.ownerId !== profileId
    ) return;
    if (action === "approve") {
      void executeApprovalAction(request, action, sessionToken);
      return;
    }
    const withdrawing = action === "withdraw";
    Alert.alert(
      withdrawing ? "요청을 철회할까요?" : "이 변경을 반영하지 않을까요?",
      withdrawing
        ? "철회하면 파트너의 확인함에서 닫히고 기존 일정이 유지돼요."
        : "반영하지 않으면 두 사람의 기존 일정이 유지돼요.",
      [
        { text: "계속 확인", style: "cancel" },
        {
          text: withdrawing ? "요청 철회" : "반영하지 않기",
          style: "destructive",
          onPress: () => {
            void executeApprovalAction(request, action, sessionToken);
          },
        },
      ],
    );
  }

  function handleExpandToggle(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKey(expandedKey === key ? null : key);
  }

  /* ── 임박 일정 (7일 이내) ── */
  const next7Days = getUpcomingDays(7);
  const activeEvents = events.filter((event) => !isCancelledScheduleEvent(event));
  const cancelledEvents = events.filter(isCancelledScheduleEvent);
  const upcomingEvents = activeEvents
    .filter((e) => next7Days.includes(e.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 전체 진행률 계산
  const overallPercent = summarizePlanningChecklist(
    categories.map((category) => ({ key: category.key, items: category.items })),
    Object.fromEntries(categories.map((category) => [category.key, {
      status: category.status,
      checklist: category.items,
    }])),
  ).percent;
  const dday = calcDday(weddingDate);
  const weeklyActions = getWeeklyActions(dday);
  const overdueCount = weeklyActions.filter((action) => action.urgency === "overdue").length;

  // 진행바 width 보간
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingState label="체크리스트를 정리하고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title={checklistOnly ? "웨딩 체크리스트" : "일정"}
        subtitle={checklistOnly ? "부모님 첫 만남부터 신혼집까지 하나씩 확인해요" : "두 사람의 날짜와 약속을 관리해요"}
        onBack={() => router.back()}
        right={!checklistOnly ? (
          <Pressable
            onPress={openAddEventModal}
            hitSlop={12}
            disabled={scheduleDataError !== null}
            accessibilityRole="button"
            accessibilityLabel="일정 추가"
            accessibilityState={{ disabled: scheduleDataError !== null }}
            style={scheduleDataError !== null ? styles.disabledButton : undefined}
          >
            <Plus size={22} color={colors.rose[500]} />
          </Pressable>
        ) : undefined}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.rose[500]}
          />
        }
      >
        {scheduleDataError ? (
          <Surface style={styles.approvalSection}>
            <View style={styles.approvalErrorCopy} accessibilityRole="alert">
              <AlertTriangle size={18} color={colors.warning} />
              <AppText variant="caption" style={styles.approvalErrorText}>
                {scheduleDataError === "integrity"
                  ? "저장된 일정 중 확인이 필요한 기록이 있어 일정을 임의로 숨겼어요. 원본은 바꾸지 않았습니다. 다시 불러와도 계속되면 고객지원에 알려 주세요."
                  : "일정을 안전하게 불러오지 못했어요. 기존 기록은 바꾸지 않았습니다."}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="일정 다시 불러오기"
              onPress={() => void loadData()}
              style={styles.approvalRetry}
            >
              <Text style={styles.approvalRetryText}>다시 불러오기</Text>
            </Pressable>
          </Surface>
        ) : null}

        <Surface tone="noir" style={styles.opsCard}>
          <View style={styles.opsTop}>
            <View>
              <AppText variant="caption" style={styles.opsLabel}>
                이번 주 준비 모드
              </AppText>
              <Text style={styles.opsDday}>{formatDday(dday)}</Text>
            </View>
            <StatusPill
              label={
                overdueCount > 0
                  ? `${overdueCount}개 지연`
                  : dday === null
                    ? "날짜 필요"
                    : getPhaseLabel(dday)
              }
              tone={overdueCount > 0 ? "danger" : "rose"}
            />
          </View>
          <AppText variant="body" style={styles.opsCopy}>
            {weddingDate
              ? `${getPhaseLabel(dday)} 단계예요. 기본 순서에서 먼저 확인할 항목을 모았어요. 실제 계약·업체·가족 일정이 우선이에요.`
              : "결혼식 날짜를 설정하면 기본 확인 순서에 따라 먼저 볼 항목을 정리해요."}
          </AppText>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>전체 진행률</Text>
            <Text style={styles.summaryPercent}>{overallPercent}%</Text>
          </View>
          <View
            style={styles.summaryBar}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="전체 체크리스트 진행률"
            accessibilityValue={{ min: 0, max: 100, now: overallPercent }}
          >
            <Animated.View style={[styles.summaryBarFill, { width: progressWidth }]} />
          </View>
        </Surface>

        {(approvalLoading || approvalError || approvalRequests.length > 0) && (
          <Surface style={styles.approvalSection}>
            <View style={styles.approvalHeader}>
              <View style={styles.approvalHeaderCopy}>
                <AppText variant="eyebrow">TOGETHER</AppText>
                <AppText variant="subtitle">둘이 확인할 일정 변경</AppText>
              </View>
              {approvalLoading ? (
                <ActivityIndicator size="small" color={colors.rose[500]} />
              ) : null}
            </View>
            <AppText variant="caption" style={styles.approvalIntro}>
              한 사람이 보낸 변경은 다른 사람이 확인하기 전까지 현재 일정에 반영되지 않아요.
            </AppText>

            {approvalError ? (
              <View style={styles.approvalErrorRow}>
                <View style={styles.approvalErrorCopy}>
                  <AlertTriangle size={17} color={colors.warning} />
                  <AppText variant="caption" style={styles.approvalErrorText}>
                    {approvalRequests.length > 0
                      ? "공동 확인 상태를 모두 최신으로 확인하지 못했어요. 확인된 요청은 유지했고 기존 일정은 바꾸지 않았어요."
                      : "공동 확인 상태를 불러오지 못했어요. 기존 일정은 바꾸지 않았어요."}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="공동 확인 상태 다시 불러오기"
                  onPress={() => {
                    const identity = approvalIdentityRef.current;
                    if (identity) void loadApprovalRequests(identity);
                  }}
                  style={({ pressed }) => [
                    styles.approvalRetry,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Text style={styles.approvalRetryText}>다시 불러오기</Text>
                </Pressable>
              </View>
            ) : null}

            {approvalRequests.map((request, index) => {
              const busyAction = approvalBusy?.requestId === request.requestId
                ? approvalBusy.action
                : null;
              const actionsDisabled = approvalBusy !== null;
              return (
                <View
                  key={request.requestId}
                  style={[
                    styles.approvalRequestRow,
                    index > 0 && styles.approvalRequestDivider,
                  ]}
                >
                  <View style={styles.approvalRequestTitleRow}>
                    <AppText variant="bodyStrong">
                      {request.role === "reviewer"
                        ? "파트너가 보낸 변경"
                        : "내가 보낸 변경"}
                    </AppText>
                    <StatusPill
                      label={request.role === "reviewer" ? "내 확인 필요" : "파트너 확인 대기"}
                      tone={request.role === "reviewer" ? "warning" : "neutral"}
                    />
                  </View>
                  <Text style={styles.approvalSummary}>{request.summary}</Text>
                  <Text style={styles.approvalHint}>
                    {request.role === "reviewer"
                      ? "동의하면 두 사람의 최신 일정에 반영돼요. 반영하지 않으면 기존 일정이 유지돼요."
                      : "승인 전에는 기존 일정이 유지돼요. 필요하면 이 요청을 철회할 수 있어요."}
                  </Text>
                  <View style={styles.approvalActions}>
                    {request.role === "reviewer" ? (
                      <>
                        <PrimaryButton
                          tone="ghost"
                          style={styles.approvalActionButton}
                          disabled={actionsDisabled}
                          onPress={() => requestApprovalAction(request, "reject")}
                        >
                          {busyAction === "reject"
                            ? <ActivityIndicator color={colors.noir[800]} />
                            : "반영하지 않기"}
                        </PrimaryButton>
                        <PrimaryButton
                          tone="rose"
                          style={styles.approvalActionButton}
                          disabled={actionsDisabled}
                          onPress={() => requestApprovalAction(request, "approve")}
                        >
                          {busyAction === "approve"
                            ? <ActivityIndicator color="#fff" />
                            : "동의하고 반영"}
                        </PrimaryButton>
                      </>
                    ) : (
                      <PrimaryButton
                        tone="ghost"
                        style={styles.approvalActionButton}
                        disabled={actionsDisabled}
                        onPress={() => requestApprovalAction(request, "withdraw")}
                      >
                        {busyAction === "withdraw"
                          ? <ActivityIndicator color={colors.noir[800]} />
                          : "요청 철회"}
                      </PrimaryButton>
                    )}
                  </View>
                </View>
              );
            })}
          </Surface>
        )}

        <Surface style={styles.weeklySection}>
          <View style={styles.weeklyHeader}>
            <View>
              <AppText variant="eyebrow">WEEKLY ACTION</AppText>
              <AppText variant="subtitle">이번 주 확인 제안</AppText>
            </View>
            <CalendarDays size={18} color={colors.rose[500]} />
          </View>
          {weeklyActions.length > 0 ? (
            weeklyActions.map((action) => (
              <Pressable
                key={action.categoryKey}
                style={({ pressed }) => [
                  styles.weeklyActionRow,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => {
                  setExpandedKey(action.categoryKey);
                }}
              >
                <View
                  style={[
                    styles.weeklyActionIcon,
                    action.urgency === "overdue" && styles.weeklyActionIconDanger,
                  ]}
                >
                  {action.urgency === "overdue" ? (
                    <AlertTriangle size={17} color={colors.danger} />
                  ) : (
                    <Circle size={17} color={colors.rose[500]} />
                  )}
                </View>
                <View style={styles.weeklyActionBody}>
                  <View style={styles.weeklyActionTitleRow}>
                    <Text style={styles.weeklyActionTitle} numberOfLines={1}>
                      {action.categoryLabel}
                    </Text>
                    <StatusPill
                      label={getUrgencyLabel(action.urgency)}
                      tone={getUrgencyTone(action.urgency)}
                    />
                  </View>
                  <Text style={styles.weeklyActionDesc} numberOfLines={2}>
                    {action.nextItemLabel} · {action.deadlineLabel}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.weeklyEmpty}>
              <CheckCircle2 size={24} color={colors.rose[500]} />
              <AppText variant="bodyStrong">
                현재 저장된 일정 기준, 이번 주 확인 항목이 없어요
              </AppText>
              <AppText variant="caption" style={styles.weeklyEmptyText}>
                등록하지 않은 일정과 실제 계약·업체·가족 일정은 포함되지 않아요.
              </AppText>
            </View>
          )}
        </Surface>

        {/* 임박 알림 섹션 */}
        {!checklistOnly && upcomingEvents.length > 0 && (
          <View style={styles.upcomingSection}>
            <View style={styles.upcomingHeader}>
              <CalendarDays size={18} color={colors.rose[500]} />
              <Text style={styles.upcomingTitle}>임박 일정</Text>
            </View>
            {upcomingEvents.map((evt) => (
              <Pressable
                key={`upcoming-${evt.id}`}
                style={({ pressed }) => [
                  styles.eventCard,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => openEditEventModal(evt.id)}
              >
                <View style={styles.eventDateBadge}>
                  <Text style={styles.eventDateNum}>{formatDate(evt.date)}</Text>
                  <Text style={styles.eventDateDay}>{getDayLabel(evt.date)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle}>{evt.title}</Text>
                  <View style={styles.eventMeta}>
                    {evt.time ? (
                      <View style={styles.eventMetaRow}>
                        <Clock size={12} color={colors.textTertiary} />
                        <Text style={styles.eventMetaText}>{evt.time}</Text>
                      </View>
                    ) : null}
                    {evt.categoryKey ? (
                      <View style={styles.eventCatBadge}>
                        <Text style={styles.eventCatText}>{evt.categoryKey}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* 카테고리 체크리스트 — 웹 상수 기반, 항상 20개 카테고리 표시 */}
        {(
          categories.map((cat) => {
            const stats = getCategoryStats(cat.key);
            const expanded = expandedKey === cat.key;

            return (
              <View key={cat.key} style={styles.catCard}>
                <Pressable
                  style={styles.catHeader}
                  onPress={() => handleExpandToggle(cat.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${cat.label} 체크리스트`}
                  accessibilityState={{ expanded }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catLabel}>{cat.label}</Text>
                    <Text style={styles.catStat}>{stats.skipped ? "해당 없음 · 진행률에서 제외" : `${stats.done}/${stats.total} 완료`}</Text>
                  </View>
                  <View style={styles.catRight}>
                    <Text style={styles.catPercent}>{stats.skipped ? "제외" : `${stats.percent}%`}</Text>
                    {expanded
                      ? <ChevronUp size={20} color={colors.textTertiary} />
                      : <ChevronDown size={20} color={colors.textTertiary} />
                    }
                  </View>
                </Pressable>

                {!stats.skipped && (
                  <View style={styles.catBar}>
                    <View style={[styles.catBarFill, { width: `${stats.percent}%` }]} />
                  </View>
                )}

                {expanded && (
                  <View style={styles.itemList}>
                    <Pressable
                      style={styles.itemRow}
                      onPress={() => void toggleCategoryApplicability(cat.key)}
                      accessibilityRole="button"
                      accessibilityLabel={stats.skipped ? `${cat.label} 다시 준비 목록에 넣기` : `${cat.label} 준비 목록에서 제외하기`}
                    >
                      <Ban size={22} color={colors.textTertiary} />
                      <Text style={styles.itemLabel}>
                        {stats.skipped ? "다시 준비 목록에 넣기" : "우리는 이건 안 해요"}
                      </Text>
                    </Pressable>
                    {cat.items.map((item) => (
                      <Pressable
                        key={item.id}
                        style={({ pressed }) => [
                          styles.itemRow,
                          pressed && { transform: [{ scale: 0.98 }] },
                        ]}
                        onPress={() => toggleItem(cat.key, item.id, item.done)}
                        disabled={stats.skipped}
                        accessibilityRole="checkbox"
                        accessibilityLabel={item.label}
                        // 안내는 이름이 아니라 힌트로 읽힌다. 이름에 붙이면 항목마다
                        // 두 문장을 이어 읽는다(웹의 aria-describedby와 같은 취지).
                        accessibilityHint={item.note}
                        accessibilityState={{ checked: item.done, disabled: stats.skipped }}
                      >
                        {item.done
                          ? <CheckCircle2 size={22} color={colors.rose[500]} />
                          : <Circle size={22} color={colors.taupe[400]} />
                        }
                        <View style={styles.itemTextColumn}>
                          <Text style={[styles.itemLabel, item.done && styles.itemDone]}>
                            {item.label}
                          </Text>
                          {item.note ? (
                            <Text style={styles.itemNote}>{item.note}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* 전체 일정 목록 */}
        {!checklistOnly && activeEvents.length > 0 && (
          <View style={styles.allEventsSection}>
            <Text style={styles.allEventsTitle}>전체 일정</Text>
            {activeEvents.map((evt) => (
              <Pressable
                key={`all-${evt.id}`}
                style={({ pressed }) => [
                  styles.allEventRow,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => openEditEventModal(evt.id)}
              >
                <Text style={styles.allEventDate}>{formatDate(evt.date)}</Text>
                <Text style={styles.allEventTitle}>{evt.title}</Text>
                {evt.time ? <Text style={styles.allEventTime}>{evt.time}</Text> : null}
              </Pressable>
            ))}
          </View>
        )}

        {!checklistOnly && cancelledEvents.length > 0 && (
          <View style={styles.cancelledSection}>
            <Text style={styles.cancelledTitle}>취소됨</Text>
            <Text style={styles.cancelledHint}>
              완전 삭제하지 않고 변경 기록을 보관해요.
            </Text>
            {cancelledEvents.map((evt) => (
              <View key={`cancelled-${evt.id}`} style={styles.cancelledRow}>
                <View style={styles.cancelledInfo}>
                  <Text style={styles.cancelledEventTitle}>{evt.title}</Text>
                  <Text style={styles.cancelledMeta}>
                    기존 날짜 {evt.date}{evt.time ? ` ${evt.time}` : ""}
                  </Text>
                  <Text style={styles.cancelledMeta}>
                    취소 시각 {evt.cancellation?.cancelledAt.slice(0, 10) ?? "기록 확인 필요"}
                  </Text>
                  {evt.cancellation?.reason ? (
                    <Text style={styles.cancelledMeta}>
                      취소 사유 {evt.cancellation.reason}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${evt.title} 일정 복원 요청`}
                  disabled={saving}
                  onPress={() => requestEventRestore(evt.id)}
                  style={({ pressed }) => [
                    styles.restoreBtn,
                    pressed && styles.rowPressed,
                    saving && styles.disabledButton,
                  ]}
                >
                  <RotateCcw size={16} color={colors.noir[800]} />
                  <Text style={styles.restoreBtnText}>복원 요청</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 일정 추가/수정 모달 */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingEventId !== null ? "일정 수정" : "일정 추가"}
              </Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <X size={24} color={colors.textTertiary} />
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>제목</Text>
              <TextInput
                style={styles.input}
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="예: 드레스 입어보기"
                placeholderTextColor={colors.textTertiary}
                maxLength={500}
              />

              <Text style={styles.fieldLabel}>날짜 (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={formDate}
                onChangeText={setFormDate}
                placeholder="2026-06-15"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <Text style={styles.fieldLabel}>시간 (선택)</Text>
              <TextInput
                style={styles.input}
                value={formTime}
                onChangeText={setFormTime}
                placeholder="14:00"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />

              <Text style={styles.fieldLabel}>카테고리 (선택)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <Pressable
                  style={[styles.chip, !formCategoryKey && styles.chipActive]}
                  onPress={() => setFormCategoryKey("")}
                >
                  <Text style={[styles.chipText, !formCategoryKey && styles.chipTextActive]}>없음</Text>
                </Pressable>
                {CATEGORY_OPTIONS.map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.chip, formCategoryKey === cat && styles.chipActive]}
                    onPress={() => setFormCategoryKey(cat)}
                  >
                    <Text style={[styles.chipText, formCategoryKey === cat && styles.chipTextActive]}>
                      {cat}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>메모 (선택)</Text>
              <TextInput
                style={[styles.input, { height: 60, textAlignVertical: "top" }]}
                value={formMemo}
                onChangeText={setFormMemo}
                placeholder="메모"
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={2000}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              {editingEventId !== null && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="일정 취소 요청"
                  style={({ pressed }) => [styles.cancelBtn, pressed && { transform: [{ scale: 0.96 }] }]}
                  onPress={requestEventCancellation}
                >
                  <Ban size={18} color={colors.noir[800]} />
                  <Text style={styles.cancelBtnText}>일정 취소 요청</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  pressed && { transform: [{ scale: 0.98 }] },
                  { flex: 1 },
                ]}
                onPress={saveEvent}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editingEventId !== null ? "수정 완료" : "추가하기"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  opsCard: {
    padding: 18,
  },
  opsTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 10,
  },
  opsLabel: {
    color: colors.gold.light,
    marginBottom: 2,
  },
  opsDday: {
    fontSize: 42,
    lineHeight: 48,
    fontFamily: "NotoSansKR_700Bold",
    color: "#FFFFFF",
  },
  opsCopy: {
    color: colors.gold.light,
    lineHeight: 22,
    marginBottom: 16,
  },
  approvalSection: {
    padding: 18,
  },
  approvalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  approvalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  approvalIntro: {
    marginTop: 6,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  approvalErrorRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  approvalErrorCopy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  approvalErrorText: {
    flex: 1,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  approvalRetry: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 4,
  },
  approvalRetryText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.noir[800],
  },
  approvalRequestRow: {
    paddingTop: 16,
  },
  approvalRequestDivider: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  approvalRequestTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  approvalSummary: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    color: colors.noir[800],
  },
  approvalHint: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  approvalActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  approvalActionButton: {
    flex: 1,
    minHeight: 44,
  },
  weeklySection: {
    paddingVertical: 16,
  },
  weeklyHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  weeklyEmpty: {
    alignItems: "center",
    paddingVertical: 18,
    gap: 6,
  },
  weeklyEmptyText: {
    textAlign: "center",
  },
  weeklyActionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  weeklyActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  weeklyActionIconDanger: {
    backgroundColor: "rgba(217,95,95,0.12)",
  },
  weeklyActionBody: {
    flex: 1,
    minWidth: 0,
  },
  weeklyActionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  weeklyActionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  weeklyActionDesc: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  rowPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  summaryLabel: { fontSize: 14, color: colors.gold.light },
  summaryPercent: { fontSize: 32, fontFamily: "NotoSansKR_700Bold", color: "#FFFFFF" },
  summaryBar: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 12,
  },
  summaryBarFill: {
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: 3,
  },

  list: { padding: 20, gap: 14, paddingBottom: 128 },

  // 임박 일정
  upcomingSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  upcomingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  upcomingTitle: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  eventDateBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
  },
  eventDateNum: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.rose[500],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  eventDateDay: { fontSize: 10, color: colors.rose[600] },
  eventTitle: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  eventMetaText: { fontSize: 11, color: colors.textTertiary },
  eventCatBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.ivory[200],
  },
  eventCatText: { fontSize: 10, color: colors.textSecondary },

  // 카테고리 체크리스트
  empty: { alignItems: "center", paddingTop: 60 },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyText: { fontSize: 16, fontWeight: "600", color: colors.noir[800], marginBottom: 8 },
  emptyHint: { fontSize: 13, color: colors.textTertiary },

  catCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  catHeader: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  catLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  catStat: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  catRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  catPercent: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.rose[500],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  catBar: {
    height: 4,
    backgroundColor: colors.ivory[200],
    borderRadius: 999,
    marginTop: 12,
    overflow: "hidden",
  },
  catBarFill: { height: "100%", backgroundColor: colors.rose[500], borderRadius: 999 },

  itemList: { marginTop: 16, gap: 14 },
  itemRow: {
    flexDirection: "row",
    // 안내가 붙으면 두 줄이 되므로 아이콘을 첫 줄에 맞춘다.
    alignItems: "flex-start",
    gap: 12,
    minHeight: 44,
    paddingVertical: 6,
  },
  itemTextColumn: { flex: 1 },
  itemLabel: { fontSize: 14, color: colors.noir[800] },
  itemDone: { textDecorationLine: "line-through", color: colors.textTertiary },
  // 할 일 밑에 붙는 "놓치기 쉬운 것" 한 줄. label보다 한 단계 흐리게.
  itemNote: { marginTop: 3, fontSize: 13, lineHeight: 19, color: colors.textTertiary },

  // 전체 일정 목록
  allEventsSection: { marginTop: 8 },
  allEventsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 12,
    fontFamily: "NotoSerifKR_500Medium",
  },
  allEventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  allEventDate: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.rose[500],
    width: 44,
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  allEventTitle: { fontSize: 14, color: colors.noir[800], flex: 1 },
  allEventTime: { fontSize: 12, color: colors.textTertiary },

  cancelledSection: {
    marginTop: 8,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  cancelledTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
  },
  cancelledHint: {
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  cancelledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelledInfo: { flex: 1, minWidth: 0 },
  cancelledEventTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.noir[800],
  },
  cancelledMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  restoreBtn: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.noir[800],
  },
  restoreBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.noir[800],
  },
  disabledButton: { opacity: 0.5 },

  // 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    maxHeight: "85%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ivory[200],
    alignSelf: "center",
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.noir[800],
  },
  chipScroll: { flexDirection: "row", marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.ivory[200],
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.noir[800] },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: "#fff", fontWeight: "600" },

  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.noir[800],
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  saveBtn: {
    backgroundColor: colors.rose[500],
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
