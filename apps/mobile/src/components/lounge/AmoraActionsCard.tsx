import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Check, ListChecks } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  AMORA_ACTION_VISIBLE_LIMIT,
  buildCompleteActionBody,
  formatAmoraActionDueDate,
  parseAmoraActions,
  selectOpenAmoraActions,
} from "@/lib/amoraActions.mjs";
import { appShadow } from "@/components/ui/AppUI";

/**
 * 아모라가 챙기기로 한 것을 라운지에 보여준다.
 *
 * 서버는 이미 다 있었다 — `add_amora_action` 이 승인 카드로 나가고,
 * `/api/amora/actions` 가 목록을 주고, 웹 라운지는 그것을 보여준다.
 * **모바일에는 호출자가 0건이었다.** 앱에서 승인한 "챙길 것"이 저장은 되는데 앱
 * 어디에도 나타나지 않았다. 사용자에게는 방금 누른 승인이 사라지는 것으로 보인다.
 *
 * 요청은 **시작 시점 사용자에게 묶는다**(`apiFetchForExpectedUser`). 계정을 바꾼 뒤
 * 늦게 도착한 응답이 다른 사람의 할 일을 이 화면에 그리면 안 된다.
 *
 * 문구는 서버가 소유한다(`title`). 여기서 지어내지 않는다.
 */

type ActionRow = ReturnType<typeof parseAmoraActions>[number];

type ViewState =
  | { kind: "quiet" }
  | { kind: "ready"; visible: ActionRow[]; hiddenCount: number };

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

export default function AmoraActionsCard({
  refreshVersion = 0,
}: {
  /** 라운지의 당겨서 새로고침과 함께 다시 읽는다. */
  refreshVersion?: number;
}) {
  const [state, setState] = useState<ViewState>({ kind: "quiet" });
  const [authGeneration, setAuthGeneration] = useState(0);
  const [completing, setCompleting] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const operation = ++loadGeneration.current;
    try {
      const userId = await currentVerifiedUserId();
      sessionUserId.current = userId;
      if (!userId) {
        if (operation === loadGeneration.current) setState({ kind: "quiet" });
        return;
      }
      const response = await apiFetchForExpectedUser(
        userId,
        "/api/amora/actions?status=open&limit=20",
        { method: "GET", headers: { Accept: "application/json" }, signal },
      );
      if (!response.ok) {
        // 목록을 못 불러온 것으로 라운지를 막지 않는다. 조용히 비운다.
        if (operation === loadGeneration.current) setState({ kind: "quiet" });
        return;
      }
      const parsed = parseAmoraActions(await response.json());
      const userIdAfterResponse = await currentVerifiedUserId();
      if (operation !== loadGeneration.current || userIdAfterResponse !== userId) return;

      const picked = selectOpenAmoraActions(parsed, AMORA_ACTION_VISIBLE_LIMIT);
      setState(
        picked.openCount === 0
          ? { kind: "quiet" }
          : { kind: "ready", visible: picked.visible, hiddenCount: picked.hiddenCount },
      );
    } catch (error) {
      if (
        operation === loadGeneration.current
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setState({ kind: "quiet" });
      }
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      loadGeneration.current += 1;
      loadController.current?.abort();
      loadController.current = null;
      // 계정이 바뀌면 앞 사람의 줄이 한 프레임도 남으면 안 된다.
      setState({ kind: "quiet" });
      // 이 줄이 없으면 **첫 이벤트가 최초 적재를 끊고 끝난다.** 구독 직후 도착하는 첫
      // 이벤트는 sessionUserId 가 아직 null 이라 계정 전환으로 읽히는데, 다시 부를
      // 트리거가 없어 앱을 켜고 라운지에 머무는 사람은 목록을 한 번도 못 본다.
      setAuthGeneration((generation) => generation + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadController.current = controller;
      void load(controller.signal);
      return () => {
        controller.abort();
        if (loadController.current === controller) loadController.current = null;
        loadGeneration.current += 1;
      };
    }, [authGeneration, load, refreshVersion]),
  );

  const complete = useCallback(
    async (action: ActionRow) => {
      if (completing) return;
      setCompleting(action.id);
      const userId = sessionUserId.current ?? (await currentVerifiedUserId());
      if (!userId) {
        setCompleting(null);
        return;
      }
      try {
        const response = await apiFetchForExpectedUser(
          userId,
          `/api/amora/actions/${encodeURIComponent(action.id)}`,
          {
            method: "PATCH",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(buildCompleteActionBody()),
          },
        );
        // 저장에 실패했으면 줄을 지우지 않는다. 지우면 사용자는 끝난 줄 안다.
        if (!response.ok) return;
        await load();
      } catch {
        // 조용히 둔다. 다음 열람 때 그대로 보인다.
      } finally {
        setCompleting(null);
      }
    },
    [completing, load],
  );

  if (state.kind === "quiet") return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <ListChecks size={14} color={colors.rose[600]} />
        <Text style={styles.headerText}>아모라가 챙기기로 한 것</Text>
      </View>

      {state.visible.map((action) => {
        const due = formatAmoraActionDueDate(action.dueDate);
        return (
          <View key={action.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={2}>
                {action.title}
              </Text>
              {due ? <Text style={styles.due}>{due}</Text> : null}
            </View>
            <Pressable
              onPress={() => void complete(action)}
              disabled={completing !== null}
              accessibilityRole="button"
              accessibilityLabel={`${action.title} 완료로 표시`}
              style={({ pressed }) => [
                styles.doneButton,
                pressed && { opacity: 0.62 },
                completing !== null && { opacity: 0.4 },
              ]}
            >
              <Check size={14} color={colors.rose[600]} />
              <Text style={styles.doneText}>완료</Text>
            </Pressable>
          </View>
        );
      })}

      {state.hiddenCount > 0 ? (
        <Text style={styles.more}>외 {state.hiddenCount}개가 더 있어요.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    backgroundColor: colors.surface,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
    ...appShadow,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  headerText: { fontSize: 12, fontWeight: "600", color: colors.rose[600] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "600", color: colors.noir[800], lineHeight: 20 },
  due: { fontSize: 12, color: colors.textTertiary },
  doneButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  doneText: { fontSize: 12, fontWeight: "600", color: colors.rose[600] },
  more: { fontSize: 12, color: colors.textTertiary },
});
