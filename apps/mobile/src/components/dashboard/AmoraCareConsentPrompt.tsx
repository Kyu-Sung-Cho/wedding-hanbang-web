import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { BellRing } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  parseCarePreferencePayload,
  shouldAskCareConsentInLounge,
  type CarePreferencePayload,
} from "@/lib/careSettings";

// 10장 P1의 "한 번 묻기"(웹 `components/app/AmoraCareConsentPrompt.tsx` 와 같은 계약).
// 2026-11-13 파운더 결정: 첫 일정이 생긴 뒤 라운지에서 한 번, 거절하면 다시 묻지 않는다.
// 답은 서버(`care_prompt_answered_at`)에 남아 웹과 앱이 같은 답을 본다. 문장은 파운더가 정한다.

type ViewState =
  | { kind: "idle" }
  | { kind: "asking"; ownerUserId: string; preference: CarePreferencePayload }
  | { kind: "turnedOn"; preference: CarePreferencePayload };

const ROUTE = "/api/amora/care-preferences";

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

function turnedOnLine(preference: CarePreferencePayload): string {
  if (preference.partner.connected && !preference.partner.chatEnabled) {
    return "켜 두었어요. 상대도 켜면 그날부터 와요.";
  }
  return "켜 두었어요. 설정에서 언제든 끌 수 있어요.";
}

export default function AmoraCareConsentPrompt({
  plannedScheduleCount,
}: {
  plannedScheduleCount: number;
}) {
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loadGeneration = useRef(0);

  useEffect(() => {
    // 예정된 일정이 하나도 없으면 물을 이유가 없어서 서버에도 묻지 않는다.
    if (plannedScheduleCount <= 0) return;
    const operation = ++loadGeneration.current;
    void (async () => {
      try {
        const userId = await currentVerifiedUserId();
        if (!userId) return;
        const response = await apiFetchForExpectedUser(userId, ROUTE, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const payload = await response.json().catch(() => null);
        if (operation !== loadGeneration.current || !response.ok) return;
        const preference = parseCarePreferencePayload(payload);
        if (preference && shouldAskCareConsentInLounge(preference, plannedScheduleCount)) {
          setView({ kind: "asking", ownerUserId: userId, preference });
        }
      } catch {
        // 묻지 못해도 라운지는 그대로 쓴다. 다음에 라운지를 열 때 다시 확인한다.
      }
    })();
    return () => {
      loadGeneration.current += 1;
    };
  }, [plannedScheduleCount]);

  async function answer(turnOn: boolean) {
    if (view.kind !== "asking" || saving) return;
    const { ownerUserId } = view;
    setSaving(true);
    setError("");
    try {
      if (await currentVerifiedUserId() !== ownerUserId) {
        setView({ kind: "idle" });
        return;
      }
      const response = await apiFetchForExpectedUser(ownerUserId, ROUTE, {
        method: "PUT",
        headers: { Accept: "application/json" },
        body: JSON.stringify(turnOn ? { chat: true } : { promptAnswered: true }),
      });
      const payload = await response.json().catch(() => null);
      const preference = response.ok ? parseCarePreferencePayload(payload) : null;
      if (!preference) {
        setError("설정을 저장하지 못했어요. 기존 설정은 그대로예요.");
        return;
      }
      setView(turnOn ? { kind: "turnedOn", preference } : { kind: "idle" });
    } catch {
      setError("설정을 저장하지 못했어요. 기존 설정은 그대로예요.");
    } finally {
      setSaving(false);
    }
  }

  if (view.kind === "idle") return null;
  if (view.kind === "turnedOn") {
    return (
      <View style={styles.doneCard} testID="amora-care-consent-prompt-done">
        <Text style={styles.doneText}>{turnedOnLine(view.preference)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="amora-care-consent-prompt">
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <BellRing size={18} color={colors.noir[800]} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>아모라가 먼저 알려 주기</Text>
          <Text style={styles.title} accessibilityRole="header">일정 전날, 아모라가 먼저 알려 드릴까요?</Text>
          <Text style={styles.body}>
            상견례, 식장 방문, 촬영처럼 일정에 넣은 날이 다가오면 함께 대화에 먼저 글을 남겨요. 두 분이 모두 켜야 오고, 설정에서 언제든 끌 수 있어요.
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => void answer(true)}
          disabled={saving}
          style={({ pressed }) => [styles.primary, (pressed || saving) && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="켜기"
        >
          {saving
            ? <ActivityIndicator size="small" color={colors.surface} />
            : <Text style={styles.primaryLabel}>켜기</Text>}
        </Pressable>
        <Pressable
          onPress={() => void answer(false)}
          disabled={saving}
          style={({ pressed }) => [styles.secondary, (pressed || saving) && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="괜찮아요"
        >
          <Text style={styles.secondaryLabel}>괜찮아요</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.sage.pale,
    backgroundColor: colors.ivory[50],
    borderRadius: radius.xl,
    padding: spacing[4],
    gap: spacing[3],
  },
  doneCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  doneText: { fontSize: 13, lineHeight: 20, fontWeight: "600", color: colors.textSecondary },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  copy: { flex: 1, gap: spacing[1] },
  eyebrow: { fontSize: 11, fontWeight: "600", color: colors.textSecondary },
  title: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  body: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  actions: { flexDirection: "row", gap: spacing[2] },
  primary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.rose[600],
  },
  primaryLabel: { fontSize: 14, fontWeight: "700", color: colors.surface },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  errorText: { fontSize: 12, lineHeight: 18, color: colors.dangerDeep },
  pressed: { opacity: 0.72 },
});
