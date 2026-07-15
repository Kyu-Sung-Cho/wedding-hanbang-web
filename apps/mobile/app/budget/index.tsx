// 사용자가 직접 시작한 계획·계약·납부 기록만 보여 주는 수동 금액 장부다.
// spent/cost/payer는 의미가 섞인 과거 값이므로 합산하거나 새로 저장하지 않고 삭제만 지원한다.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
  CalendarClock,
  Check,
  Edit3,
  FileText,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { readMySafeProfile } from "@/lib/safeProfile";
import { apiFetch } from "@/lib/api";
import {
  mutateBudgetCategory,
  parseOptionalManwonToWon,
  type MobileBudgetCategoryMutation,
  type MobileBudgetRemoveField,
} from "@/lib/budgetCategories";
import ErrorRetry from "@/components/ErrorRetry";
import { AppHeader, LoadingState, Surface } from "@/components/ui/AppUI";

interface ProgressItem {
  category?: string;
  label?: string;
  budget?: number;
  contractedTotal?: number;
  paidToDate?: number;
  nextPaymentAmount?: number;
  nextPaymentDate?: string;
  /** @deprecated 과거 값은 조회 후 삭제만 지원한다. */
  spent?: unknown;
  /** @deprecated 과거 값은 조회 후 삭제만 지원한다. */
  cost?: unknown;
  /** @deprecated 과거 값은 조회 후 삭제만 지원한다. */
  payer?: unknown;
  [key: string]: unknown;
}

interface BudgetRecord {
  key: string;
  label: string;
  custom: boolean;
  record: ProgressItem;
}

interface LegacyRecord {
  key: string;
  label: string;
  legacyFields: MobileBudgetRemoveField[];
}

const BUDGET_CATEGORIES = [
  { key: "meeting", label: "상견례" },
  { key: "venue", label: "예식장" },
  { key: "studio", label: "스튜디오" },
  { key: "dress", label: "드레스/턱시도" },
  { key: "makeup", label: "메이크업" },
  { key: "snap", label: "본식 스냅/영상" },
  { key: "ring", label: "예물" },
  { key: "yedan", label: "예단" },
  { key: "hanbok", label: "한복" },
  { key: "shoes", label: "웨딩 구두" },
  { key: "bouquet", label: "부케/꽃장식" },
  { key: "honeymoon", label: "신혼여행" },
  { key: "houseware", label: "혼수" },
  { key: "housing", label: "신혼집" },
  { key: "invitation", label: "청첩장" },
  { key: "gift", label: "답례품" },
  { key: "mc", label: "사회/축가" },
  { key: "ham", label: "함" },
  { key: "pyebaek", label: "폐백" },
  { key: "reserve", label: "예비비" },
] as const;

const CATEGORY_BY_KEY: ReadonlyMap<string, { readonly key: string; readonly label: string }> =
  new Map(BUDGET_CATEGORIES.map((category) => [category.key, category]));
const MANUAL_FIELDS = [
  "budget",
  "contractedTotal",
  "paidToDate",
  "nextPaymentAmount",
  "nextPaymentDate",
] as const;
const LEGACY_FIELDS = ["spent", "cost", "payer"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asProgressItem(value: unknown): ProgressItem | undefined {
  return isRecord(value) ? value as ProgressItem : undefined;
}

function hasOwn(record: ProgressItem | undefined, field: string): boolean {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, field));
}

function hasManualMoneyRecord(record: ProgressItem | undefined): boolean {
  return MANUAL_FIELDS.some((field) => hasOwn(record, field));
}

function safeAmount(record: ProgressItem, field: "budget" | "contractedTotal" | "paidToDate" | "nextPaymentAmount"): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function formatWon(value: number | undefined): string {
  if (value === undefined) return "미입력";
  if (value === 0) return "0원";
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;
  }
  if (value >= 10_000) {
    return `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}만원`;
  }
  return `${value.toLocaleString("ko-KR")}원`;
}

function wonToManwonInput(value: number | undefined): string {
  return value === undefined ? "" : String(value / 10_000);
}

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function displayLabel(key: string, record: ProgressItem): string {
  const known = CATEGORY_BY_KEY.get(key);
  if (known) return known.label;
  if (typeof record.label === "string" && record.label.trim()) {
    return record.label.trim().slice(0, 40);
  }
  return "직접 추가한 항목";
}

function sumEnteredField(
  records: BudgetRecord[],
  field: "budget" | "contractedTotal" | "paidToDate",
): number {
  return records.reduce((sum, item) => sum + (safeAmount(item.record, field) ?? 0), 0);
}

function SummaryMetric({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <View style={s.summaryCard}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={s.summaryValue}>{formatWon(value)}</Text>
      <Text style={s.summaryHelper}>{helper}</Text>
    </View>
  );
}

