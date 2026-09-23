import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { BellRing, Clock3, RotateCcw, ShieldCheck } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { preferenceRequest } from "@/lib/preferenceRequest";
import {
  parseTodayOnePreferenceEnvelope,
  type TodayOnePreference,
} from "@/lib/todayOneCare.mjs";

type PreferenceMode = "enable" | "disable" | "pause_24h";
type ViewState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; ownerUserId: string; preference: TodayOnePreference }
  | { kind: "error"; message: string };

function pendingWriteView(preference?: TodayOnePreference): ViewState {
  const snapshot = preference ? ` 조회 시점 설정: ${preference.enabled ? "켜짐" : "꺼짐"}.` : "";
  return { kind: "error", message: `변경 결과를 확인하지 못했어요.${snapshot} 앞선 저장 처리가 끝나기 전에는 다시 변경하지 않아요. 다시 불러와 확인해 주세요.` };
}

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user?.id ?? null;
}

function payloadError(payload: unknown, fallback: string): string {
  if (
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).error === "string"
  ) {
    const message = (payload as Record<string, unknown>).error as string;
    if (message.length > 0 && message.length <= 240) return message;
  }
  return fallback;
}

function isPaused(preference: TodayOnePreference): boolean {
  return preference.pausedUntil !== null
    && Date.parse(preference.pausedUntil) > Date.now();
}

