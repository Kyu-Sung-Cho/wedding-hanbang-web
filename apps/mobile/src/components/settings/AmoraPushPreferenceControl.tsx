// 아모라 앱 알림 켜기·끄기(결정 D-86). 메일 동의·커뮤니티 답글 알림과 따로다.
//
// 서버가 실제로 보낼 수 있을 때(`available`)만 보인다. 발송 스위치가 꺼져 있는 동안 켜기를 받으면 켜도 오지 않는
// 알림을 약속하게 된다(커뮤니티 답글 칸이 같은 일로 고쳐졌다). 문장은 파운더가 정한다(18장 D-12).
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { BellRing, ShieldCheck } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { registerForPushNotifications } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

const ROUTE = "/api/amora/push-preference";

export const AMORA_PUSH_CONTROL_COPY = {
  title: "아모라 앱 알림",
  description: "아모라가 정리한 게 있을 때 폰으로 알려 드려요. 하루 두 번까지, 오전 9시부터 오후 8시 전까지만 보내요.",
  promise: "잠금화면에는 \"아모라가 정리한 게 있어요\"만 보여요. 메일 알림과는 따로 켜고 꺼요.",
  permissionError: "휴대폰 알림을 허용한 뒤 다시 켜 주세요.",
  saveError: "설정을 저장하지 못했어요. 기존 설정은 그대로예요.",
  loading: "앱 알림 설정 확인 중",
  switchLabel: "아모라 앱 알림 켜기",
} as const;

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; ownerId: string; enabled: boolean }
  | { kind: "hidden" };

type Payload = { available: boolean; enabled: boolean; consentedAt: string | null };

export function parseAmoraPushPreference(value: unknown): Payload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.available !== "boolean" || typeof record.enabled !== "boolean") return null;
  if (!(record.consentedAt === null || typeof record.consentedAt === "string")) return null;
  if (record.enabled !== (record.consentedAt !== null)) return null;
  return { available: record.available, enabled: record.enabled, consentedAt: record.consentedAt as string | null };
}

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

export default function AmoraPushPreferenceControl() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    const operation = ++generation.current;
    void (async () => {
      try {
        const userId = await currentVerifiedUserId();
        if (!userId) {
          if (operation === generation.current) setView({ kind: "hidden" });
          return;
        }
        const response = await apiFetchForExpectedUser(userId, ROUTE, { method: "GET" });
        const payload = parseAmoraPushPreference(await response.json().catch(() => null));
        if (operation !== generation.current || await currentVerifiedUserId() !== userId) return;
        // 보낼 수 없는 동안에는 칸을 그리지 않는다. 이미 켜 둔 사람은 끌 수 있게 남긴다.
        if (!response.ok || !payload || (!payload.available && !payload.enabled)) {
          setView({ kind: "hidden" });
          return;
        }
        setView({ kind: "ready", ownerId: userId, enabled: payload.enabled });
      } catch {
        if (operation === generation.current) setView({ kind: "hidden" });
      }
    })();
    return () => { generation.current += 1; };
  }, []);

  async function setEnabled(nextEnabled: boolean) {
    if (view.kind !== "ready" || saving) return;
    const operation = ++generation.current;
    const ownerUserId = view.ownerId;
    const previous = view.enabled;
    setSaving(true);
    setError("");
    try {
      if (nextEnabled && !await registerForPushNotifications()) {
        throw new Error("PUSH_PERMISSION_NOT_GRANTED");
      }
      if (await currentVerifiedUserId() !== ownerUserId) return;
      const response = await apiFetchForExpectedUser(ownerUserId, ROUTE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const payload = parseAmoraPushPreference(await response.json().catch(() => null));
      if (!response.ok || !payload || payload.enabled !== nextEnabled || await currentVerifiedUserId() !== ownerUserId) {
        throw new Error("AMORA_PUSH_PREFERENCE_SAVE_FAILED");
      }
      if (operation === generation.current) setView({ kind: "ready", ownerId: ownerUserId, enabled: nextEnabled });
    } catch (caught) {
      if (operation === generation.current) {
        setView({ kind: "ready", ownerId: ownerUserId, enabled: previous });
        setError(caught instanceof Error && caught.message === "PUSH_PERMISSION_NOT_GRANTED"
          ? AMORA_PUSH_CONTROL_COPY.permissionError
          : AMORA_PUSH_CONTROL_COPY.saveError);
      }
    } finally {
      if (operation === generation.current) setSaving(false);
    }
  }

  if (view.kind === "hidden") return null;
  if (view.kind === "loading") {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="small" color={colors.rose[500]} />
        <Text style={styles.description}>{AMORA_PUSH_CONTROL_COPY.loading}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <BellRing size={18} color={colors.noir[800]} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{AMORA_PUSH_CONTROL_COPY.title}</Text>
          <Text style={styles.description}>{AMORA_PUSH_CONTROL_COPY.description}</Text>
        </View>
        {saving ? (
          <ActivityIndicator size="small" color={colors.rose[500]} />
        ) : (
          <Switch
            value={view.enabled}
            onValueChange={(enabled) => void setEnabled(enabled)}
            trackColor={{ false: colors.ivory[200], true: colors.rose.light }}
            thumbColor={view.enabled ? colors.rose[600] : colors.taupe[400]}
            accessibilityLabel={AMORA_PUSH_CONTROL_COPY.switchLabel}
          />
        )}
      </View>
      <View style={styles.promise}>
        <ShieldCheck size={15} color={colors.sage[500]} />
        <Text style={styles.promiseText}>{AMORA_PUSH_CONTROL_COPY.promise}</Text>
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
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
  loading: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing[2] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ivory[100],
  },
  copy: { flex: 1, gap: spacing[1] },
  title: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  description: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  promise: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  promiseText: { flex: 1, fontSize: 11, lineHeight: 17, color: colors.noir.soft },
  error: { fontSize: 11, lineHeight: 17, color: colors.rose[700] },
});