export default function BudgetScreen() {
  const [totalBudget, setTotalBudget] = useState(0);
  const [progress, setProgress] = useState<Record<string, unknown>>({});
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState("");
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingCustom, setEditingCustom] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [contractedTotalInput, setContractedTotalInput] = useState("");
  const [paidToDateInput, setPaidToDateInput] = useState("");
  const [nextPaymentAmountInput, setNextPaymentAmountInput] = useState("");
  const [nextPaymentDateInput, setNextPaymentDateInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingTotal, setSavingTotal] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const saveInFlightRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw authError ?? new Error("authenticated user not found");

      const { data: profile, error: profileError } = await readMySafeProfile();
      if (profileError || !profile?.couple_id) {
        throw profileError ?? new Error("couple profile not found");
      }

      setCoupleId(profile.couple_id);
      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();
      if (journeyError || !journey) {
        throw journeyError ?? new Error("wedding journey not found");
      }

      setTotalBudget(
        typeof journey.total_budget === "number" && Number.isSafeInteger(journey.total_budget)
          ? journey.total_budget
          : 0,
      );
      setProgress(isRecord(journey.progress) ? journey.progress : {});
      setHasLoadedData(true);
    } catch (error) {
      console.error("Budget load:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  useEffect(() => {
    if (!coupleId) return;

    const channel = supabase
      .channel(`budget:${coupleId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wedding_journeys",
          filter: `couple_id=eq.${coupleId}`,
        },
        () => {
          void loadData();
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [coupleId, loadData]);

  const hiddenRaw = progress.__hidden;
  const hiddenKeys = new Set(
    Array.isArray(hiddenRaw) ? hiddenRaw.filter((key): key is string => typeof key === "string") : [],
  );

  const activeRecords: BudgetRecord[] = Object.entries(progress)
    .flatMap(([key, raw]) => {
      if (key === "__hidden" || hiddenKeys.has(key)) return [];
      const record = asProgressItem(raw);
      if (!record || !hasManualMoneyRecord(record)) return [];
      return [{
        key,
        label: displayLabel(key, record),
        custom: !CATEGORY_BY_KEY.has(key),
        record,
      }];
    })
    .sort((a, b) => {
      const aIndex = BUDGET_CATEGORIES.findIndex((category) => category.key === a.key);
      const bIndex = BUDGET_CATEGORIES.findIndex((category) => category.key === b.key);
      if (aIndex === -1 && bIndex === -1) return a.label.localeCompare(b.label, "ko-KR");
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

  const legacyRecords: LegacyRecord[] = Object.entries(progress)
    .flatMap(([key, raw]) => {
      if (key === "__hidden") return [];
      const record = asProgressItem(raw);
      if (!record) return [];
      const legacyFields: MobileBudgetRemoveField[] = LEGACY_FIELDS
        .filter((field) => hasOwn(record, field));
      if (legacyFields.length === 0) return [];
      return [{ key, label: displayLabel(key, record), legacyFields }];
    })
    .sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));

  const activeKeys = new Set(activeRecords.map((item) => item.key));
  const availableCategories = BUDGET_CATEGORIES.filter((category) => !activeKeys.has(category.key));
  const plannedTotal = sumEnteredField(activeRecords, "budget");
  const contractedTotal = sumEnteredField(activeRecords, "contractedTotal");
  const paidTotal = sumEnteredField(activeRecords, "paidToDate");

  async function saveTotalBudget() {
    if (!coupleId || saveInFlightRef.current) return;
    const totalBudgetWon = parseOptionalManwonToWon(totalInput);
    if (totalBudgetWon === null) {
      Alert.alert("입력 확인", "전체 계획 금액은 0원 이상 100억원 이하로 입력해 주세요 (만원 단위).");
      return;
    }

    saveInFlightRef.current = true;
    setSavingTotal(true);
    try {
      const response = await apiFetch("/api/journey", {
        method: "PATCH",
        body: JSON.stringify({ total_budget: totalBudgetWon }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === "string"
          ? body.error
          : "전체 계획 금액을 저장하지 못했어요.";
        throw new Error(message);
      }
      if (
        !isRecord(body) || !isRecord(body.journey) ||
        body.journey.total_budget !== totalBudgetWon
      ) {
        throw new Error("저장된 전체 계획 금액을 확인하지 못했습니다. 화면을 새로고침해 주세요.");
      }
      setTotalBudget(totalBudgetWon);
      setEditingTotal(false);
    } catch (error) {
      Alert.alert("저장 실패", error instanceof Error ? error.message : "전체 계획 금액을 저장하지 못했어요.");
    } finally {
      saveInFlightRef.current = false;
      setSavingTotal(false);
    }
  }

  function openEdit(key: string, label: string, custom: boolean) {
    const record = asProgressItem(progress[key]);
    setEditingKey(key);
    setEditingLabel(label);
    setEditingCustom(custom);
    setBudgetInput(wonToManwonInput(record ? safeAmount(record, "budget") : undefined));
    setContractedTotalInput(wonToManwonInput(record ? safeAmount(record, "contractedTotal") : undefined));
    setPaidToDateInput(wonToManwonInput(record ? safeAmount(record, "paidToDate") : undefined));
    setNextPaymentAmountInput(wonToManwonInput(record ? safeAmount(record, "nextPaymentAmount") : undefined));
    setNextPaymentDateInput(
      record && typeof record.nextPaymentDate === "string" ? record.nextPaymentDate : "",
    );
  }

  function closeEditor() {
    if (saving) return;
    setEditingKey(null);
  }

  function startKnownCategory(key: string, label: string) {
    setShowAddPicker(false);
    openEdit(key, label, false);
  }

  function startCustomCategory() {
    const label = newItemLabel.trim();
    if (!label) {
      Alert.alert("이름 확인", "직접 추가할 항목 이름을 입력해 주세요.");
      return;
    }
    if (label.length > 40) {
      Alert.alert("이름 확인", "항목 이름은 40자 이하로 입력해 주세요.");
      return;
    }
    const key = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setNewItemLabel("");
    setShowAddPicker(false);
    openEdit(key, label, true);
  }

  function parseEditorAmount(input: string): number | null | undefined {
    if (!input.trim()) return undefined;
    return parseOptionalManwonToWon(input);
  }

  async function saveCategoryEdit() {
    if (!coupleId || !editingKey || saveInFlightRef.current) return;

    const budgetWon = parseEditorAmount(budgetInput);
    const signedTotalWon = parseEditorAmount(contractedTotalInput);
    const paidWon = parseEditorAmount(paidToDateInput);
    const nextAmountWon = parseEditorAmount(nextPaymentAmountInput);
    const nextDate = nextPaymentDateInput.trim();

    if (
      budgetWon === null || signedTotalWon === null ||
      paidWon === null || nextAmountWon === null
    ) {
      Alert.alert("입력 확인", "금액은 0원 이상 100억원 이하로 입력해 주세요 (만원 단위).");
      return;
    }
    if (paidWon !== undefined && signedTotalWon === undefined) {
      Alert.alert("입력 확인", "납부액을 기록하려면 서명한 계약 총액도 입력해 주세요.");
      return;
    }
    if (
      paidWon !== undefined && signedTotalWon !== undefined &&
      paidWon > signedTotalWon
    ) {
      Alert.alert("입력 확인", "누적 납부액은 서명한 계약 총액보다 클 수 없어요.");
      return;
    }
    if ((nextAmountWon !== undefined || nextDate) && signedTotalWon === undefined) {
      Alert.alert("입력 확인", "다음 납부 일정을 기록하려면 서명한 계약 총액도 입력해 주세요.");
      return;
    }
    if (nextDate && !isValidDateOnly(nextDate)) {
      Alert.alert("입력 확인", "다음 납부일은 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.");
      return;
    }
    if (
      budgetWon === undefined && signedTotalWon === undefined && paidWon === undefined &&
      nextAmountWon === undefined && !nextDate
    ) {
      Alert.alert("입력 확인", "금액이나 다음 납부 일정 중 하나 이상을 입력해 주세요.");
      return;
    }

    const existing = asProgressItem(progress[editingKey]);
    const setFields: NonNullable<MobileBudgetCategoryMutation["set"]> = {};
    const removeFields: MobileBudgetRemoveField[] = [];
    const values = [
      ["budget", budgetWon],
      ["contractedTotal", signedTotalWon],
      ["paidToDate", paidWon],
      ["nextPaymentAmount", nextAmountWon],
    ] as const;

    for (const [field, value] of values) {
      if (value === undefined) {
        if (hasOwn(existing, field)) removeFields.push(field);
      } else {
        setFields[field] = value;
      }
    }
    if (nextDate) {
      setFields.nextPaymentDate = nextDate;
    } else if (hasOwn(existing, "nextPaymentDate")) {
      removeFields.push("nextPaymentDate");
    }
    if (editingCustom) setFields.label = editingLabel;

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const result = await mutateBudgetCategory({
        categoryKey: editingKey,
        set: setFields,
        ...(removeFields.length > 0 ? { remove: removeFields } : {}),
        visibility: "visible",
      }, apiFetch);
      setProgress(result.progress);
      setEditingKey(null);
    } catch (error) {
      Alert.alert(
        "저장 실패",
        error instanceof Error ? error.message : "금액 기록을 저장하지 못했습니다.",
      );
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function deleteRecord(item: BudgetRecord) {
    if (saveInFlightRef.current) return;
    const fields: MobileBudgetRemoveField[] = [
      ...MANUAL_FIELDS.filter((field) => hasOwn(item.record, field)),
      ...LEGACY_FIELDS.filter((field) => hasOwn(item.record, field)),
      ...(item.custom && hasOwn(item.record, "label") ? ["label" as const] : []),
    ];
    if (fields.length === 0) return;

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const result = await mutateBudgetCategory({
        categoryKey: item.key,
        remove: fields,
        visibility: "hidden",
      }, apiFetch);
      setProgress(result.progress);
    } catch (error) {
      Alert.alert(
        "삭제 실패",
        error instanceof Error ? error.message : "금액 기록을 삭제하지 못했습니다.",
      );
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  function confirmDelete(item: BudgetRecord) {
    Alert.alert(
      `${item.label} 기록 삭제`,
      "직접 입력한 계획·계약·납부 기록이 모두 삭제됩니다. 이 작업은 되돌릴 수 없어요.",
      [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: () => { void deleteRecord(item); } },
      ],
    );
  }

  async function clearLegacyRecord(item: LegacyRecord) {
    if (saveInFlightRef.current) return;
    const current = asProgressItem(progress[item.key]);
    const legacyFields: MobileBudgetRemoveField[] = LEGACY_FIELDS
      .filter((field) => hasOwn(current, field));
    if (legacyFields.length === 0) return;

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const result = await mutateBudgetCategory({
        categoryKey: item.key,
        remove: legacyFields,
      }, apiFetch);
      setProgress(result.progress);
    } catch (error) {
      Alert.alert(
        "삭제 실패",
        error instanceof Error ? error.message : "이전 형식 값을 삭제하지 못했습니다.",
      );
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  function confirmLegacyClear(item: LegacyRecord) {
    Alert.alert(
      `${item.label} 이전 값 삭제`,
      "이전 형식의 지출·비용·분담 값을 삭제합니다. 현재 수동 금액 기록은 유지돼요.",
      [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: () => { void clearLegacyRecord(item); } },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <LoadingState label="금액 기록을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (loadError && !hasLoadedData) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <AppHeader title="금액 기록" onBack={() => router.back()} />
        <ErrorRetry
          message="금액 기록을 불러오지 못했어요"
          onRetry={() => {
            setLoading(true);
            void loadData();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader
        title="금액 기록"
        subtitle="직접 입력한 계획·계약·납부 기록"
        onBack={() => router.back()}
      />

      {loadError && hasLoadedData ? (
        <Pressable
          style={({ pressed }) => [s.loadWarning, pressed && s.pressed]}
          onPress={() => { void loadData(); }}
          accessibilityRole="button"
          accessibilityLabel="금액 기록 최신 정보 다시 불러오기"
        >
          <AlertTriangle size={16} color={colors.danger} />
          <Text style={s.loadWarningText}>최신 기록을 불러오지 못했어요</Text>
          <Text style={s.loadWarningAction}>다시 시도</Text>
        </Pressable>
      ) : null}

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            tintColor={colors.rose[500]}
          />
        )}
      >
        <Surface tone="ivory" style={s.trustNotice}>
          <FileText size={19} color={colors.noir[800]} />
          <View style={s.trustNoticeCopy}>
            <Text style={s.trustNoticeTitle}>원본 확인이 기준이에요</Text>
            <Text style={s.trustNoticeText}>
              계약·납부 금액은 사용자가 직접 입력한 미검증 기록입니다. 실제 의무와 납부 상태는 서명한 계약서·영수증·계좌내역 원본을 확인하세요.
            </Text>
          </View>
        </Surface>

        <View style={s.totalCard}>
          <View style={s.totalHeader}>
            <View style={s.totalHeadingCopy}>
              <Text style={s.totalEyebrow}>MY PLAN</Text>
              <Text style={s.totalLabel}>내가 입력한 전체 계획</Text>
            </View>
            {!editingTotal ? (
              <Pressable
                style={({ pressed }) => [s.iconButtonDark, pressed && s.pressed]}
                onPress={() => {
                  setTotalInput(totalBudget > 0 ? String(totalBudget / 10_000) : "");
                  setEditingTotal(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="전체 계획 금액 수정"
              >
                <Edit3 size={16} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </View>
          {editingTotal ? (
            <View style={s.totalEditRow}>
              <TextInput
                style={s.totalEditInput}
                value={totalInput}
                onChangeText={setTotalInput}
                keyboardType="decimal-pad"
                editable={!savingTotal}
                autoFocus
                placeholder="만원 단위"
                placeholderTextColor={colors.taupe[400]}
              />
              <Text style={s.totalUnit}>만원</Text>
              <Pressable onPress={() => { void saveTotalBudget(); }} disabled={savingTotal} hitSlop={8}>
                {savingTotal
                  ? <ActivityIndicator size="small" color={colors.rose[500]} />
                  : <Check size={22} color={colors.rose[500]} />}
              </Pressable>
              <Pressable onPress={() => setEditingTotal(false)} disabled={savingTotal} hitSlop={8}>
                <X size={22} color={colors.taupe[400]} />
              </Pressable>
            </View>
          ) : (
            <Text style={s.totalValue}>{totalBudget > 0 ? formatWon(totalBudget) : "미입력"}</Text>
          )}
          <Text style={s.totalHelper}>
            직접 정한 계획 금액을 보관합니다. 서비스가 권장하거나 적정성을 판정한 값이 아니에요.
          </Text>
        </View>

        <View style={s.summaryGrid}>
          <SummaryMetric label="항목 계획 합계" value={plannedTotal} helper="직접 입력한 계획만" />
          <SummaryMetric label="서명 계약 합계" value={contractedTotal} helper="직접 옮겨 적은 계약 총액" />
          <SummaryMetric label="누적 납부 합계" value={paidTotal} helper="직접 확인해 입력한 납부액" />
        </View>

        <View style={s.sectionHeader}>
          <View style={s.sectionHeadingCopy}>
            <Text style={s.sectionEyebrow}>MANUAL RECORDS</Text>
            <Text style={s.sectionTitle}>내 금액 기록</Text>
            <Text style={s.sectionDescription}>
              필요한 항목만 골라 기록하세요. 모두 추가할 필요 없어요.
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.addButton, pressed && s.pressed]}
            onPress={() => setShowAddPicker(true)}
            accessibilityRole="button"
            accessibilityLabel="금액 기록 항목 추가"
          >
            <Plus size={16} color="#FFFFFF" />
            <Text style={s.addButtonText}>항목 추가</Text>
          </Pressable>
        </View>

        {activeRecords.length === 0 ? (
          <Surface style={s.emptyCard}>
            <Wallet size={24} color={colors.textTertiary} />
            <Text style={s.emptyTitle}>아직 시작한 금액 기록이 없어요</Text>
            <Text style={s.emptyText}>
              계약하거나 실제로 관리할 필요가 생긴 항목만 추가하면 됩니다.
            </Text>
            <Pressable
              style={({ pressed }) => [s.emptyAction, pressed && s.pressed]}
              onPress={() => setShowAddPicker(true)}
            >
              <Text style={s.emptyActionText}>첫 항목 추가</Text>
            </Pressable>
          </Surface>
        ) : (
          activeRecords.map((item) => {
            const budget = safeAmount(item.record, "budget");
            const signed = safeAmount(item.record, "contractedTotal");
            const paid = safeAmount(item.record, "paidToDate");
            const nextAmount = safeAmount(item.record, "nextPaymentAmount");
            const nextDate = typeof item.record.nextPaymentDate === "string"
              ? item.record.nextPaymentDate
              : undefined;
            return (
              <Surface key={item.key} style={s.recordCard}>
                <View style={s.recordHeader}>
                  <View style={s.recordHeadingCopy}>
                    <Text style={s.recordTitle}>{item.label}</Text>
                    <Text style={s.recordSource}>직접 입력 · 미검증 기록</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [s.editButton, pressed && s.pressed]}
                    onPress={() => openEdit(item.key, item.label, item.custom)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} 금액 기록 수정`}
                  >
                    <Edit3 size={15} color={colors.noir[800]} />
                    <Text style={s.editButtonText}>편집</Text>
                  </Pressable>
                </View>

                <View style={s.recordMetrics}>
                  <View style={s.recordMetric}>
                    <Text style={s.recordMetricLabel}>내 계획 금액</Text>
                    <Text style={s.recordMetricValue}>{formatWon(budget)}</Text>
                  </View>
                  <View style={s.recordMetric}>
                    <Text style={s.recordMetricLabel}>서명한 계약 총액</Text>
                    <Text style={s.recordMetricValue}>{formatWon(signed)}</Text>
                  </View>
                  <View style={[s.recordMetric, s.recordMetricPaid]}>
                    <Text style={s.recordMetricLabel}>실제 누적 납부액</Text>
                    <Text style={s.recordMetricValue}>{formatWon(paid)}</Text>
                  </View>
                </View>

                {(nextAmount !== undefined || nextDate) ? (
                  <View style={s.nextPaymentBox}>
                    <CalendarClock size={16} color={colors.textSecondary} />
                    <View style={s.nextPaymentCopy}>
                      <Text style={s.nextPaymentTitle}>다음 납부 예정</Text>
                      <Text style={s.nextPaymentText}>
                        {nextDate ? `${nextDate}` : "날짜 미입력"}
                        {nextAmount !== undefined ? ` · ${formatWon(nextAmount)}` : " · 금액 미입력"}
                      </Text>
                    </View>
                  </View>
                ) : null}

                <Text style={s.recordFootnote}>
                  계약 금액·납부일·납부 완료 여부는 이 화면이 확인하지 않습니다. 반드시 원본과 대조하세요.
                </Text>
                <Pressable
                  style={({ pressed }) => [s.deleteButton, pressed && s.pressed]}
                  onPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label} 금액 기록 삭제`}
                >
                  <Trash2 size={14} color={colors.danger} />
                  <Text style={s.deleteButtonText}>이 기록 삭제</Text>
                </Pressable>
              </Surface>
            );
          })
        )}

        {legacyRecords.length > 0 ? (
          <Surface style={s.legacyPanel}>
            <View style={s.legacyHeader}>
              <AlertTriangle size={18} color={colors.danger} />
              <View style={s.legacyHeaderCopy}>
                <Text style={s.legacyTitle}>이전 형식 값 정리 필요</Text>
                <Text style={s.legacyDescription}>
                  의미가 섞인 이전 지출·비용·분담 값은 합계에 포함하지 않으며 삭제만 할 수 있어요.
                </Text>
              </View>
            </View>
            {legacyRecords.map((item) => (
              <View key={item.key} style={s.legacyRow}>
                <View style={s.legacyRowCopy}>
                  <Text style={s.legacyRowTitle}>{item.label}</Text>
                  <Text style={s.legacyRowMeta}>이전 필드 {item.legacyFields.length}개 · 금액 의미 미분류</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [s.legacyDeleteButton, pressed && s.pressed]}
                  onPress={() => confirmLegacyClear(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label} 이전 형식 값 삭제`}
                >
                  <Text style={s.legacyDeleteText}>삭제</Text>
                </Pressable>
              </View>
            ))}
          </Surface>
        ) : null}

        <Text style={s.pageFootnote}>
          웨딩한방은 계약 당사자, 결제 대행사 또는 회계 장부가 아닙니다. 이 기록만으로 계약 이행이나 납부 완료를 판단하지 마세요.
        </Text>
      </ScrollView>

      <Modal
        visible={showAddPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddPicker(false)}
      >
        <View style={s.modalOverlay}>
          <View style={[s.modalContainer, s.pickerModal]}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalHeadingCopy}>
                <Text style={s.modalTitle}>기록할 항목 선택</Text>
                <Text style={s.modalDescription}>필요한 항목만 선택하세요. 선택 자체로 저장되지는 않아요.</Text>
              </View>
              <Pressable onPress={() => setShowAddPicker(false)} hitSlop={10}>
                <X size={23} color={colors.textTertiary} />
              </Pressable>
            </View>

            <ScrollView style={s.pickerList} contentContainerStyle={s.pickerListContent}>
              {availableCategories.map((category) => (
                <Pressable
                  key={category.key}
                  style={({ pressed }) => [s.pickerRow, pressed && s.pressed]}
                  onPress={() => startKnownCategory(category.key, category.label)}
                >
                  <Text style={s.pickerRowText}>{category.label}</Text>
                  <Plus size={17} color={colors.rose[500]} />
                </Pressable>
              ))}
              {availableCategories.length === 0 ? (
                <Text style={s.noCategoriesText}>기본 항목은 모두 기록 중이에요.</Text>
              ) : null}
            </ScrollView>

            <View style={s.customAddBox}>
              <Text style={s.customAddLabel}>목록에 없는 항목</Text>
              <View style={s.customAddRow}>
                <TextInput
                  style={s.customAddInput}
                  value={newItemLabel}
                  onChangeText={setNewItemLabel}
                  maxLength={40}
                  placeholder="예: 반려동물 돌봄"
                  placeholderTextColor={colors.taupe[400]}
                />
                <Pressable
                  style={({ pressed }) => [s.customAddButton, pressed && s.pressed]}
                  onPress={startCustomCategory}
                >
                  <Text style={s.customAddButtonText}>직접 추가</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editingKey !== null}
        animationType="slide"
        transparent
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.modalOverlay}
        >
          <View style={s.modalContainer}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalHeadingCopy}>
                <Text style={s.modalTitle}>{editingLabel} 기록</Text>
                <Text style={s.modalDescription}>원본에서 직접 확인한 값만 입력해 주세요.</Text>
              </View>
              <Pressable onPress={closeEditor} disabled={saving} hitSlop={10}>
                <X size={23} color={colors.textTertiary} />
              </Pressable>
            </View>

            <ScrollView
              style={s.editorScroll}
              contentContainerStyle={s.editorContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.fieldLabel}>내 계획 금액 (만원)</Text>
              <Text style={s.fieldHelper}>내가 세운 계획을 적습니다. 추천 금액이 아니에요.</Text>
              <TextInput
                style={s.fieldInput}
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="decimal-pad"
                editable={!saving}
                placeholder="비워 두기"
                placeholderTextColor={colors.taupe[400]}
              />

              <Text style={s.fieldLabel}>서명한 계약 총액 (만원)</Text>
              <Text style={s.fieldHelper}>서명한 계약서 원본의 최종 총액을 그대로 적습니다.</Text>
              <TextInput
                style={s.fieldInput}
                value={contractedTotalInput}
                onChangeText={setContractedTotalInput}
                keyboardType="decimal-pad"
                editable={!saving}
                placeholder="비워 두기"
                placeholderTextColor={colors.taupe[400]}
              />

              <Text style={s.fieldLabel}>실제 누적 납부액 (만원)</Text>
              <Text style={s.fieldHelper}>영수증·계좌내역에서 확인한 실제 송금 합계만 적습니다.</Text>
              <TextInput
                style={s.fieldInput}
                value={paidToDateInput}
                onChangeText={setPaidToDateInput}
                keyboardType="decimal-pad"
                editable={!saving}
                placeholder="비워 두기"
                placeholderTextColor={colors.taupe[400]}
              />

              <Text style={s.fieldLabel}>다음 납부 예정액 (만원)</Text>
              <Text style={s.fieldHelper}>계약서나 업체 안내 원본에 적힌 예정액만 입력합니다.</Text>
              <TextInput
                style={s.fieldInput}
                value={nextPaymentAmountInput}
                onChangeText={setNextPaymentAmountInput}
                keyboardType="decimal-pad"
                editable={!saving}
                placeholder="비워 두기"
                placeholderTextColor={colors.taupe[400]}
              />

              <Text style={s.fieldLabel}>다음 납부일</Text>
              <Text style={s.fieldHelper}>YYYY-MM-DD 형식 · 서비스가 날짜를 추정하지 않아요.</Text>
              <TextInput
                style={s.fieldInput}
                value={nextPaymentDateInput}
                onChangeText={setNextPaymentDateInput}
                editable={!saving}
                autoCapitalize="none"
                maxLength={10}
                placeholder="예: 2026-08-20"
                placeholderTextColor={colors.taupe[400]}
              />

              <View style={s.editorTrustBox}>
                <AlertTriangle size={15} color={colors.textSecondary} />
                <Text style={s.editorTrustText}>
                  저장된 값은 증빙 검증 결과가 아닙니다. 변경·취소·추가 결제 조건은 계약서 원본과 업체 확인이 우선입니다.
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [s.saveButton, pressed && !saving && s.pressed]}
                onPress={() => { void saveCategoryEdit(); }}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveButtonText}>기록 저장</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 44 },
  pressed: { opacity: 0.72 },
  loadWarning: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(185, 28, 28, 0.08)",
  },
  loadWarningText: { flex: 1, fontSize: 12, color: colors.textSecondary },
  loadWarningAction: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.danger },
  trustNotice: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  trustNoticeCopy: { flex: 1 },
  trustNoticeTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800], marginBottom: 4 },
  trustNoticeText: { fontSize: 12, color: colors.textSecondary, lineHeight: 19 },
  totalCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 24,
    padding: 22,
    marginBottom: 14,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  totalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  totalHeadingCopy: { flex: 1 },
  totalEyebrow: { fontSize: 10, color: colors.taupe[400], marginBottom: 3 },
  totalLabel: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: "#FFFFFF" },
  iconButtonDark: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  totalValue: { marginTop: 18, fontSize: 31, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF" },
  totalHelper: { marginTop: 10, fontSize: 11, lineHeight: 17, color: colors.taupe[400] },
  totalEditRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  totalEditInput: { flex: 1, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.rose[500], fontSize: 23, color: "#FFFFFF" },
  totalUnit: { fontSize: 13, color: colors.taupe[400] },
  summaryGrid: { flexDirection: "row", gap: 8, marginBottom: 24 },
  summaryCard: { flex: 1, minHeight: 116, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  summaryLabel: { fontSize: 10, color: colors.textTertiary, lineHeight: 15 },
  summaryValue: { marginTop: 7, fontSize: 16, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
  summaryHelper: { marginTop: 5, fontSize: 9, lineHeight: 14, color: colors.textTertiary },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  sectionHeadingCopy: { flex: 1 },
  sectionEyebrow: { fontSize: 10, color: colors.textTertiary, marginBottom: 3 },
  sectionTitle: { fontSize: 20, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800] },
  sectionDescription: { marginTop: 4, fontSize: 11, lineHeight: 17, color: colors.textSecondary },
  addButton: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.noir[800] },
  addButtonText: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: "#FFFFFF" },
  emptyCard: { alignItems: "center", paddingVertical: 30, marginBottom: 14 },
  emptyTitle: { marginTop: 10, fontSize: 15, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  emptyText: { marginTop: 5, paddingHorizontal: 14, fontSize: 12, lineHeight: 19, textAlign: "center", color: colors.textSecondary },
  emptyAction: { marginTop: 16, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.ivory[200] },
  emptyActionText: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  recordCard: { marginBottom: 12 },
  recordHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  recordHeadingCopy: { flex: 1 },
  recordTitle: { fontSize: 18, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800] },
  recordSource: { marginTop: 3, fontSize: 10, color: colors.textTertiary },
  editButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: colors.ivory[200] },
  editButtonText: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  recordMetrics: { gap: 7, marginTop: 16 },
  recordMetric: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 11, backgroundColor: colors.ivory[100] },
  recordMetricPaid: { backgroundColor: "rgba(54, 83, 78, 0.08)" },
  recordMetricLabel: { flex: 1, fontSize: 11, color: colors.textSecondary },
  recordMetricValue: { fontSize: 16, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
  nextPaymentBox: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 9, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
  nextPaymentCopy: { flex: 1 },
  nextPaymentTitle: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: colors.textSecondary },
  nextPaymentText: { marginTop: 2, fontSize: 12, color: colors.noir[800] },
  recordFootnote: { marginTop: 11, fontSize: 10, lineHeight: 16, color: colors.textTertiary },
  deleteButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, paddingVertical: 5 },
  deleteButtonText: { fontSize: 11, color: colors.danger },
  legacyPanel: { marginTop: 10, marginBottom: 14, borderColor: "rgba(185, 28, 28, 0.22)" },
  legacyHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  legacyHeaderCopy: { flex: 1 },
  legacyTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  legacyDescription: { marginTop: 4, fontSize: 11, lineHeight: 18, color: colors.textSecondary },
  legacyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  legacyRowCopy: { flex: 1 },
  legacyRowTitle: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  legacyRowMeta: { marginTop: 2, fontSize: 10, color: colors.textTertiary },
  legacyDeleteButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: "rgba(185, 28, 28, 0.08)" },
  legacyDeleteText: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: colors.danger },
  pageFootnote: { marginTop: 8, paddingHorizontal: 8, fontSize: 10, lineHeight: 17, textAlign: "center", color: colors.textTertiary },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(7, 22, 41, 0.42)" },
  modalContainer: { maxHeight: "91%", paddingHorizontal: 22, paddingTop: 10, paddingBottom: 30, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: colors.bg },
  pickerModal: { maxHeight: "84%" },
  modalHandle: { width: 36, height: 4, alignSelf: "center", marginBottom: 16, borderRadius: 2, backgroundColor: colors.border },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 15 },
  modalHeadingCopy: { flex: 1 },
  modalTitle: { fontSize: 19, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800] },
  modalDescription: { marginTop: 4, fontSize: 11, lineHeight: 17, color: colors.textSecondary },
  pickerList: { flexGrow: 0 },
  pickerListContent: { paddingBottom: 8 },
  pickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 46, paddingHorizontal: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerRowText: { fontSize: 14, color: colors.noir[800] },
  noCategoriesText: { paddingVertical: 20, textAlign: "center", fontSize: 12, color: colors.textTertiary },
  customAddBox: { marginTop: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  customAddLabel: { marginBottom: 8, fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.textSecondary },
  customAddRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  customAddInput: { flex: 1, minHeight: 45, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.surface, fontSize: 13, color: colors.noir[800] },
  customAddButton: { minHeight: 45, justifyContent: "center", paddingHorizontal: 12, borderRadius: 11, backgroundColor: colors.noir[800] },
  customAddButtonText: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: "#FFFFFF" },
  editorScroll: { flexGrow: 0 },
  editorContent: { paddingBottom: 4 },
  fieldLabel: { marginTop: 14, marginBottom: 3, fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  fieldHelper: { marginBottom: 7, fontSize: 10, lineHeight: 15, color: colors.textTertiary },
  fieldInput: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, fontSize: 16, color: colors.noir[800] },
  editorTrustBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 18, padding: 12, borderRadius: 11, backgroundColor: colors.ivory[200] },
  editorTrustText: { flex: 1, fontSize: 10, lineHeight: 16, color: colors.textSecondary },
  saveButton: { minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 16, borderRadius: 14, backgroundColor: colors.noir[800] },
  saveButtonText: { fontSize: 15, fontFamily: "NotoSansKR_600SemiBold", color: "#FFFFFF" },
});
