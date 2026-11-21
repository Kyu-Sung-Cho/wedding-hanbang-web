import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { Mail, MessageCircleHeart, RotateCcw } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  CARE_WINDOW_MAX_HOUR,
  CARE_WINDOW_MIN_HOUR,
  careConsentPartnerLine,
  careEmailDescription,
  describeCoupleCadence,
  formatCareHour,
  parseCarePreferencePayload,
  type CareIntensity,
  type CarePreferencePayload,
} from "@/lib/careSettings";

// 10장 P2 강도. 덜은 전날 확인만, 보통은 하루 한 건, 더는 하루 세 건까지.
const INTENSITY_OPTIONS: ReadonlyArray<{ value: CareIntensity; label: string; hint: string }> = [
  { value: "light", label: "덜", hint: "전날 확인만" },
  { value: "normal", label: "보통", hint: "하루 한 건" },
  { value: "more", label: "더", hint: "하루 세 건까지" },
];

// 10장 P1 "아모라가 먼저 알려 주기"(웹 `components/app/AmoraCarePreferenceControl.tsx` 와 같은 계약).
// 켤 수 있는 경로가 하나도 없으면 그리지 않는다. 그때 예전 동의를 거두는 일은 설정 화면의
// "이전 이메일 수신 동의 해제" 줄이 맡는다(onAvailabilityChange 로 알려 준다).
// 문장은 파운더가 읽고 정한다(18장 D-12).

type ViewState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "ready"; ownerUserId: string; preference: CarePreferencePayload }
  | { kind: "error"; message: string };

type Change =
  | { chat?: boolean; email?: boolean }
  | { intensity?: CareIntensity; windowStartHour?: number; windowEndHour?: number };

const ROUTE = "/api/amora/care-preferences";

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

function serverMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).error;
    if (typeof message === "string" && message.length > 0 && message.length <= 200) {
      return message;
    }
  }
  return fallback;
}

