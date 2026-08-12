import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  CATEGORY_CHECKLISTS,
  CHECKLIST_ITEM_GUIDANCE,
  getChecklistItemGuidance,
  type CategoryChecklistTemplate,
} from "@hanbang/shared/constants";
import {
  applyPlanningChecklistProfile,
  buildPlanningChecklistInsights,
  calculatePlanningChecklistStatus,
  hasChecklistReviewEvidence,
  isCanonicalPlanningChecklistProfile,
  mergePlanningChecklist,
  normalizePlanningChecklistProfile,
  PLANNING_CHECKLIST_PROFILE_KEY,
  summarizePlanningChecklist,
  type PlanningChecklistAssignee,
  type PlanningChecklistItem,
  type PlanningChecklistItemState,
  type PlanningChecklistProgress,
  type PlanningChecklistProfile,
  type PlanningChecklistProfileApplication,
  type PlanningChecklistProfileAnswers,
  type PlanningChecklistStatus,
} from "@hanbang/shared/utils";
import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  createScheduleSessionFence,
  type ScheduleSessionToken,
} from "@/lib/scheduleSessionFence.mjs";
import {
  applyChecklistItemPatchForStage,
  buildChecklistCategoryReviewPresentation,
  buildChecklistEmptyFocusPresentation,
  buildChecklistSituationPreviewSubmission,
  buildManualChecklistReviewEvidence,
  buildSituationModalFooter,
  captureChecklistItemEditBaseline,
  createChecklistSituationPreviewPlan,
  createChecklistMutationQueue,
  executeChecklistDetailMutationPlan,
  filterChecklistCategories,
  findChecklistItemTarget,
  formatChecklistCompletionAudit,
  getChecklistSharingNotice,
  getChecklistStateLabel,
  getMobileChecklistGuidance,
  hasChecklistItemMutationConflict,
  isChecklistSituationApplicationNoop,
  normalizeChecklistItem,
  normalizeChecklistNote,
  planChecklistDetailMutations,
  readChecklistItemsSnapshot,
  resolveProtectedChecklistMutationStatus,
  type ChecklistItemEditBaseline,
  type ChecklistSituationPreviewPlan,
  validateChecklistDueDate,
} from "@/lib/checklistExperience.mjs";
import {
  AppHeader,
  AppText,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

type ChecklistProgressMap = Record<string, PlanningChecklistProgress | undefined>;
type FocusTab = "today" | "week" | "overdue";
type ListFilter = "all" | "mine" | "partner" | "blocked" | "waiting" | "not_applicable";
type AssigneeChoice = "unassigned" | "mine" | "partner" | "couple" | "external";

interface ChecklistCategoryView extends CategoryChecklistTemplate {
  status: PlanningChecklistStatus;
  items: PlanningChecklistItem[];
  reviewed: boolean;
}

interface DetailTarget {
  categoryKey: string;
  itemId: string;
}

interface LoadedChecklistSnapshot {
  coupleId: string;
  ownerId: string;
  progress: Record<string, unknown>;
  stateRevision: number;
}

type SituationPreviewPlan = ChecklistSituationPreviewPlan<
  PlanningChecklistProfileApplication["progressPatch"],
  PlanningChecklistProfile
>;

type ItemSaveFailureStatus = "conflict" | "stale" | "active_request" | "failed";
type ItemSaveResult =
  | { status: "applied" | "pending_partner"; item: PlanningChecklistItem }
  | { status: ItemSaveFailureStatus };

interface SaveItemPatchOptions {
  expectedBaseline?: ChecklistItemEditBaseline;
  preserveReviewEvidence?: boolean;
  showAlerts?: boolean;
  stage?: "routine" | "assignee";
}

class ChecklistMutationError extends Error {
  constructor(readonly code: "stale" | "active_request" | "invalid_snapshot" | "item_conflict" | "failed") {
    super(code);
    this.name = "ChecklistMutationError";
  }
}

const ITEM_STATE_OPTIONS: Array<{ value: PlanningChecklistItemState; label: string }> = [
  { value: "todo", label: "할 일" },
  { value: "in_progress", label: "진행 중" },
  { value: "waiting", label: "회신 대기" },
  { value: "blocked", label: "막힘" },
  { value: "completed", label: "완료" },
  { value: "not_applicable", label: "해당 없음" },
];

const LIST_FILTER_OPTIONS: Array<{ value: ListFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "mine", label: "내 담당" },
  { value: "partner", label: "파트너 담당" },
  { value: "blocked", label: "막힘" },
  { value: "waiting", label: "대기" },
  { value: "not_applicable", label: "해당 없음" },
];

const DEFAULT_SITUATION_ANSWERS: PlanningChecklistProfileAnswers = {
  ceremony: "undecided",
  legalMarriage: "undecided",
  travel: "undecided",
  housing: "undecided",
  internationalMarriage: null,
  religiousCeremony: null,
  remarriage: null,
  childrenParticipating: null,
  accessibilitySupport: null,
  healthSupport: null,
  petParticipation: null,
  familyTradition: null,
};

const SITUATION_QUESTIONS: Array<{
  key: keyof PlanningChecklistProfileAnswers;
  label: string;
  help: string;
  options: Array<{ value: string | boolean | null; label: string }>;
}> = [
  { key: "ceremony", label: "예식", help: "예식 없이 신고·모임만 하는 경우도 포함해요.", options: [{ value: "yes", label: "해요" }, { value: "no", label: "안 해요" }, { value: "undecided", label: "미정" }] },
  { key: "legalMarriage", label: "법률혼(혼인신고)", help: "희망 여부만 저장하고 서류 상세는 저장하지 않아요.", options: [{ value: "yes", label: "해요" }, { value: "no", label: "안 해요" }, { value: "undecided", label: "미정" }] },
  { key: "travel", label: "신혼여행", help: "여권·비자 항목을 맞추는 데 사용해요.", options: [{ value: "domestic", label: "국내" }, { value: "international", label: "해외" }, { value: "none", label: "안 감" }, { value: "undecided", label: "미정" }] },
  { key: "housing", label: "신혼집", help: "임대·매수에만 필요한 확인을 구분해요.", options: [{ value: "rent", label: "임차" }, { value: "buy", label: "매수" }, { value: "other", label: "기타/해당 없음" }, { value: "undecided", label: "미정" }] },
  { key: "internationalMarriage", label: "국제혼인", help: "국가·국적·비자 상세는 저장하지 않아요.", options: [{ value: true, label: "해당" }, { value: false, label: "해당 없음" }, { value: null, label: "미정" }] },
  { key: "religiousCeremony", label: "종교식", help: "종교의 종류나 신앙 정보는 저장하지 않아요.", options: [{ value: true, label: "해당" }, { value: false, label: "해당 없음" }, { value: null, label: "미정" }] },
  { key: "remarriage", label: "재혼", help: "관계 상세나 가족 정보는 저장하지 않아요.", options: [{ value: true, label: "해당" }, { value: false, label: "해당 없음" }, { value: null, label: "미정" }] },
  { key: "childrenParticipating", label: "자녀 동반", help: "자녀의 이름·나이·사진 정보는 저장하지 않아요.", options: [{ value: true, label: "해당" }, { value: false, label: "해당 없음" }, { value: null, label: "미정" }] },
  { key: "accessibilitySupport", label: "접근성 지원", help: "이동·소통 지원 필요 여부만 저장하고 장애·질환 상세는 저장하지 않아요.", options: [{ value: true, label: "필요" }, { value: false, label: "필요 없음" }, { value: null, label: "미정" }] },
  { key: "healthSupport", label: "건강·임신 지원", help: "지원 필요 여부만 저장하고 진단명·복용약·검사 결과는 저장하지 않아요.", options: [{ value: true, label: "필요" }, { value: false, label: "필요 없음" }, { value: null, label: "미정" }] },
  { key: "petParticipation", label: "반려동물 참여", help: "참여 여부만 저장해 장소·돌봄 항목을 맞춰요.", options: [{ value: true, label: "참여" }, { value: false, label: "참여 안 함" }, { value: null, label: "미정" }] },
  { key: "familyTradition", label: "전통의례", help: "함·폐백·예단 등 진행 여부를 묶어 확인해요.", options: [{ value: true, label: "진행" }, { value: false, label: "진행 안 함" }, { value: null, label: "미정" }] },
];

