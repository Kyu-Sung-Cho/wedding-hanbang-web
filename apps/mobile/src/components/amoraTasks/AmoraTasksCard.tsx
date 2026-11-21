import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import {
  AMORA_TASK_COPY,
  AMORA_TASK_STAGE_LABELS,
  amoraTaskAppPath,
  type AmoraTaskSummary,
} from "@hanbang/shared/amora-tasks";
import { Text } from "@/components/ui/AppText";
import { lineHeight, palette, typo } from "@/components/invitation/invitationStyle";
import { apiFetchForExpectedUserQuiet } from "@/lib/api";
import { useLiveOwner } from "@/lib/invitationLive";
import {
  AMORA_TASK_HOME_POLL_MS,
  fetchAmoraTaskList,
  hasWorkingAmoraTask,
  homeAmoraTasks,
} from "@/lib/amoraTasks.mjs";

type Shown = { ownerId: string; tasks: readonly AmoraTaskSummary[] };

/**
 * 홈의 「아모라가 맡은 일」(D-84). 홈의 알림 자리(`LoungeNotices`)에 한 줄로 들어간다.
 *
 * - 맡긴 일이 있을 때만 그린다. 스위치가 꺼졌거나 표가 없거나 맡긴 일이 없으면 아무것도 그리지 않아 자리도 없다.
 * - 이 카드는 홈을 막지 않는다. 401 에도 로그아웃 알림을 띄우지 않는 조회(`apiFetchForExpectedUserQuiet`)를 쓰고,
 *   읽지 못하면 보던 목록을 그대로 둔다(처음부터 못 읽었으면 그리지 않는다).
 * - 화면에 올 때마다 읽고, 찾는 중·정리 중인 일이 있는 동안에만 30초마다 다시 읽는다.
 * - 줄을 누르면 그 일의 결과 화면(`/amora-task/<id>`)이 열린다. 글자는 전부 공유 계약의 문장이다.
 */
export default function AmoraTasksCard() {
  const liveOwner = useLiveOwner();
  const ownerId = liveOwner.status === "ready" ? liveOwner.ownerId : null;
  const [shown, setShown] = useState<Shown | null>(null);
  const workingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!ownerId) return undefined;
      let active = true;
      let turn = 0;
      const controller = new AbortController();
      const fetcher = (path: string, init: RequestInit) =>
        apiFetchForExpectedUserQuiet(ownerId, path, { ...init, signal: controller.signal });
      const load = async () => {
        const mine = ++turn;
        const read = await fetchAmoraTaskList(fetcher);
        // 뒤에 시작한 읽기가 있거나 화면을 떠났으면 버린다. 실패하면 보던 목록을 그대로 둔다.
        if (!active || mine !== turn || !read.ok) return;
        workingRef.current = hasWorkingAmoraTask(read.list);
        setShown({ ownerId, tasks: homeAmoraTasks(read.list) });
      };
      void load();
      const timer = setInterval(() => {
        if (workingRef.current) void load();
      }, AMORA_TASK_HOME_POLL_MS);
      return () => {
        active = false;
        controller.abort();
        clearInterval(timer);
      };
    }, [ownerId]),
  );

  // 다른 사람으로 바뀌었으면 앞사람의 목록을 그리지 않는다.
  const tasks = shown && shown.ownerId === ownerId ? shown.tasks : [];
  if (tasks.length === 0) return null;

  return (
    <View>
      <Text accessibilityRole="header" style={[typo.serifBold, styles.heading]}>
        {AMORA_TASK_COPY.homeTitle}
      </Text>
      {tasks.map((task, index) => (
        <TaskRow key={task.id} task={task} last={index === tasks.length - 1} />
      ))}
    </View>
  );
}

/** 「두 분이 정할 것」 줄과 같은 모양이다(15px 제목, 오른쪽 알약). 확인해 주세요 단계만 알약을 분홍으로 둔다. */
function TaskRow({ task, last }: { task: AmoraTaskSummary; last: boolean }) {
  const path = amoraTaskAppPath(task.id);
  const stageLabel = task.stage ? AMORA_TASK_STAGE_LABELS[task.stage] : null;
  if (!path || !stageLabel) return null;
  return (
    <Pressable
      onPress={() => router.push(path as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${stageLabel}`}
      style={[styles.row, !last && styles.divider]}
    >
      {({ pressed }) => (
        <>
          <Text style={[typo.sansMedium, styles.title, pressed && styles.pressed]} numberOfLines={2}>
            {task.title}
          </Text>
          <View style={[styles.stage, task.stage === "needs_review" && styles.stageAttention]}>
            <Text style={[typo.sans, styles.stageText]}>{stageLabel}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, marginBottom: 6 },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  divider: { borderBottomWidth: 1, borderBottomColor: palette.divider },
  title: { flex: 1, fontSize: 15, lineHeight: lineHeight(15, 1.4) },
  pressed: { color: palette.muted },
  stage: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: palette.stone },
  stageAttention: { backgroundColor: palette.blush },
  stageText: { fontSize: 12 },
});