function formatPause(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "일시 중지됨";
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}까지 쉼`;
}

export default function TodayOnePreferenceControl() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [authGeneration, setAuthGeneration] = useState(0);
  const [pendingMode, setPendingMode] = useState<PreferenceMode | null>(null);
  const [actionError, setActionError] = useState("");
  const loadGeneration = useRef(0);
  const saveGeneration = useRef(0);
  const saveInFlight = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const sessionUserId = useRef<string | null>(null);
  const writeAttempt = useRef<{ settled: boolean; reconcileOnSettle: boolean } | null>(null);

  const load = useCallback(async () => {
    const operation = ++loadGeneration.current;
    setView({ kind: "loading" });
    setActionError("");
    try {
      const result = await preferenceRequest(async signal => {
        const userId = await currentVerifiedUserId();
        if (signal.aborted || operation !== loadGeneration.current) throw new Error("PREFERENCE_OWNER_CHANGED");
        if (!userId) return null;
        const response = await apiFetchForExpectedUser(userId, "/api/amora/today-one/preferences", {
          method: "GET", headers: { Accept: "application/json" }, signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (await currentVerifiedUserId() !== userId) throw new Error("PREFERENCE_OWNER_CHANGED");
        return { userId, response, payload };
      });
      if (operation !== loadGeneration.current) return;
      const userId = result?.userId ?? null;
      sessionUserId.current = userId;
      if (!result) {
        if (operation === loadGeneration.current) setView({ kind: "unavailable" });
        return;
      }
      const { response, payload } = result;
      const parsed = parseTodayOnePreferenceEnvelope(payload);
      if (!response.ok || !parsed) {
        setView({
          kind: "error",
          message: response.ok
            ? "오늘의 한 가지 설정 형식을 확인하지 못했어요."
            : payloadError(payload, "오늘의 한 가지 설정을 불러오지 못했어요."),
        });
        return;
      }
      if (writeAttempt.current && !writeAttempt.current.settled) {
        writeAttempt.current.reconcileOnSettle = true;
        setView(pendingWriteView(parsed.available ? parsed.preference : undefined));
      } else setView(parsed.available
        ? { kind: "ready", ownerUserId: result.userId, preference: parsed.preference }
        : { kind: "unavailable" });
    } catch {
      if (operation === loadGeneration.current) {
        if (writeAttempt.current && !writeAttempt.current.settled) writeAttempt.current.reconcileOnSettle = true;
        setView({ kind: "error", message: "오늘의 한 가지 설정을 불러오지 못했어요." });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [authGeneration, load]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      loadGeneration.current += 1;
      saveGeneration.current += 1;
      saveController.current?.abort();
      saveController.current = null;
      saveInFlight.current = false;
      writeAttempt.current = null;
      setPendingMode(null);
      setActionError("");
      setView(nextUserId ? { kind: "loading" } : { kind: "unavailable" });
      setAuthGeneration((generation) => generation + 1);
    });
    return () => {
      loadGeneration.current += 1;
      saveGeneration.current += 1;
      saveController.current?.abort();
      saveController.current = null;
      saveInFlight.current = false;
      writeAttempt.current = null;
      subscription.unsubscribe();
    };
  }, []);

  async function saveMode(mode: PreferenceMode) {
    if (view.kind !== "ready" || pendingMode || saveInFlight.current) return;
    saveInFlight.current = true;
    const ownerUserId = view.ownerUserId;
    const operation = ++saveGeneration.current;
    const attempt = { settled: false, reconcileOnSettle: false };
    writeAttempt.current = attempt;
    const controller = new AbortController();
    saveController.current = controller;
    setPendingMode(mode);
    setActionError("");
    try {
      const { response, payload } = await preferenceRequest(async signal => {
        const userId = await currentVerifiedUserId();
        if (signal.aborted || operation !== saveGeneration.current || userId !== ownerUserId) {
          throw new Error("PREFERENCE_OWNER_CHANGED");
        }
        const response = await apiFetchForExpectedUser(ownerUserId, "/api/amora/today-one/preferences", {
          method: "PUT", headers: { Accept: "application/json" }, body: JSON.stringify({ mode, expectedOwnerId: ownerUserId }), signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (await currentVerifiedUserId() !== ownerUserId) throw new Error("PREFERENCE_OWNER_CHANGED");
        return { response, payload };
      }, controller.signal, () => {
        attempt.settled = true;
        if (attempt.reconcileOnSettle && writeAttempt.current === attempt && operation === saveGeneration.current) {
          writeAttempt.current = null;
          void load();
        }
      });
      if (operation !== saveGeneration.current) return;
      const parsed = parseTodayOnePreferenceEnvelope(payload);
      if (!response.ok || !parsed || !parsed.available) {
        throw new Error("PREFERENCE_RESULT_UNKNOWN");
      }
      setView({ kind: "ready", ownerUserId, preference: parsed.preference });
    } catch {
      if (operation !== saveGeneration.current) return;
      const recovery = ++loadGeneration.current;
      attempt.reconcileOnSettle = !attempt.settled;
      try {
        const parsed = await preferenceRequest(async signal => {
          if (operation !== saveGeneration.current || await currentVerifiedUserId() !== ownerUserId || signal.aborted) {
            throw new Error("PREFERENCE_OWNER_CHANGED");
          }
          const response = await apiFetchForExpectedUser(ownerUserId, "/api/amora/today-one/preferences", {
            method: "GET", headers: { Accept: "application/json" }, signal,
          });
          const parsed = parseTodayOnePreferenceEnvelope(await response.json());
          if (!response.ok || !parsed?.available || await currentVerifiedUserId() !== ownerUserId) {
            throw new Error("PREFERENCE_READ_FAILED");
          }
          return parsed;
        }, controller.signal);
        if (operation !== saveGeneration.current || recovery !== loadGeneration.current) return;
        if (!attempt.settled) {
          attempt.reconcileOnSettle = true;
          setView(pendingWriteView(parsed.preference));
        } else {
          setView({ kind: "ready", ownerUserId, preference: parsed.preference });
          setActionError("저장 응답을 확인하지 못해 현재 서버 설정을 다시 불러왔어요. 변경이 늦게 반영될 수 있어요.");
        }
      } catch {
        if (operation === saveGeneration.current && recovery === loadGeneration.current) {
          attempt.reconcileOnSettle = !attempt.settled;
          setView(pendingWriteView());
        }
      }
    } finally {
      if (operation === saveGeneration.current) {
        saveController.current = null;
        saveInFlight.current = false;
        setPendingMode(null);
      }
    }
  }

  function setEnabled(nextEnabled: boolean) {
    void saveMode(nextEnabled ? "enable" : "disable");
  }

  if (view.kind === "unavailable") return null;

  if (view.kind === "loading") {
    return (
      <View style={styles.container} accessibilityRole="progressbar">
        <ActivityIndicator size="small" color={colors.rose[500]} />
        <Text style={styles.loadingText}>오늘의 한 가지 설정 확인 중</Text>
      </View>
    );
  }

  if (view.kind === "error") {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <View style={styles.headingRow}>
          <RotateCcw size={18} color={colors.rose[600]} />
          <Text style={styles.title}>오늘의 한 가지 설정</Text>
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

  const paused = isPaused(view.preference);
  return (
    <View style={styles.container}>
      <View style={styles.switchRow}>
        <View style={styles.iconWrap}>
          <BellRing size={18} color={colors.noir[800]} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>아모라 오늘의 한 가지(인앱)</Text>
          <Text style={styles.description}>
            앱 홈에서 하루 최대 1건만 보여요. 푸시·문자·이메일 알림은 보내지 않아요.
          </Text>
        </View>
        {pendingMode === "enable" || pendingMode === "disable" ? (
          <ActivityIndicator size="small" color={colors.rose[500]} />
        ) : (
          <Switch
            value={view.preference.enabled}
            onValueChange={setEnabled}
            disabled={pendingMode !== null}
            trackColor={{ false: colors.ivory[200], true: colors.rose.light }}
            thumbColor={view.preference.enabled ? colors.rose[600] : colors.taupe[400]}
            accessibilityLabel="아모라 오늘의 한 가지 인앱 켜기"
          />
        )}
      </View>

      <View style={styles.promiseRow}>
        <ShieldCheck size={15} color={colors.sage[500]} />
        <Text style={styles.promiseText}>
          켜기 전에는 만들거나 보여주지 않으며, 언제든 끌 수 있어요.
        </Text>
      </View>

      {view.preference.enabled ? (
        <Pressable
          onPress={() => void saveMode(paused ? "enable" : "pause_24h")}
          disabled={pendingMode !== null}
          style={({ pressed }) => [
            styles.pauseButton,
            pressed && styles.pressed,
            pendingMode !== null && styles.disabled,
          ]}
          accessibilityRole="button"
        >
          {pendingMode === "pause_24h" || (paused && pendingMode === "enable") ? (
            <ActivityIndicator size="small" color={colors.rose[600]} />
          ) : (
            <Clock3 size={16} color={colors.rose[600]} />
          )}
          <Text style={styles.pauseLabel}>
            {paused && view.preference.pausedUntil
              ? `${formatPause(view.preference.pausedUntil)} · 다시 켜기`
              : "24시간 쉬기"}
          </Text>
        </Pressable>
      ) : null}

      {actionError ? (
        <Text style={styles.errorText} accessibilityRole="alert">{actionError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing[4],
    paddingTop: spacing[4],
    gap: spacing[3],
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
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
  description: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  loadingText: { fontSize: 12, color: colors.textSecondary },
  promiseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  promiseText: { flex: 1, fontSize: 11, lineHeight: 17, color: colors.noir.soft },
  pauseButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  pauseLabel: { fontSize: 12, fontWeight: "600", color: colors.rose[700] },
  textButton: { alignSelf: "flex-start", paddingVertical: spacing[1] },
  textButtonLabel: { fontSize: 12, fontWeight: "600", color: colors.rose[700] },
  errorText: { fontSize: 12, lineHeight: 18, color: colors.dangerDeep },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