function readSituationProfile(value: unknown): PlanningChecklistProfile | null {
  return normalizePlanningChecklistProfile(value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readChecklistProgress(progress: unknown): ChecklistProgressMap {
  if (!isRecord(progress)) return {};
  const result: ChecklistProgressMap = {};
  for (const template of CATEGORY_CHECKLISTS) {
    const saved = progress[template.key];
    if (!isRecord(saved)) continue;
    result[template.key] = {
      ...saved,
      checklist: readChecklistItemsSnapshot(saved.checklist),
    } as PlanningChecklistProgress;
  }
  return result;
}

function deriveCategories(progress: ChecklistProgressMap): ChecklistCategoryView[] {
  return CATEGORY_CHECKLISTS.map((template) => {
    const saved = progress[template.key];
    const merged = mergePlanningChecklist(
      template.items,
      saved?.checklist,
      saved?.status,
    ).map(normalizeChecklistItem);
    return {
      ...template,
      status: saved?.status === "not_applicable"
        ? "not_applicable"
        : calculatePlanningChecklistStatus(merged),
      items: merged,
      reviewed: hasChecklistReviewEvidence(saved),
    };
  });
}

function stateTone(state?: PlanningChecklistItemState): "neutral" | "rose" | "success" | "warning" | "danger" {
  if (state === "completed") return "success";
  if (state === "blocked") return "danger";
  if (state === "waiting") return "warning";
  if (state === "in_progress") return "rose";
  return "neutral";
}

function assigneeLabel(assignee: PlanningChecklistAssignee | null | undefined, profileId: string | null): string {
  if (!assignee) return "담당 미정";
  if (assignee.kind === "couple") return "우리 둘";
  if (assignee.kind === "external") return assignee.label;
  return assignee.profileId === profileId ? "내 담당" : "파트너 담당";
}

function formatDueDate(dueDate: string | null | undefined, todayKey: string): string {
  if (!dueDate) return "기한 미정";
  if (dueDate === todayKey) return "오늘까지";
  if (dueDate < todayKey) return `${dueDate.slice(5).replace("-", "/")} 지남`;
  return `${dueDate.slice(5).replace("-", "/")}까지`;
}

function getCategoryCounts(category: ChecklistCategoryView) {
  if (category.status === "not_applicable") {
    return { done: 0, total: 0, percent: 0, skipped: true };
  }
  const applicable = category.items.filter((item) => item.state !== "not_applicable");
  const done = applicable.filter((item) => item.state === "completed").length;
  return {
    done,
    total: applicable.length,
    percent: applicable.length > 0 ? Math.round((done / applicable.length) * 100) : 0,
    skipped: false,
  };
}

async function fetchChecklistSnapshot(coupleId: string) {
  const { data, error } = await supabase
    .from("wedding_journeys")
    .select("progress, state_revision")
    .eq("couple_id", coupleId)
    .single();
  if (error || !data || !Number.isInteger(data.state_revision) || data.state_revision < 0) {
    throw new ChecklistMutationError("invalid_snapshot");
  }
  return {
    progress: isRecord(data.progress) ? data.progress : {},
    stateRevision: data.state_revision,
  };
}

function readMutationOutcome(payload: unknown): "applied" | "pending_partner" {
  if (!isRecord(payload)) throw new ChecklistMutationError("failed");
  if (payload.status === "pending_partner") return "pending_partner";
  if (payload.status === "applied") return "applied";
  throw new ChecklistMutationError("failed");
}

export default function ChecklistScreen() {
  const [progress, setProgress] = useState<ChecklistProgressMap>({});
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [partnerProfileId, setPartnerProfileId] = useState<string | null>(null);
  const [partnerDisplayName, setPartnerDisplayName] = useState<string | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [focusTab, setFocusTab] = useState<FocusTab>("today");
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [detailBaseline, setDetailBaseline] = useState<ChecklistItemEditBaseline | null>(null);
  const [detailState, setDetailState] = useState<PlanningChecklistItemState>("todo");
  const [detailDueDate, setDetailDueDate] = useState("");
  const [detailNote, setDetailNote] = useState("");
  const [assigneeChoice, setAssigneeChoice] = useState<AssigneeChoice>("unassigned");
  const [externalAssignee, setExternalAssignee] = useState("");
  const [detailPartnerAssigneeId, setDetailPartnerAssigneeId] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [situationProfile, setSituationProfile] = useState<PlanningChecklistProfile | null>(null);
  const [situationVisible, setSituationVisible] = useState(false);
  const [situationPreviewVisible, setSituationPreviewVisible] = useState(false);
  const [situationDraft, setSituationDraft] = useState<PlanningChecklistProfileAnswers>(DEFAULT_SITUATION_ANSWERS);
  const [situationSaving, setSituationSaving] = useState(false);
  const [loadedChecklistSnapshot, setLoadedChecklistSnapshot] = useState<LoadedChecklistSnapshot | null>(null);
  const [situationPreviewPlan, setSituationPreviewPlan] = useState<SituationPreviewPlan | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const categoryOffsetsRef = useRef<Record<string, number>>({});
  const loadSequenceRef = useRef(0);
  const sessionFenceRef = useRef(createScheduleSessionFence()).current;
  const checklistMutationQueueRef = useRef(createChecklistMutationQueue());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const focusedOnceRef = useRef(false);

  const categories = useMemo(() => deriveCategories(progress), [progress]);
  const todayKey = formatLocalDateKey();
  const summary = useMemo(
    () => summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress),
    [progress],
  );
  const insights = useMemo(
    () => buildPlanningChecklistInsights(CATEGORY_CHECKLISTS, progress, {
      weddingDate,
      today: todayKey,
      currentProfileId: profileId ?? undefined,
      guidance: CHECKLIST_ITEM_GUIDANCE,
    }),
    [profileId, progress, todayKey, weddingDate],
  );

  const focusItems = useMemo(() => {
    if (focusTab === "overdue") return insights.overdue;
    if (focusTab === "today") return insights.today;
    return insights.upcoming.filter((item) => (
      typeof item.daysUntilDue === "number"
      && item.daysUntilDue > 0
      && item.daysUntilDue <= 7
    ));
  }, [focusTab, insights]);
  const reviewSuggestions = useMemo(
    () => focusItems.length === 0 ? insights.review.slice(0, 3) : [],
    [focusItems.length, insights.review],
  );
  const emptyFocusPresentation = useMemo(
    () => buildChecklistEmptyFocusPresentation(focusTab, reviewSuggestions),
    [focusTab, reviewSuggestions],
  );
  const situationModalFooter = buildSituationModalFooter(situationPreviewVisible);

  const filteredCategories = useMemo(() => filterChecklistCategories(categories, {
    query,
    state: listFilter === "blocked" || listFilter === "waiting" || listFilter === "not_applicable"
      ? listFilter
      : "all",
    owner: listFilter === "mine" || listFilter === "partner" ? listFilter : "all",
    hideCompleted,
    profileId,
  }), [categories, hideCompleted, listFilter, profileId, query]);

  const selectedCategory = detailTarget
    ? categories.find((category) => category.key === detailTarget.categoryKey) ?? null
    : null;
  const selectedItem = detailTarget && selectedCategory
    ? selectedCategory.items.find((item) => item.id === detailTarget.itemId) ?? null
    : null;
  const selectedGuidance = selectedCategory && selectedItem
    ? getMobileChecklistGuidance(
        selectedCategory,
        selectedItem,
        getChecklistItemGuidance(selectedItem.id),
      )
    : null;
  const coupleMemberNames = useMemo(() => {
    const names = new Map<string, string>();
    if (profileId && profileDisplayName) names.set(profileId, profileDisplayName);
    if (partnerProfileId && partnerDisplayName) names.set(partnerProfileId, partnerDisplayName);
    return names;
  }, [partnerDisplayName, partnerProfileId, profileDisplayName, profileId]);
  const selectedCompletionAudit = selectedItem
    ? formatChecklistCompletionAudit(selectedItem, coupleMemberNames)
    : null;
  const situationExclusionIds = situationPreviewPlan?.excludedItemIds ?? [];
  const situationExclusionItems = useMemo(() => {
    const ids = new Set(situationExclusionIds);
    return categories.flatMap((category) => category.items.flatMap((item) => (
      ids.has(item.id)
        ? [{ categoryLabel: category.label, itemId: item.id, label: item.label }]
        : []
    )));
  }, [categories, situationExclusionIds]);
  const situationRestoreItems = useMemo(() => {
    const ids = new Set(situationPreviewPlan?.restoredItemIds ?? []);
    return categories.flatMap((category) => category.items.flatMap((item) => (
      ids.has(item.id)
        ? [{ categoryLabel: category.label, itemId: item.id, label: item.label }]
        : []
    )));
  }, [categories, situationPreviewPlan?.restoredItemIds]);

  const clearIdentityState = useCallback((nextProfileId: string | null) => {
    setProfileId(nextProfileId);
    setProfileDisplayName(null);
    setPartnerProfileId(null);
    setPartnerDisplayName(null);
    setCoupleId(null);
    setWeddingDate(null);
    setProgress({});
    setPendingKeys(new Set());
    setDetailTarget(null);
    setDetailBaseline(null);
    setSituationProfile(null);
    setSituationVisible(false);
    setSituationPreviewVisible(false);
    setSituationPreviewPlan(null);
    setLoadedChecklistSnapshot(null);
    setLoadError(false);
  }, []);

  const loadData = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (loadSequenceRef.current !== sequence) return;
      if (!user) {
        sessionFenceRef.setOwner(null);
        clearIdentityState(null);
        return;
      }
      if (sessionFenceRef.setOwner(user.id)) clearIdentityState(user.id);
      setProfileId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .single();
      if (loadSequenceRef.current !== sequence) return;
      if (!profile?.couple_id) {
        sessionFenceRef.clearCouple(user.id);
        clearIdentityState(user.id);
        return;
      }
      sessionFenceRef.setIdentity(user.id, profile.couple_id);
      setCoupleId(profile.couple_id);

      const { data: coupleProfiles, error: coupleProfilesError } = await supabase
        .from("couple_profile_directory")
        .select("id, name")
        .eq("couple_id", profile.couple_id);
      if (loadSequenceRef.current !== sequence) return;
      if (coupleProfilesError) {
        setProfileDisplayName(null);
        setPartnerProfileId(null);
        setPartnerDisplayName(null);
      } else {
        const currentMember = (coupleProfiles ?? []).find((member) => member.id === user.id);
        const partner = (coupleProfiles ?? []).find((member) => member.id !== user.id);
        setProfileDisplayName(currentMember?.name?.trim() || null);
        setPartnerProfileId(partner?.id ?? null);
        setPartnerDisplayName(partner?.name?.trim() || null);
      }

      const { data: journey, error } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, progress, state_revision")
        .eq("couple_id", profile.couple_id)
        .single();
      if (loadSequenceRef.current !== sequence) return;
      if (error || !journey || !Number.isInteger(journey.state_revision)) {
        throw new ChecklistMutationError("invalid_snapshot");
      }
      const snapshotProgress = isRecord(journey.progress) ? journey.progress : {};
      setWeddingDate(journey.wedding_date ?? null);
      setProgress(readChecklistProgress(snapshotProgress));
      setLoadedChecklistSnapshot({
        coupleId: profile.couple_id,
        ownerId: user.id,
        progress: snapshotProgress,
        stateRevision: journey.state_revision,
      });
      setSituationProfile(
        readSituationProfile(snapshotProgress[PLANNING_CHECKLIST_PROFILE_KEY]),
      );
      setLoadError(false);
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return;
      console.error("체크리스트 로드 오류:", error);
      setLoadError(true);
    } finally {
      if (loadSequenceRef.current === sequence) setLoading(false);
    }
  }, [clearIdentityState, sessionFenceRef]);

  useEffect(() => {
    if (!situationPreviewPlan || !loadedChecklistSnapshot) return;
    if (
      situationPreviewPlan.stateRevision !== loadedChecklistSnapshot.stateRevision
      || situationPreviewPlan.coupleId !== loadedChecklistSnapshot.coupleId
      || situationPreviewPlan.ownerId !== loadedChecklistSnapshot.ownerId
    ) {
      setSituationPreviewPlan(null);
      setSituationPreviewVisible(false);
    }
  }, [loadedChecklistSnapshot, situationPreviewPlan]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextOwnerId = session?.user?.id ?? null;
      if (!sessionFenceRef.setOwner(nextOwnerId)) return;
      loadSequenceRef.current += 1;
      clearIdentityState(nextOwnerId);
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void loadData(), 0);
    });
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      subscription.unsubscribe();
    };
  }, [clearIdentityState, loadData, sessionFenceRef]);

  useEffect(() => {
    if (!coupleId) return;
    const channel = supabase.channel(`checklist:${coupleId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "wedding_journeys",
        filter: `couple_id=eq.${coupleId}`,
      }, () => void loadData())
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [coupleId, loadData]);

  useFocusEffect(useCallback(() => {
    if (!focusedOnceRef.current) {
      focusedOnceRef.current = true;
      return;
    }
    void loadData();
  }, [loadData]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && previous !== "active") void loadData();
    });
    return () => subscription.remove();
  }, [loadData]);

  const setPending = useCallback((key: string, pending: boolean) => {
    setPendingKeys((current) => {
      const next = new Set(current);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const submitCategoryMutation = useCallback(async (
    categoryKey: string,
    sessionToken: ScheduleSessionToken,
    update: (items: PlanningChecklistItem[], existing: Record<string, unknown>) => {
      checklist: PlanningChecklistItem[];
      status?: PlanningChecklistStatus;
    },
    options: { preserveReviewEvidence?: boolean } = {},
  ) => {
    const snapshot = await fetchChecklistSnapshot(sessionToken.coupleId);
    if (!sessionFenceRef.isCurrent(sessionToken)) throw new ChecklistMutationError("failed");
    const template = CATEGORY_CHECKLISTS.find((category) => category.key === categoryKey);
    if (!template) throw new ChecklistMutationError("failed");
    const existing = isRecord(snapshot.progress[categoryKey])
      ? snapshot.progress[categoryKey]
      : {};
    const merged = mergePlanningChecklist(
      template.items,
      readChecklistItemsSnapshot(existing.checklist),
      typeof existing.status === "string"
        ? existing.status as PlanningChecklistStatus
        : undefined,
    ).map(normalizeChecklistItem);
    const next = update(merged, existing);
    const reviewEvidence = buildManualChecklistReviewEvidence(existing, {
      now: new Date().toISOString(),
      profileId: sessionToken.ownerId,
      preserveExisting: options.preserveReviewEvidence,
    });
    const nextCategory = {
      ...existing,
      category: categoryKey,
      status: next.status ?? calculatePlanningChecklistStatus(next.checklist),
      checklist: next.checklist,
      ...reviewEvidence,
    };
    const response = await apiFetchForExpectedUser(sessionToken.ownerId, "/api/journey", {
      method: "PATCH",
      body: JSON.stringify({
        expected_revision: snapshot.stateRevision,
        progress_patch: { [categoryKey]: nextCategory },
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 409 && isRecord(payload) && payload.code === "PLAN_CHANGE_STALE") {
        throw new ChecklistMutationError("stale");
      }
      if (response.status === 409 && isRecord(payload) && payload.code === "PLAN_CHANGE_ACTIVE_REQUEST") {
        throw new ChecklistMutationError("active_request");
      }
      throw new ChecklistMutationError("failed");
    }
    const outcome = readMutationOutcome(payload);
    const appliedProgress = outcome === "applied"
      && isRecord(payload)
      && isRecord(payload.journey)
      && isRecord(payload.journey.progress)
      ? payload.journey.progress
      : undefined;
    return { outcome, appliedProgress };
  }, [sessionFenceRef]);

  const saveItemPatch = useCallback(async (
    categoryKey: string,
    itemId: string,
    patch: Partial<PlanningChecklistItem>,
    options: SaveItemPatchOptions = {},
  ): Promise<ItemSaveResult> => {
    const sessionToken = sessionFenceRef.capture();
    if (!sessionToken || !profileId || !coupleId) return { status: "failed" };
    const pendingKey = `${categoryKey}:${itemId}`;
    if (pendingKeys.has(pendingKey)) return { status: "failed" };
    setPending(pendingKey, true);
    let submittedItem: PlanningChecklistItem | null = null;
    try {
      const mutation = await checklistMutationQueueRef.current.enqueue(() => (
        submitCategoryMutation(
          categoryKey,
          sessionToken,
          (items, existing) => {
            const storedItems = readChecklistItemsSnapshot(existing.checklist);
            const freshItem = (storedItems ?? items).find((item) => item.id === itemId);
            const derivedStatus = calculatePlanningChecklistStatus(items);
            const protectedStatus = resolveProtectedChecklistMutationStatus(
              existing,
              items,
              derivedStatus,
            );
            if (
              hasChecklistItemMutationConflict({
                categoryStatus: typeof existing.status === "string" ? existing.status : undefined,
                expectedBaseline: options.expectedBaseline ?? null,
                freshItem,
              })
              || (
                options.expectedBaseline
                && (
                  options.stage === "assignee"
                  && Object.keys(existing).length > 0
                  && (
                    existing.category !== categoryKey
                    || protectedStatus.conflict
                  )
                )
              )
            ) {
              throw new ChecklistMutationError("item_conflict");
            }
            if (!freshItem) throw new ChecklistMutationError("item_conflict");

            const mutationNow = new Date().toISOString();
            const checklist = items.map((item) => {
              if (item.id !== itemId) return item;
              const updated = applyChecklistItemPatchForStage(
                item,
                patch,
                {
                  now: mutationNow,
                  profileId: sessionToken.ownerId,
                },
                options.stage ?? "routine",
              );
              submittedItem = updated;
              return updated;
            });
            return {
              checklist,
              ...(options.stage === "assignee"
                ? { status: protectedStatus.status as PlanningChecklistStatus }
                : {}),
            };
          },
          { preserveReviewEvidence: options.preserveReviewEvidence },
        )
      ));
      if (!sessionFenceRef.isCurrent(sessionToken)) return { status: "failed" };
      const { outcome } = mutation;
      if (outcome === "applied" && mutation.appliedProgress) {
        const appliedCategory = mutation.appliedProgress[categoryKey];
        const appliedItems = isRecord(appliedCategory)
          ? readChecklistItemsSnapshot(appliedCategory.checklist)
          : undefined;
        const appliedItem = appliedItems?.find((item) => item.id === itemId);
        if (!appliedItem) throw new ChecklistMutationError("item_conflict");
        submittedItem = appliedItem;
      }
      if (!submittedItem) throw new ChecklistMutationError("item_conflict");
      if (outcome === "pending_partner" && options.showAlerts !== false) {
        Alert.alert(
          "파트너 확인을 요청했어요",
          "파트너가 동의하기 전에는 기존 체크 상태가 유지돼요.",
        );
      }
      await loadData();
      return { status: outcome, item: submittedItem };
    } catch (error) {
      if (!sessionFenceRef.isCurrent(sessionToken)) return { status: "failed" };
      const status: ItemSaveFailureStatus = error instanceof ChecklistMutationError
        ? error.code === "item_conflict" || error.code === "invalid_snapshot"
          ? "conflict"
          : error.code === "stale" || error.code === "active_request"
            ? error.code
            : "failed"
        : "failed";
      if (options.showAlerts !== false) {
        if (status === "conflict") {
          Alert.alert(
            "다른 곳에서 이 항목이 바뀌었어요",
            "최신 내용을 불러왔습니다. 다시 열어 확인한 뒤 저장해 주세요.",
          );
        } else if (status === "stale") {
          Alert.alert("최신 상태를 다시 불러왔어요", "파트너가 먼저 바꾼 내용이 있어 다시 선택해 주세요.");
        } else if (status === "active_request") {
          Alert.alert("먼저 대기 중인 변경을 확인해 주세요", "파트너 확인이 끝난 뒤 다음 항목을 저장할 수 있어요.");
        } else {
          Alert.alert("저장하지 못했어요", "기존 기록은 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.");
        }
      }
      await loadData();
      return { status };
    } finally {
      setPending(pendingKey, false);
    }
  }, [coupleId, loadData, pendingKeys, profileId, sessionFenceRef, setPending, submitCategoryMutation]);

  const markCategoryReviewed = useCallback(async (category: ChecklistCategoryView) => {
    const sessionToken = sessionFenceRef.capture();
    if (!sessionToken) return;
    const pendingKey = `${category.key}:__category`;
    if (pendingKeys.has(pendingKey)) return;
    setPending(pendingKey, true);
    try {
      const mutation = await checklistMutationQueueRef.current.enqueue(() => (
        submitCategoryMutation(category.key, sessionToken, (items) => ({
          checklist: items,
          status: calculatePlanningChecklistStatus(items),
        }))
      ));
      if (!sessionFenceRef.isCurrent(sessionToken)) return;
      const { outcome } = mutation;
      Alert.alert(
        outcome === "pending_partner"
          ? "파트너 확인을 요청했어요"
          : "우리 준비에 필요한 분야로 확인했어요",
        outcome === "pending_partner"
          ? "동의 전에는 기존 상태가 유지돼요."
          : "이제 항목별 상태와 기한을 정할 수 있어요.",
      );
    } catch (error) {
      if (!sessionFenceRef.isCurrent(sessionToken)) return;
      Alert.alert(
        "저장하지 못했어요",
        error instanceof ChecklistMutationError && error.code === "active_request"
          ? "먼저 대기 중인 변경의 파트너 확인을 끝내 주세요."
          : "기존 기록은 바꾸지 않았습니다. 다시 시도해 주세요.",
      );
    } finally {
      setPending(pendingKey, false);
      await loadData();
    }
  }, [loadData, pendingKeys, sessionFenceRef, setPending, submitCategoryMutation]);

  const toggleCategoryApplicability = useCallback(async (category: ChecklistCategoryView) => {
    const sessionToken = sessionFenceRef.capture();
    if (!sessionToken) return;
    const pendingKey = `${category.key}:__category`;
    if (pendingKeys.has(pendingKey)) return;
    setPending(pendingKey, true);
    try {
      const mutation = await checklistMutationQueueRef.current.enqueue(() => (
        submitCategoryMutation(
          category.key,
          sessionToken,
          (items) => ({
            checklist: items,
            status: category.status === "not_applicable"
              ? calculatePlanningChecklistStatus(items)
              : "not_applicable",
          }),
          { preserveReviewEvidence: true },
        )
      ));
      if (!sessionFenceRef.isCurrent(sessionToken)) return;
      const { outcome } = mutation;
      Alert.alert(
        outcome === "pending_partner"
          ? "파트너 확인을 요청했어요"
          : category.status === "not_applicable"
            ? "준비 목록에 다시 넣었어요"
            : "준비 목록에서 제외했어요",
        outcome === "pending_partner"
          ? "동의 전에는 기존 상태가 유지돼요."
          : "언제든 같은 자리에서 되돌릴 수 있어요.",
      );
    } catch (error) {
      Alert.alert(
        "저장하지 못했어요",
        error instanceof ChecklistMutationError && error.code === "active_request"
          ? "먼저 대기 중인 변경의 파트너 확인을 끝내 주세요."
          : "기존 기록은 바꾸지 않았습니다. 다시 시도해 주세요.",
      );
    } finally {
      setPending(pendingKey, false);
      await loadData();
    }
  }, [loadData, pendingKeys, sessionFenceRef, setPending, submitCategoryMutation]);

  function openDetail(category: ChecklistCategoryView, item: PlanningChecklistItem) {
    const normalized = normalizeChecklistItem(item);
    setDetailTarget({ categoryKey: category.key, itemId: item.id });
    setDetailBaseline(captureChecklistItemEditBaseline(normalized));
    setDetailState(normalized.state);
    setDetailDueDate(normalized.dueDate ?? "");
    setDetailNote(normalized.note ?? "");
    if (!normalized.assignee) {
      setAssigneeChoice("unassigned");
      setDetailPartnerAssigneeId(null);
      setExternalAssignee("");
    } else if (normalized.assignee.kind === "couple") {
      setAssigneeChoice("couple");
      setDetailPartnerAssigneeId(null);
      setExternalAssignee("");
    } else if (normalized.assignee.kind === "external") {
      setAssigneeChoice("external");
      setDetailPartnerAssigneeId(null);
      setExternalAssignee(normalized.assignee.label);
    } else if (normalized.assignee.profileId === profileId) {
      setAssigneeChoice("mine");
      setDetailPartnerAssigneeId(null);
      setExternalAssignee("");
    } else if (normalized.assignee.profileId === partnerProfileId) {
      setAssigneeChoice("partner");
      setDetailPartnerAssigneeId(normalized.assignee.profileId);
      setExternalAssignee("");
    } else {
      setAssigneeChoice("partner");
      setDetailPartnerAssigneeId(normalized.assignee.profileId);
      setExternalAssignee("");
    }
  }

  function closeDetail() {
    setDetailTarget(null);
    setDetailBaseline(null);
  }

  async function saveDetail() {
    if (!detailTarget || !selectedItem || !profileId) return;
    if (!detailBaseline || detailBaseline.itemId !== detailTarget.itemId) {
      Alert.alert(
        "최신 내용을 다시 확인해 주세요",
        "편집을 시작한 항목을 확인할 수 없어 저장하지 않았습니다.",
      );
      closeDetail();
      await loadData();
      return;
    }
    if (!validateChecklistDueDate(detailDueDate)) {
      Alert.alert("기한을 확인해 주세요", "YYYY-MM-DD 형식의 실제 날짜로 적어 주세요.");
      return;
    }
    const normalizedExternalAssignee = normalizeChecklistNote(externalAssignee);
    if (assigneeChoice === "external" && normalizedExternalAssignee.length === 0) {
      Alert.alert("담당 이름을 적어 주세요", "업체·플래너·가족처럼 확인할 이름을 적어 주세요.");
      return;
    }
    let assignee: PlanningChecklistAssignee | null = null;
    if (assigneeChoice === "mine") assignee = { kind: "member", profileId };
    const selectedPartnerId = partnerProfileId ?? detailPartnerAssigneeId;
    if (assigneeChoice === "partner" && selectedPartnerId) {
      assignee = { kind: "member", profileId: selectedPartnerId };
    }
    if (assigneeChoice === "couple") assignee = { kind: "couple" };
    if (assigneeChoice === "external") assignee = { kind: "external", label: normalizedExternalAssignee };

    const mutationPlan = planChecklistDetailMutations(detailBaseline, {
      state: detailState,
      assignee,
      dueDate: detailDueDate || null,
      note: normalizeChecklistNote(detailNote),
    });
    if (!mutationPlan.routinePatch && !mutationPlan.assigneePatch) {
      closeDetail();
      return;
    }

    setDetailSaving(true);
    try {
      const execution = await executeChecklistDetailMutationPlan(
        mutationPlan,
        detailBaseline,
        (patch, expectedBaseline, stage) => saveItemPatch(
          detailTarget.categoryKey,
          detailTarget.itemId,
          patch,
          {
            expectedBaseline,
            preserveReviewEvidence: stage === "assignee",
            showAlerts: false,
            stage,
          },
        ),
      );

      if (execution.status === "applied" || execution.status === "no_changes") {
        closeDetail();
        return;
      }
      if (execution.status === "pending_partner") {
        Alert.alert(
          execution.stage === "assignee" ? "담당 변경 확인을 요청했어요" : "파트너 확인을 요청했어요",
          execution.routineApplied
            ? "상태·기한·메모는 저장했고, 담당 변경은 파트너 확인을 기다려요."
            : "파트너가 동의하기 전에는 기존 기록이 유지돼요.",
        );
        closeDetail();
        return;
      }

      if (execution.status === "conflict" || execution.status === "stale") {
        Alert.alert(
          execution.routineApplied ? "담당 변경은 보내지 않았어요" : "다른 곳에서 이 항목이 바뀌었어요",
          execution.routineApplied
            ? "상태·기한·메모는 저장했지만, 그 사이 항목이 바뀌어 담당 변경은 보내지 않았습니다."
            : "최신 내용을 불러왔습니다. 다시 열어 확인한 뒤 저장해 주세요.",
        );
        closeDetail();
        return;
      }
      if (execution.status === "active_request") {
        Alert.alert(
          execution.routineApplied ? "담당 변경은 아직 보내지 않았어요" : "먼저 대기 중인 변경을 확인해 주세요",
          execution.routineApplied
            ? "상태·기한·메모는 저장했어요. 기존 확인 요청이 끝난 뒤 담당을 다시 선택해 주세요."
            : "파트너 확인이 끝난 뒤 이 항목을 다시 저장해 주세요.",
        );
        closeDetail();
        return;
      }

      Alert.alert(
        execution.routineApplied ? "담당 변경 상태를 확인하지 못했어요" : "저장하지 못했어요",
        execution.routineApplied
          ? "상태·기한·메모는 저장했어요. 담당 변경은 최신 화면과 확인 요청에서 다시 확인해 주세요."
          : "기존 기록은 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.",
      );
      if (execution.routineApplied) closeDetail();
    } finally {
      setDetailSaving(false);
    }
  }

  function focusRecommendedItem(target: { categoryKey: string; itemId: string }) {
    setQuery("");
    setListFilter("all");
    setHideCompleted(false);
    setExpandedKey(target.categoryKey);
    setHighlightedItemId(target.itemId);
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, (categoryOffsetsRef.current[target.categoryKey] ?? 0) - 20),
        animated: true,
      });
    }, 80);
    setTimeout(() => setHighlightedItemId(null), 2400);
    const focusTarget = findChecklistItemTarget(categories, target);
    if (focusTarget) openDetail(focusTarget.category, focusTarget.item);
  }

  function focusReviewCategory(categoryKey: string) {
    setQuery("");
    setListFilter("all");
    setHideCompleted(false);
    setExpandedKey(categoryKey);
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, (categoryOffsetsRef.current[categoryKey] ?? 0) - 20),
        animated: true,
      });
    }, 80);
  }

  function openSituationSetup() {
    setSituationDraft(situationProfile?.answers ?? DEFAULT_SITUATION_ANSWERS);
    setSituationPreviewPlan(null);
    setSituationPreviewVisible(false);
    setSituationVisible(true);
  }

  function closeSituationSetup() {
    setSituationVisible(false);
    setSituationPreviewVisible(false);
    setSituationPreviewPlan(null);
  }

  function previewSituationProfile() {
    const sessionToken = sessionFenceRef.capture();
    if (
      !sessionToken
      || !loadedChecklistSnapshot
      || loadedChecklistSnapshot.coupleId !== sessionToken.coupleId
      || loadedChecklistSnapshot.ownerId !== sessionToken.ownerId
    ) {
      Alert.alert(
        "최신 준비 목록을 먼저 확인해 주세요",
        "목록을 다시 불러온 뒤 상황 설정 미리보기를 만들어 주세요.",
      );
      void loadData();
      return;
    }
    const rawLatestProfile = loadedChecklistSnapshot.progress[PLANNING_CHECKLIST_PROFILE_KEY];
    const latestProfile = readSituationProfile(rawLatestProfile);
    const application = applyPlanningChecklistProfile(
      CATEGORY_CHECKLISTS,
      loadedChecklistSnapshot.progress,
      {
        version: 1,
        reviewedAt: new Date().toISOString(),
        answers: situationDraft,
        autoExcludedItemIds: isCanonicalPlanningChecklistProfile(rawLatestProfile)
          ? latestProfile?.autoExcludedItemIds ?? []
          : [],
      },
      CHECKLIST_ITEM_GUIDANCE,
      sessionToken.ownerId,
    );
    if (isChecklistSituationApplicationNoop(
      isCanonicalPlanningChecklistProfile(rawLatestProfile) ? latestProfile : null,
      application,
    )) {
      setSituationPreviewPlan(null);
      setSituationPreviewVisible(false);
      Alert.alert("변경할 내용이 없어요", "이미 같은 상황 설정이 반영되어 있어요.");
      return;
    }
    const previewPlan = createChecklistSituationPreviewPlan({
      coupleId: sessionToken.coupleId,
      ownerId: sessionToken.ownerId,
      stateRevision: loadedChecklistSnapshot.stateRevision,
      application,
    });
    setSituationPreviewPlan(previewPlan);
    setSituationPreviewVisible(true);
  }

  async function applySituationProfile() {
    const sessionToken = sessionFenceRef.capture();
    const previewPlan = situationPreviewPlan;
    if (
      !sessionToken
      || !previewPlan
      || previewPlan.coupleId !== sessionToken.coupleId
      || previewPlan.ownerId !== sessionToken.ownerId
    ) {
      setSituationPreviewPlan(null);
      setSituationPreviewVisible(false);
      Alert.alert(
        "미리보기를 다시 확인해 주세요",
        "최신 준비 목록을 기준으로 제외·복원 항목을 다시 보여드릴게요.",
      );
      await loadData();
      return;
    }
    setSituationSaving(true);
    try {
      const mutationResult = await checklistMutationQueueRef.current.enqueue(async () => {
        if (!sessionFenceRef.isCurrent(sessionToken)) throw new ChecklistMutationError("failed");
        const submission = buildChecklistSituationPreviewSubmission(previewPlan);

        const response = await apiFetchForExpectedUser(sessionToken.ownerId, "/api/journey", {
          method: "PATCH",
          body: JSON.stringify(submission),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 409 && isRecord(payload) && payload.code === "PLAN_CHANGE_STALE") {
            throw new ChecklistMutationError("stale");
          }
          if (response.status === 409 && isRecord(payload) && payload.code === "PLAN_CHANGE_ACTIVE_REQUEST") {
            throw new ChecklistMutationError("active_request");
          }
          throw new ChecklistMutationError("failed");
        }
        return {
          outcome: readMutationOutcome(payload),
          excludedCount: previewPlan.excludedItemIds.length,
          restoredCount: previewPlan.restoredItemIds.length,
        };
      });
      if (!sessionFenceRef.isCurrent(sessionToken)) return;
      closeSituationSetup();
      Alert.alert(
        mutationResult.outcome === "pending_partner" ? "파트너 확인을 요청했어요" : "우리 상황을 반영했어요",
        mutationResult.outcome === "pending_partner"
          ? "동의 전에는 기존 체크리스트가 유지돼요."
          : `${mutationResult.excludedCount}개를 제외하고 ${mutationResult.restoredCount}개를 다시 준비 목록에 넣었어요. 삭제한 항목은 없어요.`,
      );
    } catch (error) {
      if (error instanceof ChecklistMutationError && error.code === "stale") {
        setSituationPreviewPlan(null);
        setSituationPreviewVisible(false);
      }
      Alert.alert(
        error instanceof ChecklistMutationError && error.code === "stale"
          ? "준비 목록이 바뀌어 미리보기를 새로 만들어야 해요"
          : "상황 설정을 저장하지 못했어요",
        error instanceof ChecklistMutationError && error.code === "active_request"
          ? "먼저 대기 중인 변경의 파트너 확인을 끝내 주세요."
          : error instanceof ChecklistMutationError && error.code === "stale"
            ? "기존 상태는 바꾸지 않았어요. 최신 내용에서 제외·복원 항목을 다시 확인해 주세요."
            : "기존 상태는 바꾸지 않았습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.",
      );
    } finally {
      setSituationSaving(false);
      await loadData();
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingState label="두 사람의 체크리스트를 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="웨딩 체크리스트"
        subtitle="오늘 할 일부터 결혼식 뒤 정리까지"
        onBack={() => router.back()}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadData();
              setRefreshing(false);
            }}
            tintColor={colors.rose[500]}
          />
        )}
      >
        {loadError ? (
          <Surface tone="ivory" style={styles.noticeSurface}>
            <View style={styles.noticeRow} accessibilityRole="alert">
              <AlertTriangle size={18} color={colors.warning} />
              <View style={styles.flexOne}>
                <AppText variant="bodyStrong">기록을 안전하게 불러오지 못했어요</AppText>
                <AppText variant="caption">기존 내용은 바꾸지 않았습니다. 다시 불러와 주세요.</AppText>
              </View>
              <Pressable onPress={() => void loadData()} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>다시 불러오기</Text>
              </Pressable>
            </View>
          </Surface>
        ) : null}

        <Pressable
          onPress={openSituationSetup}
          style={({ pressed }) => [styles.situationBanner, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="우리 상황 설정 열기"
        >
          <View style={styles.situationIcon}><Check size={17} color={colors.rose[600]} /></View>
          <View style={styles.flexOne}>
            <AppText variant="bodyStrong">우리 상황 설정</AppText>
            <AppText variant="caption">
              {situationProfile
                ? `마지막 검토 ${situationProfile.reviewedAt.slice(0, 10)} · 다시 맞추기`
                : "예식·여행·주거·선택 의례를 먼저 맞추면 불필요한 항목을 줄일 수 있어요."}
            </AppText>
          </View>
          <Text style={styles.openLabel}>{situationProfile ? "수정" : "시작"}</Text>
        </Pressable>

        <Surface style={styles.focusSurface}>
          <View style={styles.sectionHeading}>
            <View>
              <AppText variant="eyebrow">TODAY FIRST</AppText>
              <AppText variant="subtitle">오늘 무엇이 중요한가요?</AppText>
            </View>
            <CalendarDays size={20} color={colors.rose[500]} />
          </View>
          <View style={styles.segmentedControl} accessibilityRole="tablist">
            {([
              ["today", "오늘 할 일", insights.today.length],
              ["week", "이번 주", insights.upcoming.filter((item) => typeof item.daysUntilDue === "number" && item.daysUntilDue > 0 && item.daysUntilDue <= 7).length],
              ["overdue", "늦은 일", insights.overdue.length],
            ] as Array<[FocusTab, string, number]>).map(([value, label, count]) => (
              <Pressable
                key={value}
                onPress={() => setFocusTab(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: focusTab === value }}
                style={[styles.segment, focusTab === value && styles.segmentActive]}
              >
                <Text style={[styles.segmentLabel, focusTab === value && styles.segmentLabelActive]}>
                  {label} {count}
                </Text>
              </Pressable>
            ))}
          </View>
          {focusItems.length > 0 ? focusItems.slice(0, 5).map((item) => (
            <Pressable
              key={`${item.categoryKey}:${item.itemId}`}
              onPress={() => focusRecommendedItem(item)}
              style={({ pressed }) => [styles.focusRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.categoryLabel}, ${item.label} 항목으로 이동`}
            >
              <View style={styles.focusIcon}>
                {focusTab === "overdue"
                  ? <AlertTriangle size={17} color={colors.danger} />
                  : <Clock3 size={17} color={colors.rose[500]} />}
              </View>
              <View style={styles.flexOne}>
                <AppText variant="bodyStrong" numberOfLines={2}>{item.label}</AppText>
                <AppText variant="caption">
                  {item.categoryLabel} · {formatDueDate(item.dueDate, todayKey)}
                </AppText>
              </View>
              <Text style={styles.openLabel}>열기</Text>
            </Pressable>
          )) : (
            <>
              <View style={styles.calmState}>
                <CheckCircle2 size={24} color={colors.rose[500]} />
                <View style={styles.flexOne}>
                  <AppText variant="bodyStrong">{emptyFocusPresentation.emptyTitle}</AppText>
                  <AppText variant="caption">
                    기한을 정하지 않은 항목과 실제 업체·가족 일정은 자동으로 확정하지 않아요.
                  </AppText>
                </View>
              </View>
              {emptyFocusPresentation.reviewTitle ? (
                <View style={styles.reviewSuggestions}>
                  <View style={styles.reviewHeaderRow}>
                    <AppText variant="bodyStrong">{emptyFocusPresentation.reviewTitle}</AppText>
                    {!situationProfile ? (
                      <Pressable onPress={openSituationSetup} style={styles.textButton}>
                        <Text style={styles.openLabel}>상황 설정</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <AppText variant="caption">
                    아직 확인하지 않은 분야는 할 일이나 늦은 일로 세지 않아요. 해당 여부부터 정해 주세요.
                  </AppText>
                  {emptyFocusPresentation.reviewSuggestions.map((suggestion) => (
                    <Pressable
                      key={`review:${suggestion.categoryKey}`}
                      onPress={() => focusReviewCategory(suggestion.categoryKey)}
                      style={({ pressed }) => [styles.focusRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`${suggestion.categoryLabel} 분야 검토하기`}
                    >
                      <View style={styles.focusIcon}><Circle size={17} color={colors.rose[500]} /></View>
                      <View style={styles.flexOne}>
                        <AppText variant="bodyStrong">{suggestion.categoryLabel}</AppText>
                        <AppText variant="caption">해당 여부와 준비 항목을 먼저 확인해요</AppText>
                      </View>
                      <Text style={styles.openLabel}>검토</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </Surface>

        <Surface tone="noir" style={styles.summarySurface}>
          <View style={styles.summaryTop}>
            <View>
              <AppText variant="caption" style={styles.summaryEyebrow}>전체 준비 진행률</AppText>
              <Text style={styles.summaryPercent}>{summary.percent}%</Text>
            </View>
            <View style={styles.summaryMeta}>
              <Text style={styles.summaryMetaStrong}>{summary.done}/{summary.total}</Text>
              <Text style={styles.summaryMetaText}>항목 완료</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${summary.percent}%` }]} />
          </View>
          <Text style={styles.summaryNote}>
            {summary.reviewedCategories}/{CATEGORY_CHECKLISTS.length}개 분야 검토 · 검토 범위 {summary.coveragePercent}%
          </Text>
          {summary.unreviewedCategories > 0 ? (
            <Text style={styles.summaryCaution}>
              아직 검토하지 않은 {summary.unreviewedCategories}개 분야도 전체 진행률에 포함했어요.
            </Text>
          ) : null}
        </Surface>

        <View style={styles.searchSection}>
          <View style={styles.searchInputWrap}>
            <Search size={18} color={colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="항목·카테고리·메모 검색"
              placeholderTextColor={colors.textTertiary}
              style={styles.searchInput}
              accessibilityLabel="체크리스트 검색"
              maxLength={100}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="검색어 지우기">
                <X size={18} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {LIST_FILTER_OPTIONS.filter((option) => (
              option.value !== "partner" || partnerProfileId !== null
            )).map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setListFilter(option.value)}
                style={[styles.filterChip, listFilter === option.value && styles.filterChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: listFilter === option.value }}
              >
                <Text style={[styles.filterChipLabel, listFilter === option.value && styles.filterChipLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setHideCompleted((value) => !value)}
              style={[styles.filterChip, hideCompleted && styles.filterChipActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hideCompleted }}
            >
              <Text style={[styles.filterChipLabel, hideCompleted && styles.filterChipLabelActive]}>
                완료 숨기기
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        <View style={styles.listHeading}>
          <View>
            <AppText variant="eyebrow">FULL JOURNEY</AppText>
            <AppText variant="subtitle">전체 체크리스트</AppText>
          </View>
          <AppText variant="caption">{filteredCategories.length}개 분야</AppText>
        </View>

        {filteredCategories.length === 0 ? (
          <Surface tone="ivory">
            <View style={styles.emptyState}>
              <Search size={24} color={colors.textTertiary} />
              <AppText variant="bodyStrong">조건에 맞는 항목이 없어요</AppText>
              <AppText variant="caption">검색어나 필터를 바꿔 보세요.</AppText>
            </View>
          </Surface>
        ) : filteredCategories.map((category) => {
          const counts = getCategoryCounts(category);
          const expanded = expandedKey === category.key;
          const categoryPending = pendingKeys.has(`${category.key}:__category`);
          const reviewPresentation = buildChecklistCategoryReviewPresentation(
            category.reviewed,
            counts.skipped,
          );
          return (
            <View
              key={category.key}
              style={styles.categorySection}
              onLayout={(event) => {
                categoryOffsetsRef.current[category.key] = event.nativeEvent.layout.y;
              }}
            >
              <Pressable
                onPress={() => setExpandedKey(expanded ? null : category.key)}
                style={styles.categoryHeader}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${category.label} 체크리스트`}
              >
                <View style={styles.flexOne}>
                  <AppText variant="subtitle">{category.label}</AppText>
                  <AppText variant="caption">
                    {counts.skipped
                      ? "우리에게 해당 없음 · 전체 진행률에서 제외"
                      : !category.reviewed
                        ? "아직 우리에게 필요한지 검토 전"
                        : `${counts.done}/${counts.total} 완료`}
                  </AppText>
                </View>
                <Text style={styles.categoryPercent}>
                  {counts.skipped ? "제외" : !category.reviewed ? "검토" : `${counts.percent}%`}
                </Text>
                {expanded
                  ? <ChevronUp size={20} color={colors.textTertiary} />
                  : <ChevronDown size={20} color={colors.textTertiary} />}
              </Pressable>
              {!counts.skipped ? (
                <View style={styles.categoryTrack}>
                  <View style={[styles.categoryFill, { width: `${counts.percent}%` }]} />
                </View>
              ) : null}
              {expanded ? (
                <View style={styles.itemList}>
                  {reviewPresentation.showChoices ? (
                    <View style={styles.reviewChoiceCard}>
                      <AppText variant="bodyStrong">{reviewPresentation.question}</AppText>
                      <AppText variant="caption">
                        자동으로 제외하지 않아요. 두 사람이 실제 준비 범위를 보고 선택해 주세요.
                      </AppText>
                      <View style={styles.reviewChoiceActions}>
                        <PrimaryButton
                          tone="rose"
                          style={styles.reviewChoiceButton}
                          disabled={categoryPending}
                          onPress={() => void markCategoryReviewed(category)}
                          accessibilityLabel={`${category.label}, ${reviewPresentation.applicableLabel}`}
                        >
                          {categoryPending
                            ? <ActivityIndicator color="#fff" />
                            : reviewPresentation.applicableLabel}
                        </PrimaryButton>
                        <PrimaryButton
                          tone="ghost"
                          style={styles.reviewChoiceButton}
                          disabled={categoryPending}
                          onPress={() => void toggleCategoryApplicability(category)}
                          accessibilityLabel={`${category.label}, ${reviewPresentation.notApplicableLabel}`}
                        >
                          {reviewPresentation.notApplicableLabel}
                        </PrimaryButton>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => void toggleCategoryApplicability(category)}
                      disabled={categoryPending}
                      style={({ pressed }) => [styles.applicabilityRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={counts.skipped
                        ? `${category.label} 다시 준비하기`
                        : `${category.label} 준비 목록에서 제외하기`}
                    >
                      {categoryPending
                        ? <ActivityIndicator size="small" color={colors.textTertiary} />
                        : <Ban size={18} color={colors.textTertiary} />}
                      <Text style={styles.applicabilityLabel}>
                        {counts.skipped ? "이 분야 다시 준비하기" : "우리는 이 분야를 준비하지 않아요"}
                      </Text>
                    </Pressable>
                  )}
                  {category.items.map((item) => {
                    const normalized = normalizeChecklistItem(item);
                    const completionAudit = formatChecklistCompletionAudit(
                      normalized,
                      coupleMemberNames,
                    );
                    const itemPending = pendingKeys.has(`${category.key}:${item.id}`);
                    const highlighted = highlightedItemId === item.id;
                    return (
                      <View
                        key={item.id}
                        style={[styles.itemRow, highlighted && styles.itemHighlighted]}
                      >
                        <Pressable
                          onPress={() => void saveItemPatch(category.key, item.id, {
                            state: normalized.state === "completed" ? "todo" : "completed",
                          })}
                          disabled={counts.skipped || itemPending}
                          style={styles.checkButton}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: normalized.state === "completed", disabled: counts.skipped || itemPending }}
                          accessibilityLabel={`${item.label} 완료 상태 바꾸기`}
                        >
                          {itemPending
                            ? <ActivityIndicator size="small" color={colors.rose[500]} />
                            : normalized.state === "completed"
                              ? <CheckCircle2 size={23} color={colors.rose[500]} />
                              : <Circle size={23} color={colors.taupe[400]} />}
                        </Pressable>
                        <Pressable
                          onPress={() => openDetail(category, item)}
                          disabled={counts.skipped}
                          style={({ pressed }) => [styles.itemBody, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.label} 상세 열기`}
                        >
                          <Text style={[styles.itemLabel, normalized.state === "completed" && styles.itemDone]}>
                            {item.label}
                          </Text>
                          <View style={styles.itemMetaRow}>
                            <StatusPill label={getChecklistStateLabel(normalized.state)} tone={stateTone(normalized.state)} />
                            <Text style={styles.itemMeta}>{assigneeLabel(normalized.assignee, profileId)}</Text>
                            <Text style={[
                              styles.itemMeta,
                              normalized.dueDate && normalized.dueDate < todayKey && normalized.state !== "completed"
                                ? styles.itemMetaDanger
                                : undefined,
                            ]}>
                              {formatDueDate(normalized.dueDate, todayKey)}
                            </Text>
                          </View>
                          {completionAudit ? (
                            <Text style={styles.completionAudit}>{completionAudit}</Text>
                          ) : null}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={detailTarget !== null}
        animationType="slide"
        transparent
        onRequestClose={() => !detailSaving && closeDetail()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.detailSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.detailHeader}>
              <View style={styles.flexOne}>
                <AppText variant="eyebrow">ITEM DETAIL</AppText>
                <AppText variant="subtitle" numberOfLines={2}>{selectedItem?.label ?? "준비 항목"}</AppText>
              </View>
              <Pressable
                onPress={closeDetail}
                disabled={detailSaving}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="항목 상세 닫기"
              >
                <X size={24} color={colors.textTertiary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.guidanceBlock}>
                <Text style={styles.guidanceTitle}>완료 기준</Text>
                <Text style={styles.guidanceText}>{selectedGuidance?.completionCriteria}</Text>
              </View>
              <View style={styles.guidanceBlock}>
                <Text style={styles.guidanceTitle}>팁</Text>
                <Text style={styles.guidanceText}>{selectedGuidance?.tip}</Text>
              </View>
              <View style={[styles.guidanceBlock, styles.cautionBlock]}>
                <Text style={styles.guidanceTitle}>주의</Text>
                <Text style={styles.guidanceText}>{selectedGuidance?.caution}</Text>
              </View>
              {selectedGuidance?.sourceRefs && selectedGuidance.sourceRefs.length > 0 ? (
                <View style={styles.guidanceSources}>
                  <Text style={styles.guidanceTitle}>공식 근거</Text>
                  <AppText variant="caption" style={styles.fieldHint}>
                    법·행정·안전 정보는 마지막 원문 확인일을 함께 표시해요.
                  </AppText>
                  {selectedGuidance.sourceRefs.map((source) => (
                    <Pressable
                      key={source.url}
                      onPress={() => void Linking.openURL(source.url).catch(() => {
                        Alert.alert("공식 원문을 열지 못했어요", "인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
                      })}
                      style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}
                      accessibilityRole="link"
                      accessibilityLabel={`${source.title}, ${source.checkedAt} 원문 확인`}
                    >
                      <View style={styles.flexOne}>
                        <AppText variant="bodyStrong">{source.title}</AppText>
                        <AppText variant="caption">{source.checkedAt} 원문 확인</AppText>
                      </View>
                      <Text style={styles.openLabel}>열기</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {selectedCompletionAudit ? (
                <View style={styles.completionAuditBlock}>
                  <CheckCircle2 size={17} color={colors.success} />
                  <Text style={styles.completionAuditText}>{selectedCompletionAudit}</Text>
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>진행 상태</Text>
              <View style={styles.wrapRow}>
                {ITEM_STATE_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => setDetailState(option.value)}
                    style={[styles.optionChip, detailState === option.value && styles.optionChipActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: detailState === option.value }}
                  >
                    {detailState === option.value ? <Check size={14} color="#fff" /> : null}
                    <Text style={[styles.optionChipLabel, detailState === option.value && styles.optionChipLabelActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>담당</Text>
              <View style={styles.wrapRow}>
                {([
                  ["unassigned", "미정", <Circle key="u" size={14} color={colors.textTertiary} />],
                  ["mine", "나", <UserRound key="m" size={14} color={colors.textTertiary} />],
                  ...(partnerProfileId || detailPartnerAssigneeId
                    ? [["partner", `${partnerDisplayName ?? "파트너"} 담당`, <UserRound key="p" size={14} color={colors.textTertiary} />] as const]
                    : []),
                  ["couple", "우리 둘", <UsersRound key="c" size={14} color={colors.textTertiary} />],
                  ["external", "외부 담당", <UserRound key="e" size={14} color={colors.textTertiary} />],
                ] as Array<[AssigneeChoice, string, React.ReactNode]>).map(([value, label, icon]) => (
                  <Pressable
                    key={value}
                    onPress={() => setAssigneeChoice(value)}
                    style={[styles.optionChip, assigneeChoice === value && styles.optionChipActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: assigneeChoice === value }}
                    accessibilityLabel={label}
                  >
                    {icon}
                    <Text style={[styles.optionChipLabel, assigneeChoice === value && styles.optionChipLabelActive]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {assigneeChoice === "external" ? (
                <TextInput
                  value={externalAssignee}
                  onChangeText={setExternalAssignee}
                  placeholder="예: 플래너, 예식장 담당자"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  maxLength={80}
                  accessibilityLabel="외부 담당 이름"
                />
              ) : null}

              <View style={styles.sharingNotice}>
                <UsersRound size={17} color={colors.rose[600]} />
                <AppText variant="caption" style={styles.flexOne}>
                  {getChecklistSharingNotice(Boolean(partnerProfileId || detailPartnerAssigneeId))}
                </AppText>
              </View>

              <Text style={styles.fieldLabel}>기한</Text>
              <TextInput
                value={detailDueDate}
                onChangeText={setDetailDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              <AppText variant="caption" style={styles.fieldHint}>
                업체 계약서나 가족과 합의한 실제 날짜를 우선해 적어 주세요.
              </AppText>

              <Text style={styles.fieldLabel}>메모</Text>
              <TextInput
                value={detailNote}
                onChangeText={setDetailNote}
                placeholder="다음 행동이나 확인할 질문을 적어 두세요"
                placeholderTextColor={colors.textTertiary}
                style={[styles.input, styles.noteInput]}
                multiline
                maxLength={1000}
                textAlignVertical="top"
              />
              <AppText variant="caption" style={styles.fieldHint}>
                건강정보·신분증 번호·계좌번호 같은 민감한 내용은 적지 마세요.
              </AppText>
            </ScrollView>
            <View style={styles.detailActions}>
              <PrimaryButton
                tone="ghost"
                style={styles.detailButton}
                disabled={detailSaving}
                onPress={closeDetail}
              >
                취소
              </PrimaryButton>
              <PrimaryButton
                tone="rose"
                style={styles.detailButton}
                disabled={detailSaving}
                onPress={() => void saveDetail()}
              >
                {detailSaving ? <ActivityIndicator color="#fff" /> : "저장하기"}
              </PrimaryButton>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={situationVisible}
        animationType="slide"
        transparent
        onRequestClose={() => !situationSaving && closeSituationSetup()}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.situationSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.detailHeader}>
              <View style={styles.flexOne}>
                <AppText variant="eyebrow">PERSONALIZE</AppText>
                <AppText variant="subtitle">우리 상황 설정</AppText>
                <AppText variant="caption">
                  민감한 상세는 묻거나 저장하지 않고, 준비 여부를 구분하는 최소 선택만 사용해요.
                </AppText>
              </View>
              <Pressable
                onPress={closeSituationSetup}
                disabled={situationSaving}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="우리 상황 설정 닫기"
              >
                <X size={24} color={colors.textTertiary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {!situationPreviewVisible ? SITUATION_QUESTIONS.map((question) => (
                <View key={question.key} style={styles.situationQuestion}>
                  <AppText variant="bodyStrong">{question.label}</AppText>
                  <AppText variant="caption">{question.help}</AppText>
                  <View style={styles.wrapRow}>
                    {question.options.map((option) => {
                      const selected = situationDraft[question.key] === option.value;
                      return (
                        <Pressable
                          key={`${question.key}:${String(option.value)}`}
                          onPress={() => setSituationDraft((current) => ({
                            ...current,
                            [question.key]: option.value,
                          }) as PlanningChecklistProfileAnswers)}
                          style={[styles.optionChip, selected && styles.optionChipActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.optionChipLabel, selected && styles.optionChipLabelActive]}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )) : (
                <View>
                  <AppText variant="eyebrow">적용 전 미리보기</AppText>
                  <AppText variant="subtitle">
                    적용 후 제외 {situationExclusionItems.length}개 · 이번에 복원 {situationRestoreItems.length}개
                  </AppText>
                  <AppText variant="body" style={styles.previewIntro}>
                    적용 후 ‘해당 없음’으로 유지될 항목과 이번에 복원될 항목이에요. 직접 ‘해당 없음’으로 둔 항목은 그대로 보존해요.
                  </AppText>
                  {situationExclusionItems.length === 0 ? (
                    <Surface tone="ivory" style={styles.previewEmpty}>
                      <AppText variant="bodyStrong">제외 예정 항목이 없어요</AppText>
                      <AppText variant="caption">미정 선택은 자동 제외하지 않아요.</AppText>
                    </Surface>
                  ) : situationExclusionItems.map((item) => (
                    <View key={item.itemId} style={styles.previewRow}>
                      <Ban size={16} color={colors.textTertiary} />
                      <View style={styles.flexOne}>
                        <AppText variant="bodyStrong">{item.label}</AppText>
                        <AppText variant="caption">{item.categoryLabel}</AppText>
                      </View>
                    </View>
                  ))}
                  {situationRestoreItems.length > 0 ? (
                    <View style={styles.restorePreviewSection}>
                      <AppText variant="bodyStrong">다시 준비 목록에 넣을 항목</AppText>
                      {situationRestoreItems.map((item) => (
                        <View key={`restore:${item.itemId}`} style={styles.previewRow}>
                          <CheckCircle2 size={16} color={colors.rose[500]} />
                          <View style={styles.flexOne}>
                            <AppText variant="bodyStrong">{item.label}</AppText>
                            <AppText variant="caption">{item.categoryLabel}</AppText>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </ScrollView>
            <View style={styles.detailActions}>
              <PrimaryButton
                tone="ghost"
                style={styles.detailButton}
                disabled={situationSaving}
                onPress={() => {
                  if (situationModalFooter.secondaryAction === "edit") {
                    setSituationPreviewPlan(null);
                    setSituationPreviewVisible(false);
                  } else closeSituationSetup();
                }}
              >
                {situationModalFooter.secondaryLabel}
              </PrimaryButton>
              <PrimaryButton
                tone="rose"
                style={styles.detailButton}
                disabled={situationSaving}
                onPress={() => {
                  if (situationPreviewVisible) void applySituationProfile();
                  else previewSituationProfile();
                }}
              >
                {situationSaving
                  ? <ActivityIndicator color="#fff" />
                  : situationModalFooter.primaryLabel}
              </PrimaryButton>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 120, gap: 16 },
  flexOne: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  noticeSurface: { padding: 14 },
  noticeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  situationBanner: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.rose.glow, borderWidth: 1, borderColor: colors.rose.pale },
  situationIcon: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  textButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  textButtonLabel: { fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  focusSurface: { padding: 18 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  segmentedControl: { flexDirection: "row", backgroundColor: colors.ivory[200], borderRadius: 14, padding: 3, marginBottom: 8 },
  segment: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 11, paddingHorizontal: 4 },
  segmentActive: { backgroundColor: colors.surface },
  segmentLabel: { fontSize: 12, color: colors.textSecondary },
  segmentLabelActive: { color: colors.noir[800], fontWeight: "700" },
  focusRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  focusIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.rose.glow, alignItems: "center", justifyContent: "center" },
  openLabel: { fontSize: 12, fontWeight: "700", color: colors.rose[600] },
  calmState: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 18 },
  reviewSuggestions: { paddingTop: 8 },
  reviewHeaderRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summarySurface: { padding: 18 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  summaryEyebrow: { color: colors.gold.light },
  summaryPercent: { color: "#fff", fontSize: 42, lineHeight: 48, fontFamily: "CormorantGaramond_600SemiBold" },
  summaryMeta: { alignItems: "flex-end", paddingBottom: 5 },
  summaryMetaStrong: { color: "#fff", fontSize: 15, fontWeight: "700" },
  summaryMetaText: { color: colors.gold.light, fontSize: 11, marginTop: 2 },
  progressTrack: { height: 6, borderRadius: 999, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.16)", marginTop: 12 },
  progressFill: { height: "100%", backgroundColor: colors.rose[500], borderRadius: 999 },
  summaryNote: { color: colors.gold.light, fontSize: 12, lineHeight: 18, marginTop: 10 },
  summaryCaution: { color: "#fff", fontSize: 12, lineHeight: 18, marginTop: 3 },
  searchSection: { gap: 10 },
  searchInputWrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.noir[800], fontSize: 14, paddingVertical: 10 },
  filterRow: { gap: 8, paddingRight: 20 },
  filterChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.ivory[200], borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.noir[800], borderColor: colors.noir[800] },
  filterChipLabel: { fontSize: 12, color: colors.textSecondary },
  filterChipLabelActive: { color: "#fff", fontWeight: "700" },
  listHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 8 },
  emptyState: { alignItems: "center", gap: 6, paddingVertical: 24 },
  categorySection: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16 },
  categoryHeader: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  categoryPercent: { fontSize: 14, fontWeight: "700", color: colors.rose[500] },
  categoryTrack: { height: 4, borderRadius: 999, backgroundColor: colors.ivory[200], overflow: "hidden", marginBottom: 8 },
  categoryFill: { height: "100%", borderRadius: 999, backgroundColor: colors.rose[500] },
  itemList: { borderTopWidth: 1, borderTopColor: colors.border },
  reviewChoiceCard: { gap: 8, paddingVertical: 16 },
  reviewChoiceActions: { gap: 8, paddingTop: 4 },
  reviewChoiceButton: { width: "100%" },
  applicabilityRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  applicabilityLabel: { fontSize: 13, color: colors.textSecondary },
  itemRow: { minHeight: 76, flexDirection: "row", alignItems: "flex-start", borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10, marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 12 },
  itemHighlighted: { backgroundColor: colors.rose.glow, borderTopColor: colors.rose.pale },
  checkButton: { width: 44, minHeight: 52, alignItems: "flex-start", justifyContent: "center" },
  itemBody: { flex: 1, minWidth: 0, minHeight: 56, justifyContent: "center" },
  itemLabel: { fontSize: 14, lineHeight: 21, color: colors.noir[800] },
  itemDone: { color: colors.textTertiary, textDecorationLine: "line-through" },
  itemMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: 7 },
  itemMeta: { fontSize: 11, color: colors.textTertiary },
  itemMetaDanger: { color: colors.danger, fontWeight: "700" },
  completionAudit: { fontSize: 11, color: colors.success, marginTop: 5 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(13,13,15,0.42)", justifyContent: "flex-end" },
  detailSheet: { maxHeight: "92%", backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  situationSheet: { height: "94%", backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.taupe[400], marginBottom: 14 },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", gap: 16, marginBottom: 16 },
  guidanceBlock: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  cautionBlock: { marginBottom: 8 },
  guidanceTitle: { fontSize: 12, fontWeight: "700", color: colors.rose[600], marginBottom: 5 },
  guidanceText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  guidanceSources: { gap: 8, paddingTop: 12, paddingBottom: 4 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  completionAuditBlock: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  completionAuditText: { fontSize: 13, fontWeight: "700", color: colors.success },
  sharingNotice: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.rose.glow },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: colors.noir[800], marginTop: 18, marginBottom: 8 },
  fieldHint: { marginTop: 6 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.ivory[200], borderWidth: 1, borderColor: colors.border },
  optionChipActive: { backgroundColor: colors.noir[800], borderColor: colors.noir[800] },
  optionChipLabel: { fontSize: 12, color: colors.textSecondary },
  optionChipLabelActive: { color: "#fff", fontWeight: "700" },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 11, color: colors.noir[800], fontSize: 14 },
  noteInput: { minHeight: 96 },
  detailActions: { flexDirection: "row", gap: 10, paddingTop: 16 },
  detailButton: { flex: 1 },
  situationQuestion: { gap: 6, paddingVertical: 15, borderTopWidth: 1, borderTopColor: colors.border },
  previewIntro: { marginTop: 8, marginBottom: 12 },
  previewEmpty: { padding: 16, marginTop: 8 },
  previewRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  restorePreviewSection: { marginTop: 20 },
});
