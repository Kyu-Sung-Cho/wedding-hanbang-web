"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  AMORA_TASK_COPY,
  amoraTaskWebPath,
  parseAmoraTaskList,
  type AmoraTaskSummary,
} from "@hanbang/shared/amora-tasks";

import { INVITATION_FOCUS_RING, INVITATION_LINK_TONE, cx } from "@/components/invitation/invitationScreen";
import { useAuthStore } from "@/stores/authStore";

import { AMORA_TASKS_API_PATH, AmoraTaskStagePill, requestAmoraTasks } from "./amoraTaskParts";

/** 홈에 보이는 맡은 일의 수. */
const HOME_TASK_LIMIT = 3;
/** 찾는 중이거나 정리 중인 일이 있는 동안 이 간격으로 다시 읽는다. */
const REFRESH_MS = 30_000;

type Loaded = { viewer: string; tasks: AmoraTaskSummary[] };

/**
 * 홈에 보일 맡은 일을 읽는다. 보이던 것을 그대로 둘 때(연결 끊김, 429·5xx, 화면이 떠남)는 null 이다.
 * 로그인이 풀렸거나(401·403) 스위치가 꺼졌거나 표가 없으면 빈 목록이라 아무것도 그리지 않는다.
 */
async function readHomeTasks(signal: AbortSignal): Promise<AmoraTaskSummary[] | null> {
  const reply = await requestAmoraTasks(AMORA_TASKS_API_PATH, { signal });
  if (!reply.received) return null;
  if (!reply.ok && reply.status !== 401 && reply.status !== 403) return null;
  const list = reply.ok ? parseAmoraTaskList(reply.payload) : null;
  return list?.visible ? list.tasks : [];
}

/** 지금 계정과 커플. 바뀌면 앞 사람의 맡은 일을 곧바로 지우고 다시 읽는다. */
function useViewerKey(): string | null {
  return useAuthStore((state) => {
    const userId = state.user?.id ?? null;
    if (!userId) return null;
    const coupleId = state.profile?.id === userId ? state.profile.couple_id ?? "" : "";
    return `${userId}:${coupleId}`;
  });
}

/**
 * 청첩장 홈의 "아모라가 맡은 일"(D-84, 25장 갈래 4). 알림 자리(`LiveLoungeNotices`)에서 상대 알림 바로 다음에 온다.
 * 맡은 일을 세 개까지 제목과 단계 알약으로 보이고, 누르면 결과 화면(`/wedding/amora-tasks/<id>`)을 연다.
 *
 * - 스위치가 꺼졌거나 표가 아직 없으면(`enabled`·`available` 이 false) 아무것도 그리지 않는다.
 * - 맡긴 일이 없거나, 로그인이 풀렸거나(401), 서버가 답하지 못하면 조용히 숨는다. 홈은 깨지지 않는다.
 * - 카드만 나온 일(`offered`)과 그만둔 일, 닫힌 일은 계약의 읽는 함수가 걸러 그리지 않는다.
 * - 찾는 중이거나 정리 중인 일이 있으면 30초마다 다시 읽는다. 화면을 떠나면 멈춘다.
 * - 계정이나 커플이 바뀌면 앞 사람의 제목을 곧바로 지운다(알림 자리의 다른 알림과 같은 약속).
 */
export default function AmoraTasksNotice() {
  const viewer = useViewerKey();
  const titleId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const controller = new AbortController();
    void readHomeTasks(controller.signal).then((next) => {
      if (next && !controller.signal.aborted) setLoaded({ viewer, tasks: next });
    });
    return () => controller.abort();
  }, [viewer]);

  const tasks = loaded && loaded.viewer === viewer ? loaded.tasks : [];
  const working = tasks.some((task) => task.stage === "searching" || task.stage === "organizing");

  useEffect(() => {
    if (!viewer || !working) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void readHomeTasks(controller.signal).then((next) => {
        if (next && !controller.signal.aborted) setLoaded({ viewer, tasks: next });
      });
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [viewer, working]);

  const rows = tasks.slice(0, HOME_TASK_LIMIT).flatMap((task) => {
    const href = amoraTaskWebPath(task.id);
    return href && task.stage ? [{ task, href, stage: task.stage }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-[22px] bg-inv-paper-soft px-4 pt-4 pb-1 shadow-[inset_0_0_0_1px_#EEEAE6]"
      data-amora-tasks
    >
      <h2 id={titleId} className="font-inv-serif text-[18px] font-bold">
        {AMORA_TASK_COPY.homeTitle}
      </h2>
      <ul className="flex flex-col">
        {rows.map(({ task, href, stage }, index) => (
          <li key={task.id} className={cx(index < rows.length - 1 && "border-b border-inv-divider")}>
            <Link
              href={href}
              className={cx("flex min-h-12 items-center gap-3 py-3", INVITATION_LINK_TONE, INVITATION_FOCUS_RING)}
              data-amora-task={task.id}
            >
              <span className="min-w-0 flex-1 text-[15px] font-medium">{task.title}</span>
              <AmoraTaskStagePill stage={stage} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
