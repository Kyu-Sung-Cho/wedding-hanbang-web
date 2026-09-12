import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { BellRing, ShieldCheck } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { registerForPushNotifications } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; ownerId: string; enabled: boolean }
  | { kind: "unavailable" };

async function currentOwnerId() {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

export default function CommunityReplyPushPreferenceControl() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    const operation = ++generation.current;
    void (async () => {
      try {
        const ownerId = await currentOwnerId();
        if (!ownerId) {
          if (operation === generation.current) setView({ kind: "unavailable" });
          return;
        }
        const result = await supabase.rpc("community_get_reply_push_preference");
        if (
          operation !== generation.current
          || await currentOwnerId() !== ownerId
        ) return;
        if (result.error || typeof result.data !== "boolean") {
          setView({ kind: "unavailable" });
          return;
        }
        setView({ kind: "ready", ownerId, enabled: result.data });
      } catch {
        if (operation === generation.current) setView({ kind: "unavailable" });
      }
    })();
    return () => { generation.current += 1; };
  }, []);

  async function setEnabled(nextEnabled: boolean) {
    if (view.kind !== "ready" || saving) return;
    const operation = ++generation.current;
    const previous = view.enabled;
    setSaving(true);
    setError("");
    try {
      if (nextEnabled) {
        const token = await registerForPushNotifications();
        if (!token) {
          throw new Error("PUSH_PERMISSION_NOT_GRANTED");
        }
      }
      if (await currentOwnerId() !== view.ownerId) return;
      const result = await supabase.rpc("community_set_reply_push_preference", {
        p_enabled: nextEnabled,
      });
      if (
        result.error
        || result.data !== nextEnabled
        || await currentOwnerId() !== view.ownerId
      ) {
        throw new Error("COMMUNITY_PUSH_PREFERENCE_SAVE_FAILED");
      }
      if (operation === generation.current) {
        setView({ ...view, enabled: nextEnabled });
      }
    } catch {
      if (operation === generation.current) {
        setView({ ...view, enabled: previous });
        setError(nextEnabled
          ? "휴대폰 알림을 허용한 뒤 다시 켜 주세요. 아직 외부 푸시는 보내지 않아요."
          : "설정을 저장하지 못했어요. 기존 설정은 그대로예요.");
      }
    } finally {
      if (operation === generation.current) setSaving(false);
    }
  }

  if (view.kind === "unavailable") return null;
  if (view.kind === "loading") {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="small" color={colors.rose[500]} />
        <Text style={styles.description}>커뮤니티 답글 푸시 설정 확인 중</Text>
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
          <Text style={styles.title}>커뮤니티 답글 푸시</Text>
          {/*
            켜면 실제로 일어나는 일만 적는다 — 동의를 저장하고 이 기기를 등록한다.
            발송은 아직 하지 않는다: 발송기는 어느 스케줄러에도 붙어 있지 않고
            (`apps/web/vercel.json` 크론 목록에 없다), 그 부재를 테스트가 롤아웃
            승인 전까지 잠가 두었다(community-notification-push/route.test.ts:52).

            예전 문구는 "앱을 닫아도 … 알려드려요" 였다. 권한을 허용한 실기기에서는
            토글이 오류 없이 켜지므로, 사용자는 약속을 받고도 알림을 영영 못 받는다.
            같은 파일의 오류 문구가 이미 "아직 외부 푸시는 보내지 않아요" 라고
            사실을 말하고 있어 두 문장이 서로 어긋나 있었다.

            앱 안 알림 목록을 대안으로 안내하지 않는다 — 모바일에는 커뮤니티 알림
            목록 화면이 없다. 없는 곳을 가리키면 거짓말이 하나 더 늘 뿐이다.
          */}
          <Text style={styles.description}>
            새 답글 알림을 받을 기기로 등록해 둬요. 휴대폰 알림은 아직 보내지 않고,
            시작할 때 켜 두신 분에게만 보내드려요.
          </Text>
        </View>
        {saving ? (
          <ActivityIndicator size="small" color={colors.rose[500]} />
        ) : (
          <Switch
            value={view.enabled}
            onValueChange={(enabled) => void setEnabled(enabled)}
            trackColor={{ false: colors.ivory[200], true: colors.rose.light }}
            thumbColor={view.enabled ? colors.rose[600] : colors.taupe[400]}
            accessibilityLabel="커뮤니티 답글 외부 푸시 켜기"
          />
        )}
      </View>
      <View style={styles.promise}>
        <ShieldCheck size={15} color={colors.sage[500]} />
        <Text style={styles.promiseText}>
          잠금화면에는 글 제목·본문·작성자·업체·금액·날짜를 넣지 않아요. 앱 안 알림은 이 설정과 별개예요.
        </Text>
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
  loading: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
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
  promiseText: { flex: 1, fontSize: 11, lineHeight: 17, color: colors.sage[500] },
  error: { fontSize: 11, lineHeight: 17, color: colors.rose[600] },
});