export default function AmoraCarePreferenceControl({
  onAvailabilityChange,
}: {
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const operation = ++loadGeneration.current;
    setView({ kind: "loading" });
    setActionError("");
    try {
      const userId = await currentVerifiedUserId();
      if (!userId) {
        if (operation === loadGeneration.current) {
          setView({ kind: "hidden" });
          onAvailabilityChange?.(false);
        }
        return;
      }
      const response = await apiFetchForExpectedUser(userId, ROUTE, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (operation !== loadGeneration.current) return;
      const preference = response.ok ? parseCarePreferencePayload(payload) : null;
      if (!preference) {
        setView({ kind: "error", message: serverMessage(payload, "알림 설정을 불러오지 못했어요.") });
        onAvailabilityChange?.(false);
        return;
      }
      if (!preference.available) {
        setView({ kind: "hidden" });
        onAvailabilityChange?.(false);
        return;
      }
      setView({ kind: "ready", ownerUserId: userId, preference });
      onAvailabilityChange?.(true);
    } catch {
      if (operation === loadGeneration.current) {
        setView({ kind: "error", message: "알림 설정을 불러오지 못했어요." });
        onAvailabilityChange?.(false);
      }
    }
  }, [onAvailabilityChange]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function save(change: Change) {
    if (view.kind !== "ready" || saving) return;
    const { ownerUserId, preference: previous } = view;
    setSaving(true);
    setActionError("");
    try {
      // 저장하는 동안 다른 계정으로 바뀌었으면 쓰지 않고 다시 읽는다.
      if (await currentVerifiedUserId() !== ownerUserId) {
        void load();
        return;
      }
      const response = await apiFetchForExpectedUser(ownerUserId, ROUTE, {
        method: "PUT",
        headers: { Accept: "application/json" },
        body: JSON.stringify(change),
      });
      const payload = await response.json().catch(() => null);
      const preference = response.ok ? parseCarePreferencePayload(payload) : null;
      if (!preference) {
        setView({ kind: "ready", ownerUserId, preference: previous });
        setActionError(serverMessage(payload, "설정을 저장하지 못했어요. 기존 설정은 그대로예요."));
        return;
      }
      setView({ kind: "ready", ownerUserId, preference });
    } catch {
      setView({ kind: "ready", ownerUserId, preference: previous });
      setActionError("설정을 저장하지 못했어요. 기존 설정은 그대로예요.");
    } finally {
      setSaving(false);
    }
  }

  if (view.kind === "hidden") return null;
  if (view.kind === "loading") {
    return (
      <View style={styles.container} accessibilityRole="progressbar">
        <ActivityIndicator size="small" color={colors.rose[500]} />
        <Text style={styles.muted}>아모라 알림 설정 확인 중</Text>
      </View>
    );
  }
  if (view.kind === "error") {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <View style={styles.headingRow}>
          <RotateCcw size={18} color={colors.rose[600]} />
          <Text style={styles.title}>아모라가 먼저 알려 주기</Text>
        </View>
        <Text style={styles.description}>{view.message}</Text>
        <Pressable
          onPress={() => void load()}
          style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonLabel}>다시 불러오기</Text>
        </Pressable>
      </View>
    );
  }

  const { preference } = view;
  const partnerLine = careConsentPartnerLine(preference);
  const emailSelectable = preference.emailAvailable
    && preference.chat.enabled
    && preference.email.verified;

  return (
    <View style={styles.container} testID="amora-care-preference">
      <View style={styles.switchRow}>
        <View style={styles.iconWrap}>
          <MessageCircleHeart size={18} color={colors.noir[800]} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} accessibilityRole="header">아모라가 먼저 알려 주기</Text>
          <Text style={styles.description}>
            상견례, 식장 방문, 촬영처럼 일정에 넣은 날과 결혼식 앞뒤에 아모라가 함께 대화에 먼저 글을 남겨요.
          </Text>
          <Text style={styles.muted}>두 분이 모두 켜야 와요. 한 분이 끄면 두 분 모두에게 멈춰요.</Text>
          {partnerLine ? <Text style={styles.partnerLine}>{partnerLine}</Text> : null}
        </View>
        {saving ? (
          <ActivityIndicator size="small" color={colors.rose[500]} />
        ) : (
          <Switch
            value={preference.chat.enabled}
            onValueChange={(next) => void save({ chat: next })}
            trackColor={{ false: colors.ivory[200], true: colors.rose.light }}
            thumbColor={preference.chat.enabled ? colors.rose[600] : colors.taupe[400]}
            accessibilityLabel="아모라가 함께 대화에 먼저 글 남기기"
          />
        )}
      </View>

      {preference.emailAvailable ? (
        <View style={styles.subRow}>
          <Mail size={16} color={colors.textSecondary} />
          <View style={styles.copy}>
            <Text style={styles.subTitle}>같은 글을 메일로도 받기</Text>
            <Text style={styles.muted}>{careEmailDescription(preference)}</Text>
          </View>
          <Switch
            value={preference.email.enabled}
            onValueChange={(next) => void save({ email: next })}
            disabled={saving || (!preference.email.enabled && !emailSelectable)}
            trackColor={{ false: colors.ivory[200], true: colors.rose.light }}
            thumbColor={preference.email.enabled ? colors.rose[600] : colors.taupe[400]}
            accessibilityLabel="같은 글을 메일로도 받기"
          />
        </View>
      ) : null}

      {preference.chat.enabled ? (
        <View style={styles.cadence} testID="amora-care-cadence">
          <Text style={styles.subTitle}>얼마나 자주</Text>
          <View style={styles.intensityRow} accessibilityRole="radiogroup">
            {INTENSITY_OPTIONS.map((option) => {
              const selected = preference.cadence.intensity === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    if (!selected) void save({ intensity: option.value });
                  }}
                  disabled={saving}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: saving }}
                  accessibilityLabel={`${option.label}, ${option.hint}`}
                  style={({ pressed }) => [
                    styles.intensityOption,
                    selected && styles.intensitySelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.intensityLabel}>{option.label}</Text>
                  <Text style={styles.muted}>{option.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.subTitle}>받는 시간</Text>
          <View style={styles.hourRow}>
            <HourStepper
              label="받기 시작하는 시각"
              value={preference.cadence.windowStartHour}
              min={CARE_WINDOW_MIN_HOUR}
              max={preference.cadence.windowEndHour - 1}
              disabled={saving}
              onChange={(hour) => void save({ windowStartHour: hour })}
            />
            <Text style={styles.muted}>부터</Text>
            <HourStepper
              label="받기를 멈추는 시각"
              value={preference.cadence.windowEndHour}
              min={preference.cadence.windowStartHour + 1}
              max={CARE_WINDOW_MAX_HOUR}
              disabled={saving}
              onChange={(hour) => void save({ windowEndHour: hour })}
            />
            <Text style={styles.muted}>전까지</Text>
          </View>
          <Text style={styles.partnerLine} testID="amora-care-couple-cadence">
            {describeCoupleCadence(preference.couple)}
          </Text>
        </View>
      ) : null}

      {preference.chat.enabled ? (
        <Text style={styles.muted}>끄면 오늘 보내려던 글도 보내지 않아요.</Text>
      ) : null}
      {actionError ? (
        <Text style={styles.errorText} accessibilityRole="alert">{actionError}</Text>
      ) : null}
    </View>
  );
}

function HourStepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (hour: number) => void;
}) {
  return (
    <View style={styles.stepper} accessibilityLabel={`${label} ${formatCareHour(value)}`}>
      <Pressable
        onPress={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        accessibilityRole="button"
        accessibilityLabel={`${label} 한 시간 앞당기기`}
        style={({ pressed }) => [styles.stepperButton, (pressed || value <= min) && styles.pressed]}
      >
        <Text style={styles.stepperSymbol}>‹</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{formatCareHour(value)}</Text>
      <Pressable
        onPress={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        accessibilityRole="button"
        accessibilityLabel={`${label} 한 시간 늦추기`}
        style={({ pressed }) => [styles.stepperButton, (pressed || value >= max) && styles.pressed]}
      >
        <Text style={styles.stepperSymbol}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cadence: { gap: spacing[2], paddingLeft: spacing[3] },
  intensityRow: { flexDirection: "row", gap: spacing[2] },
  intensityOption: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing[1],
    backgroundColor: colors.surface,
  },
  intensitySelected: { borderColor: colors.rose[600], backgroundColor: colors.ivory[100] },
  intensityLabel: { fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  hourRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  stepperButton: { minWidth: 36, minHeight: 40, alignItems: "center", justifyContent: "center" },
  stepperSymbol: { fontSize: 18, color: colors.noir[800] },
  stepperValue: { fontSize: 13, fontWeight: "600", color: colors.noir[800], minWidth: 64, textAlign: "center" },
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing[4],
    paddingTop: spacing[4],
    gap: spacing[3],
  },
  switchRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  subRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    paddingLeft: spacing[3],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ivory[100],
  },
  copy: { flex: 1, gap: spacing[1] },
  headingRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  subTitle: { fontSize: 13, fontWeight: "600", color: colors.noir[800] },
  description: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  muted: { fontSize: 11, lineHeight: 17, color: colors.textSecondary },
  partnerLine: { fontSize: 12, lineHeight: 18, fontWeight: "600", color: colors.noir[800] },
  textButton: { alignSelf: "flex-start", paddingVertical: spacing[1] },
  textButtonLabel: { fontSize: 12, fontWeight: "600", color: colors.rose[700] },
  errorText: { fontSize: 12, lineHeight: 18, color: colors.dangerDeep },
  pressed: { opacity: 0.72 },
});
