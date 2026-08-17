import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowRight,
  BookOpenText,
  LockKeyhole,
  Search,
  Users,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import {
  AppHeader,
  AppText,
  EmptyState,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { apiFetchForExpectedUser } from "@/lib/api";
import {
  buildAmoraPreparationNotes,
  type AmoraPreparationNotesRecord,
  type AmoraPreparationNotesScopeFilter,
  type AmoraPreparationNotesTopicFilter,
  type AmoraPreparationNotesTypeFilter,
} from "@/lib/amoraPreparationNotes.mjs";
import {
  loadAmoraPreparationNotesSources,
  type AmoraPreparationNotesSources,
} from "@/lib/amoraPreparationNotesLoader.mjs";
import {
  DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT,
  formatLocalDateKey,
} from "@/lib/dashboardExperience.mjs";
import { buildChecklistDeepLinkParams } from "@/lib/scheduleChecklistNavigation.mjs";
import {
  buildScheduleIdentitySnapshot,
  isSameScheduleIdentitySnapshot,
  type ScheduleIdentitySnapshot,
} from "@/lib/scheduleSessionFence.mjs";
import { supabase } from "@/lib/supabase";

type ScreenLoadState = "loading" | "ready" | "error";

type NotesSnapshot = Readonly<{
  identity: ScheduleIdentitySnapshot;
  sources: AmoraPreparationNotesSources;
}>;

const TOPICS = Object.freeze(
  CATEGORY_CHECKLISTS.map(({ key, label }) => Object.freeze({ key, label })),
);

const SCOPE_FILTERS: readonly Readonly<{
  value: AmoraPreparationNotesScopeFilter;
  label: string;
}>[] = Object.freeze([
  Object.freeze({ value: "all", label: "전체" }),
  Object.freeze({ value: "owner_private", label: "나만 보기" }),
  Object.freeze({ value: "couple_shared", label: "함께 보기" }),
]);

// 확인·반영 영수증은 해당 source adapter가 연결된 뒤에만 필터에 노출한다.
// 지원하지 않는 유형을 빈 결과처럼 보여주는 것은 금지한다.
const TYPE_FILTERS: readonly Readonly<{
  value: AmoraPreparationNotesTypeFilter;
  label: string;
}>[] = Object.freeze([
  Object.freeze({ value: "all", label: "모든 기록" }),
  Object.freeze({ value: "saved_conversation", label: "저장 대화" }),
  Object.freeze({ value: "owner_criterion", label: "내 기준" }),
  Object.freeze({ value: "couple_criterion", label: "우리 기준" }),
]);

async function readCurrentNotesIdentity(): Promise<ScheduleIdentitySnapshot | null> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  const ownerId = auth.user?.id ?? null;
  if (authError || !ownerId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", ownerId)
    .maybeSingle();
  const coupleId = profile?.couple_id;
  if (profileError || typeof coupleId !== "string") return null;

  const { data: roster, error: rosterError } = await supabase
    .from("couples")
    .select("id, bride_id, groom_id")
    .eq("id", coupleId)
    .maybeSingle();
  if (rosterError) return null;

  return buildScheduleIdentitySnapshot({ ownerId, coupleId, roster });
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "저장 시각 확인 필요";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function allSourcesUnavailable(sources: AmoraPreparationNotesSources): boolean {
  return sources.messageReferenceReadState === "unavailable"
    && sources.ownerCriterionReadState === "unavailable"
    && sources.coupleCriterionReadState === "unavailable"
    && sources.actionReadState === "unavailable";
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} 필터${selected ? ", 선택됨" : ""}`}
      style={({ pressed }) => [
        styles.filterChip,
        selected && styles.filterChipSelected,
        pressed && styles.pressed,
      ]}
    >
      <AppText
        variant="caption"
        style={selected ? styles.filterTextSelected : styles.filterText}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function NotesRecordRow({
  record,
  onPress,
}: {
  record: AmoraPreparationNotesRecord;
  onPress: () => void;
}) {
  const topicLabel = record.topicLabels.length > 0
    ? record.topicLabels.join(" · ")
    : "준비 기준";
  const destinationLabel = record.type === "saved_conversation"
    ? "원문 대화 보기"
    : "기준 확인하기";
  const accessibilityLabel = [
    record.typeLabel,
    record.excerpt,
    topicLabel,
    record.scopeLabel,
    destinationLabel,
  ].join(", ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.recordRow, pressed && styles.pressed]}
    >
      <View style={styles.recordTopLine}>
        <AppText variant="eyebrow" style={styles.recordType}>
          {record.typeLabel}
        </AppText>
        <StatusPill label={record.scopeLabel} tone={record.scope === "owner_private" ? "neutral" : "success"} />
      </View>
      <AppText variant="bodyStrong" style={styles.recordExcerpt} numberOfLines={4}>
        {record.excerpt}
      </AppText>
      <View style={styles.recordMetaLine}>
        <AppText variant="caption" style={styles.recordMeta} numberOfLines={1}>
          {topicLabel} · {formatSavedAt(record.savedAt)}
        </AppText>
        <View style={styles.recordLink}>
          <AppText variant="caption" style={styles.recordLinkText}>
            {destinationLabel}
          </AppText>
          <ArrowRight size={14} color={colors.noir[800]} />
        </View>
      </View>
    </Pressable>
  );
}

export default function AmoraPreparationNotesScreen() {
  const [snapshot, setSnapshot] = useState<NotesSnapshot | null>(null);
  const [loadState, setLoadState] = useState<ScreenLoadState>("loading");
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<AmoraPreparationNotesScopeFilter>("all");
  const [topicFilter, setTopicFilter] = useState<AmoraPreparationNotesTopicFilter>("all");
  const [typeFilter, setTypeFilter] = useState<AmoraPreparationNotesTypeFilter>("all");
  const [usingLastVerified, setUsingLastVerified] = useState(false);
  const loadSequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const identityRef = useRef<ScheduleIdentitySnapshot | null>(null);
  const lastVerifiedSnapshotRef = useRef<NotesSnapshot | null>(null);
  const notesScrollRef = useRef<ScrollView | null>(null);
  const notesScrollOffsetRef = useRef(0);
  const pendingRestoreOffsetRef = useRef<number | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setLoadState("loading");
    setSnapshot(null);
    setUsingLastVerified(false);
    const priorSnapshot = lastVerifiedSnapshotRef.current;

    const isCurrent = () => (
      !signal.aborted && loadSequenceRef.current === loadSequence
    );

    try {
      const identity = await readCurrentNotesIdentity();
      if (!identity || !isCurrent()) throw new Error("AMORA_NOTES_IDENTITY_UNAVAILABLE");

      if (
        identityRef.current
        && !isSameScheduleIdentitySnapshot(identityRef.current, identity)
      ) {
        lastVerifiedSnapshotRef.current = null;
        pendingRestoreOffsetRef.current = null;
        notesScrollOffsetRef.current = 0;
        setQuery("");
        setScopeFilter("all");
        setTopicFilter("all");
        setTypeFilter("all");
      }

      const sources = await loadAmoraPreparationNotesSources({
        ownerId: identity.ownerId,
        coupleId: identity.coupleId,
        apiFetch: (path, options) => (
          apiFetchForExpectedUser(identity.ownerId, path, options)
        ),
        readOpenActions: async ({ coupleId, signal: actionSignal }) => {
          const { data, error } = await supabase
            .from("amora_actions")
            .select("id, couple_id, title, description, due_date, category_key, priority, source, status, follow_up_revision, created_at")
            .eq("couple_id", coupleId)
            .eq("status", "open")
            .order("created_at", { ascending: false })
            .limit(DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT)
            .abortSignal(actionSignal);
          if (error || !Array.isArray(data)) throw new Error("AMORA_NOTES_ACTIONS_UNAVAILABLE");
          return data;
        },
        isCurrent,
        signal,
      });

      const finalIdentity = await readCurrentNotesIdentity();
      if (
        !finalIdentity
        || !isCurrent()
        || !isSameScheduleIdentitySnapshot(identity, finalIdentity)
      ) throw new Error("AMORA_NOTES_IDENTITY_CHANGED");

      identityRef.current = finalIdentity;
      const sourceProjection = buildAmoraPreparationNotes({
        ownerId: finalIdentity.ownerId,
        coupleId: finalIdentity.coupleId,
        topics: TOPICS,
        ...sources,
        openActions: sources.openActions ?? undefined,
        todayYmd: formatLocalDateKey(),
        query: "",
        scopeFilter: "all",
        topicFilter: "all",
        typeFilter: "all",
      });
      if (
        (allSourcesUnavailable(sources) || sourceProjection.state === "read_error")
        && priorSnapshot
        && isSameScheduleIdentitySnapshot(priorSnapshot.identity, finalIdentity)
      ) {
        setSnapshot(priorSnapshot);
        setUsingLastVerified(true);
        setLoadState("ready");
        return;
      }

      const nextSnapshot = Object.freeze({ identity: finalIdentity, sources });
      if (sourceProjection.state !== "read_error") {
        lastVerifiedSnapshotRef.current = nextSnapshot;
      }
      setSnapshot(nextSnapshot);
      setLoadState("ready");
    } catch {
      if (!isCurrent()) return;
      identityRef.current = null;
      setSnapshot(null);
      setLoadState("error");
    }
  }, []);

  const reload = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    void load(controller.signal);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        loadSequenceRef.current += 1;
        controllerRef.current?.abort();
        controllerRef.current = null;
      };
    }, [reload]),
  );

  useEffect(() => {
    if (loadState !== "ready" || !snapshot) return undefined;
    const restoreOffset = pendingRestoreOffsetRef.current;
    if (restoreOffset === null) return undefined;
    pendingRestoreOffsetRef.current = null;
    const frame = requestAnimationFrame(() => {
      notesScrollRef.current?.scrollTo({ y: restoreOffset, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [loadState, snapshot]);

  const view = useMemo(() => {
    if (!snapshot) return null;
    return buildAmoraPreparationNotes({
      ownerId: snapshot.identity.ownerId,
      coupleId: snapshot.identity.coupleId,
      topics: TOPICS,
      ...snapshot.sources,
      openActions: snapshot.sources.openActions ?? undefined,
      todayYmd: formatLocalDateKey(),
      query,
      scopeFilter,
      topicFilter,
      typeFilter,
    });
  }, [query, scopeFilter, snapshot, topicFilter, typeFilter]);

  const resetFilters = useCallback(() => {
    setQuery("");
    setScopeFilter("all");
    setTopicFilter("all");
    setTypeFilter("all");
  }, []);

  const rememberReturnPosition = useCallback(() => {
    pendingRestoreOffsetRef.current = notesScrollOffsetRef.current;
  }, []);

  const openRecord = useCallback((record: AmoraPreparationNotesRecord) => {
    rememberReturnPosition();
    if (record.type === "saved_conversation") {
      router.push({
        pathname: "/(tabs)/chat",
        params: { topicMessageRefId: record.openOriginal.refId },
      });
      return;
    }
    router.push({
      pathname: "/settings/amora-style",
      params: { focus: record.openSource.focus },
    });
  }, [rememberReturnPosition]);

  const openContinuingStory = useCallback(() => {
    if (!view?.continuingStory) return;
    const params = buildChecklistDeepLinkParams({
      categoryKey: view.continuingStory.topicKey,
      actionId: view.continuingStory.actionId,
      actionRevision: view.continuingStory.actionRevision,
    });
    if (!params) return;
    rememberReturnPosition();
    router.push({ pathname: "/checklist", params });
  }, [rememberReturnPosition, view?.continuingStory]);

  const renderContent = () => {
    if (loadState === "loading") {
      return <LoadingState label="준비 기록을 안전하게 모으고 있어요" />;
    }
    if (loadState === "error" || !view || view.state === "read_error") {
      return (
        <EmptyState
          icon={<BookOpenText size={26} color={colors.rose[500]} />}
          title="준비 노트를 불러오지 못했어요"
          description="계정과 커플 연결을 다시 확인한 뒤 불러올게요. 이전 기록을 빈 목록으로 바꾸지는 않았어요."
          action={<PrimaryButton onPress={reload}>다시 불러오기</PrimaryButton>}
        />
      );
    }

    const showNoRecords = view.records.length === 0;
    return (
      <ScrollView
        ref={notesScrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          notesScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
      >
        <View style={styles.intro}>
          <AppText variant="title" style={styles.introTitle}>
            흩어진 준비 이야기를 한눈에
          </AppText>
          <AppText variant="body" style={styles.introBody}>
            아모라와 이야기하며 저장한 답과 지금 준비에 쓰는 기준을 모았어요.
          </AppText>
          <View style={styles.privacyLine}>
            <LockKeyhole size={15} color={colors.sage[500]} />
            <AppText variant="caption" style={styles.privacyCopy}>
              각 기록마다 나만 보기와 함께 보기를 구분해요.
            </AppText>
          </View>
        </View>

        {view.state === "partial" ? (
          <Surface tone="ivory" style={styles.notice}>
            <AppText variant="bodyStrong">확인된 기록부터 보여드려요</AppText>
            <AppText variant="caption" style={styles.noticeCopy}>
              일부 기록은 지금 확인하지 못했어요. 새로고침하면 다시 확인해요.
            </AppText>
          </Surface>
        ) : null}

        {usingLastVerified ? (
          <Surface tone="ivory" style={styles.notice}>
            <AppText variant="bodyStrong">마지막 확인 기록을 유지했어요</AppText>
            <AppText variant="caption" style={styles.noticeCopy}>
              새로 확인하지 못해 마지막으로 확인한 기록을 보여드려요. 다시 불러오면 현재 상태를 확인해요.
            </AppText>
          </Surface>
        ) : null}

        {view.continuingStory ? (
          <Surface tone="rose" style={styles.continuingCard}>
            <View style={styles.continuingHeader}>
              <AppText variant="eyebrow">지금 이어갈 준비</AppText>
              <StatusPill label={view.continuingStory.topicLabel} tone="rose" />
            </View>
            <AppText variant="subtitle" style={styles.continuingTitle}>
              {view.continuingStory.title}
            </AppText>
            <AppText variant="body" style={styles.continuingDescription}>
              {view.continuingStory.description}
            </AppText>
            <PrimaryButton onPress={openContinuingStory} icon={<ArrowRight size={17} color="#FFFFFF" />}>
              이어서 준비하기
            </PrimaryButton>
          </Surface>
        ) : null}

        <View style={styles.searchWrap}>
          <Search size={18} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            maxLength={120}
            placeholder="상담 내용이나 준비 주제 검색"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="우리 준비 노트 검색"
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityLabel="공개 범위 필터"
        >
          {SCOPE_FILTERS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={scopeFilter === option.value}
              onPress={() => setScopeFilter(option.value)}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityLabel="준비 주제 필터"
        >
          <FilterChip
            label="모든 주제"
            selected={topicFilter === "all"}
            onPress={() => setTopicFilter("all")}
          />
          {TOPICS.map((topic) => (
            <FilterChip
              key={topic.key}
              label={topic.label}
              selected={topicFilter === topic.key}
              onPress={() => setTopicFilter(topic.key)}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityLabel="기록 종류 필터"
        >
          {TYPE_FILTERS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={typeFilter === option.value}
              onPress={() => setTypeFilter(option.value)}
            />
          ))}
        </ScrollView>

        {showNoRecords ? (
          view.state === "empty" ? (
            <EmptyState
              icon={<BookOpenText size={25} color={colors.rose[500]} />}
              title="저장된 준비 기록이 아직 없어요"
              description="아모라 답변에서 ‘준비에 저장’을 누르거나 내 기준을 알려주면 이곳에서 다시 볼 수 있어요."
              action={(
                <PrimaryButton onPress={() => router.push("/(tabs)/chat")}>
                  아모라와 이야기하기
                </PrimaryButton>
              )}
            />
          ) : view.state === "no_results" ? (
            <EmptyState
              icon={<Search size={25} color={colors.rose[500]} />}
              title="필터에 맞는 기록이 없어요"
              description="검색어나 공개 범위를 바꾸면 원래 기록을 다시 볼 수 있어요."
              action={<PrimaryButton tone="ghost" onPress={resetFilters}>필터 지우기</PrimaryButton>}
            />
          ) : (
            <EmptyState
              title="지금 확인된 기록만 보여드려요"
              description="일부 기록을 불러오지 못했어요. 빈 목록으로 단정하지 않고 다시 확인할 수 있게 남겨둘게요."
            />
          )
        ) : (
          <View style={styles.recordsSection}>
            <View style={styles.recordsHeader}>
              <AppText variant="subtitle">중요한 준비 기록</AppText>
              <AppText variant="caption" style={styles.recordCount}>
                {usingLastVerified || view.state === "partial"
                  ? "확인된 기록"
                  : `${view.records.length}개`}
              </AppText>
            </View>
            {view.records.map((record) => (
              <NotesRecordRow
                key={record.id}
                record={record}
                onPress={() => openRecord(record)}
              />
            ))}
          </View>
        )}

        <View style={styles.boundaryNote}>
          <Users size={15} color={colors.textTertiary} />
          <AppText variant="caption" style={styles.boundaryCopy}>
            ‘우리 준비 노트’라는 이름이 개인 상담을 자동으로 공유한다는 뜻은 아니에요.
          </AppText>
        </View>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader
        title="우리 준비 노트"
        subtitle="아모라와 정리한 중요한 준비"
        onBack={() => router.back()}
        sideWidth={72}
        right={(
          <Pressable
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel="우리 준비 노트 새로고침"
            style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          >
            <AppText variant="caption" style={styles.refreshText}>새로고침</AppText>
          </Pressable>
        )}
      />
      <View style={styles.body}>{renderContent()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[12], gap: spacing[4] },
  pressed: { opacity: 0.72 },
  refreshButton: { minWidth: 64, minHeight: 44, alignItems: "center", justifyContent: "center" },
  refreshText: { color: colors.noir[800], fontFamily: "NotoSansKR_600SemiBold" },
  intro: { gap: spacing[2] },
  introTitle: { fontSize: 26, lineHeight: 34 },
  introBody: { maxWidth: 520 },
  privacyLine: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginTop: spacing[1] },
  privacyCopy: { flex: 1, color: colors.sage[500] },
  notice: { padding: spacing[4], gap: spacing[1] },
  noticeCopy: { color: colors.textSecondary },
  continuingCard: { padding: spacing[5], gap: spacing[3] },
  continuingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  continuingTitle: { marginTop: spacing[1] },
  continuingDescription: { color: colors.textSecondary },
  searchWrap: {
    minHeight: 48,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 0,
    fontSize: 14,
    color: colors.noir[800],
    fontFamily: "NotoSansKR_400Regular",
  },
  filterRow: { gap: spacing[2], paddingRight: spacing[4] },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: spacing[4],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipSelected: { borderColor: colors.rose[500], backgroundColor: colors.rose.pale },
  filterText: { color: colors.textSecondary },
  filterTextSelected: { color: colors.rose[600], fontFamily: "NotoSansKR_600SemiBold" },
  recordsSection: { gap: spacing[3] },
  recordsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recordCount: { color: colors.textTertiary },
  recordRow: {
    minHeight: 132,
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  recordTopLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  recordType: { color: colors.rose[600] },
  recordExcerpt: { color: colors.noir[800] },
  recordMetaLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  recordMeta: { flex: 1, color: colors.textTertiary },
  recordLink: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing[1] },
  recordLinkText: { color: colors.noir[800], fontFamily: "NotoSansKR_600SemiBold" },
  boundaryNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], paddingHorizontal: spacing[2] },
  boundaryCopy: { flex: 1, color: colors.textTertiary },
});
