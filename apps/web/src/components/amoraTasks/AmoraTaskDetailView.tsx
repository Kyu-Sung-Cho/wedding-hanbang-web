"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import {
  AMORA_TASK_COPY,
  parseAmoraTaskDetail,
  safeAmoraTaskSourceUrl,
  type AmoraTaskDetail,
  type AmoraTaskResult,
} from "@hanbang/shared/amora-tasks";

import { openAmoraInsteadOfLink, useAmoraDock } from "@/components/app/amora/amoraDock";
import { INVITATION_FOCUS_RING, cx } from "@/components/invitation/invitationScreen";
import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";
import { weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

import {
  AmoraTaskLine,
  AmoraTaskStagePill,
  amoraTaskApiPath,
  amoraTaskReplyCode,
  isAmoraTaskReplyAccepted,
  isAmoraTasksOff,
  requestAmoraTasks,
  type AmoraTasksReply,
} from "./amoraTaskParts";

/** 찾는 중이거나 정리 중인 동안 이 간격으로 다시 읽는다. */
const POLL_MS = 15_000;
/** 돌아가기는 홈으로 간다. 홈의 "아모라가 맡은 일"과 대화 카드의 진행 보기가 이 화면을 연다. */
const BACK_HREF = "/wedding/lounge";

/** 그만하기·이어서 하기가 실패했을 때(D-12 승인 대기, 앱과 같은 문장). */
const ACTION_FAILED = AMORA_TASK_COPY.actionFailed;

/** 그사이 상태가 이미 바뀐 응답. 다시 읽으면 바뀐 상태가 보이므로 실패 문장을 띄우지 않는다. */
const SETTLED_CODES: ReadonlySet<string> = new Set(["not_resumable", "closed", "not_found"]);

type TaskWrite = "cancel" | "resume";

type View =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "failed" }
  | { kind: "ready"; detail: AmoraTaskDetail };

const LOADING: View = { kind: "loading" };

function nextView(reply: AmoraTasksReply, previous: View | null): View {
  if (isAmoraTasksOff(reply)) return { kind: "off" };
  if (reply.received && reply.ok) {
    const detail = parseAmoraTaskDetail(reply.payload);
    return detail ? { kind: "ready", detail } : { kind: "failed" };
  }
  // 이미 그린 결과는 잠깐의 실패(연결 끊김·429·5xx)로 지우지 않는다. 없어진 일(404)과 풀린 로그인은 바로 알린다.
  const gone = reply.received && (reply.status === 401 || reply.status === 403 || reply.status === 404);
  if (previous?.kind === "ready" && !gone) return previous;
  return { kind: "failed" };
}

/** 맡은 일 하나를 읽는다. 화면이 요청을 멈췄으면 null(그때는 아무것도 바꾸지 않는다). */
async function readTask(taskId: string, signal?: AbortSignal): Promise<AmoraTasksReply | null> {
  const reply = await requestAmoraTasks(amoraTaskApiPath(taskId), { signal });
  return !reply.received && reply.aborted ? null : reply;
}

/** 대화 입력칸에 채울 글을 들고 아모라를 여는 주소. 라운지의 "아모라에게 묻기"와 같은 `?prefill=` 이다. */
function chatPrefillHref(prompt: string): string {
  return weddingPath(`/chat?${new URLSearchParams({ prefill: prompt })}`);
}

/** 표의 출처 표시가 가리키는 출처 줄. 출처 id 는 계약이 `[a-z]{1,3}[0-9]{1,3}` 만 받는다. */
function sourceAnchorId(sourceId: string): string {
  return `amora-task-source-${sourceId}`;
}

/**
 * 아모라가 맡은 일의 결과 화면(`/wedding/amora-tasks/<id>`, 25장 갈래 4). 제목과 단계, 멈춘 까닭, 지금까지 한 일,
 * 같은 기준으로 모은 표와 출처, 다음에 할 일을 보인다.
 *
 * - 표의 값은 서버가 저장한 글 그대로다. 순위나 점수를 만들지 않는다(I14).
 * - 출처는 https 주소만 링크로 둔다. 그 밖은 글자로 둔다(08장 H4).
 * - 다음에 할 일은 대화 입력칸에 글을 채울 뿐 보내지 않는다. 반영은 대화의 확인 카드를 사람이 누를 때만 일어난다
 *   (01장 I1). 옆자리 아모라가 있으면 그 자리에서 열고, 없으면 `?prefill=` 로 대화를 연다(라운지와 같은 길).
 * - 스위치가 꺼졌거나 표가 없으면 아무것도 그리지 않는다. 읽지 못하면 다시 불러오기를 준다.
 * - 찾는 중이거나 정리 중이면 15초마다 다시 읽는다. 계정이 바뀌면 앞 사람의 결과를 곧바로 지운다.
 */
export default function AmoraTaskDetailView({ taskId }: { taskId: string }) {
  const viewer = useAuthStore((state) => state.user?.id ?? null);
  const key = `${viewer ?? ""}:${taskId}`;
  const [state, setState] = useState<{ key: string; view: View } | null>(null);
  const [busy, setBusy] = useState<TaskWrite | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const busyRef = useRef(false);

  const view = state && state.key === key ? state.view : LOADING;

  /** 읽은 응답을 이 계정·이 일의 화면에 건다. 앞 화면의 결과는 같은 열쇠일 때만 이어 쓴다. */
  const settle = useCallback((forKey: string, reply: AmoraTasksReply) => {
    setState((current) => ({
      key: forKey,
      view: nextView(reply, current && current.key === forKey ? current.view : null),
    }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readTask(taskId, controller.signal).then((reply) => {
      if (reply && !controller.signal.aborted) settle(key, reply);
    });
    return () => controller.abort();
  }, [key, settle, taskId]);

  const working = view.kind === "ready" && (view.detail.stage === "searching" || view.detail.stage === "organizing");

  useEffect(() => {
    if (!working) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void readTask(taskId, controller.signal).then((reply) => {
        if (reply && !controller.signal.aborted) settle(key, reply);
      });
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [key, settle, taskId, working]);

  const retry = () => {
    setState({ key, view: LOADING });
    void readTask(taskId).then((reply) => {
      if (reply) settle(key, reply);
    });
  };

  const write = async (action: TaskWrite) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setActionFailed(false);
    const reply = await requestAmoraTasks(amoraTaskApiPath(taskId), { action });
    const code = amoraTaskReplyCode(reply);
    const settled = isAmoraTaskReplyAccepted(reply) || isAmoraTasksOff(reply) || (code !== null && SETTLED_CODES.has(code));
    // 누른 결과는 서버가 말한 지금 상태로만 보인다. 성공해도 실패해도 다시 읽는다.
    const fresh = await readTask(taskId);
    if (fresh) settle(key, fresh);
    busyRef.current = false;
    setBusy(null);
    setActionFailed(!settled);
  };

  if (view.kind === "off") return null;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 text-inv-ink" data-amora-task-detail={view.kind}>
      <Link
        href={BACK_HREF}
        className={cx(
          "inline-flex min-h-11 items-center self-start text-[13px] text-inv-body underline-offset-4 hover:text-inv-ink hover:underline",
          INVITATION_FOCUS_RING,
        )}
      >
        {AMORA_TASK_COPY.back}
      </Link>
      {view.kind === "loading" ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <AmoraOrb size={44} mood="working" />
        </div>
      ) : view.kind === "failed" ? (
        <div className="flex flex-col items-start gap-3">
          <AmoraTaskLine tone="error">{AMORA_TASK_COPY.loadFailed}</AmoraTaskLine>
          <Button variant="outline" size="pill-38" className="px-3.5" onClick={retry}>
            {AMORA_TASK_COPY.retry}
          </Button>
        </div>
      ) : (
        <TaskBody detail={view.detail} busy={busy} actionFailed={actionFailed} onWrite={(action) => void write(action)} />
      )}
    </div>
  );
}

function statusLineOf(detail: AmoraTaskDetail): string | null {
  if (detail.status === "needs_review" && detail.reviewReason) return AMORA_TASK_COPY.reviewReasons[detail.reviewReason];
  if (detail.status === "cancelled") return AMORA_TASK_COPY.cancelled;
  if (detail.status === "expired") return AMORA_TASK_COPY.offerExpired;
  return null;
}

function TaskBody({
  detail,
  busy,
  actionFailed,
  onWrite,
}: {
  detail: AmoraTaskDetail;
  busy: TaskWrite | null;
  actionFailed: boolean;
  onWrite: (action: TaskWrite) => void;
}) {
  const baseId = useId();
  const statusLine = statusLineOf(detail);
  const stepsId = `${baseId}-steps`;

  return (
    <>
      <header className="flex flex-col items-start gap-3">
        <h1 className="text-inv-ink">{detail.title}</h1>
        {detail.stage ? <AmoraTaskStagePill stage={detail.stage} /> : null}
        {statusLine ? <AmoraTaskLine>{statusLine}</AmoraTaskLine> : null}
      </header>
      {detail.resumable || detail.cancellable ? (
        <div className="flex flex-wrap items-center gap-2">
          {detail.resumable ? (
            <Button
              variant="ink"
              size="pill-46"
              weight="bold"
              className="px-[22px]"
              loading={busy === "resume"}
              disabled={busy !== null}
              onClick={() => onWrite("resume")}
            >
              {AMORA_TASK_COPY.resume}
            </Button>
          ) : null}
          {detail.cancellable ? (
            <Button
              variant="outline"
              size="pill-46"
              className="px-[22px]"
              loading={busy === "cancel"}
              disabled={busy !== null}
              onClick={() => onWrite("cancel")}
            >
              {AMORA_TASK_COPY.cancel}
            </Button>
          ) : null}
        </div>
      ) : null}
      {actionFailed ? <AmoraTaskLine tone="error">{ACTION_FAILED}</AmoraTaskLine> : null}
      {detail.steps.length > 0 ? (
        <section aria-labelledby={stepsId} className="flex flex-col gap-2">
          <h2 id={stepsId} className="text-inv-ink">
            {AMORA_TASK_COPY.stepsTitle}
          </h2>
          <ol className="flex list-decimal flex-col gap-2 rounded-[18px] bg-inv-paper-soft py-3.5 pr-4 pl-[34px] text-[14px] leading-[1.55] text-inv-body">
            {detail.steps.map((step, index) => (
              <li key={`${index}:${step.at}`}>{step.label}</li>
            ))}
          </ol>
        </section>
      ) : null}
      {detail.result ? <TaskResult result={detail.result} baseId={baseId} /> : null}
    </>
  );
}

function TaskResult({ result, baseId }: { result: AmoraTaskResult; baseId: string }) {
  const dock = useAmoraDock();
  const numberOf = new Map(result.sources.map((source, index) => [source.id, index + 1]));
  const titleOf = new Map(result.sources.map((source) => [source.id, source.title]));
  const hasMarkers = result.rows.some((row) => row.sourceIds.length > 0);
  const tableId = `${baseId}-table`;
  const sourcesId = `${baseId}-sources`;
  const nextId = `${baseId}-next`;

  return (
    <>
      {result.summary ? <p className="text-[15px] leading-[1.7] text-inv-body">{result.summary}</p> : null}

      {result.rows.length > 0 ? (
        <section aria-labelledby={tableId} className="flex flex-col gap-2" data-amora-task-table>
          <h2 id={tableId} className="text-inv-ink">
            {AMORA_TASK_COPY.resultTableTitle}
          </h2>
          <div className="overflow-x-auto rounded-[18px] bg-inv-white shadow-[inset_0_0_0_1px_#EEEAE6]">
            <table className="w-full min-w-[32rem] border-collapse text-left text-[13px] leading-[1.5]">
              <thead className="bg-inv-paper-soft text-inv-muted">
                <tr>
                  {result.columns.map((column, index) => (
                    <th key={`${index}:${column}`} scope="col" className="px-3 py-2.5 font-medium">
                      {column}
                    </th>
                  ))}
                  {hasMarkers ? (
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      {AMORA_TASK_COPY.resultSourcesTitle}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-inv-row-line align-top">
                    {row.cells.map((cell, cellIndex) =>
                      cellIndex === 0 ? (
                        <th key={cellIndex} scope="row" className="px-3 py-2.5 font-medium text-inv-ink">
                          {cell}
                        </th>
                      ) : (
                        <td key={cellIndex} className="px-3 py-2.5 text-inv-body">
                          {cell}
                        </td>
                      ),
                    )}
                    {hasMarkers ? (
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {row.sourceIds.map((sourceId) => (
                            <a
                              key={sourceId}
                              href={`#${sourceAnchorId(sourceId)}`}
                              aria-label={titleOf.get(sourceId)}
                              className={cx(
                                "inline-flex size-6 items-center justify-center rounded-full bg-inv-stone text-[11px] text-inv-ink",
                                INVITATION_FOCUS_RING,
                              )}
                              data-amora-task-marker={sourceId}
                            >
                              {numberOf.get(sourceId)}
                            </a>
                          ))}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] leading-[1.6] text-inv-muted">{AMORA_TASK_COPY.resultTableNote}</p>
        </section>
      ) : null}

      {result.sources.length > 0 ? (
        <section aria-labelledby={sourcesId} className="flex flex-col gap-2">
          <h2 id={sourcesId} className="text-inv-ink">
            {AMORA_TASK_COPY.resultSourcesTitle}
          </h2>
          <ol className="flex flex-col gap-2.5">
            {result.sources.map((source, index) => {
              const url = safeAmoraTaskSourceUrl(source.url);
              return (
                <li
                  key={source.id}
                  id={sourceAnchorId(source.id)}
                  className="flex gap-2.5 text-[14px] leading-[1.55]"
                  data-amora-task-source={source.id}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-inv-stone text-[11px] text-inv-ink"
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cx("break-words text-inv-ink underline underline-offset-4 hover:text-inv-muted", INVITATION_FOCUS_RING)}
                      >
                        {source.title}
                      </a>
                    ) : (
                      <span className="break-words text-inv-ink">{source.title}</span>
                    )}
                    {source.checkedOn ? (
                      <span className="text-[12px] text-inv-muted">{AMORA_TASK_COPY.resultCheckedOn(source.checkedOn)}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {result.nextActions.length > 0 ? (
        <section aria-labelledby={nextId} className="flex flex-col gap-2">
          <h2 id={nextId} className="text-inv-ink">
            {AMORA_TASK_COPY.resultNextTitle}
          </h2>
          <p className="text-[13px] leading-[1.6] text-inv-muted">{AMORA_TASK_COPY.resultNextNote}</p>
          <ul className="flex flex-col gap-2">
            {result.nextActions.map((action, index) => {
              const labelId = `${nextId}-${index}`;
              return (
                <li
                  key={`${index}:${action.label}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-inv-white px-4 py-3 shadow-[inset_0_0_0_1px_#EEEAE6]"
                  data-amora-task-next={index}
                >
                  <span id={labelId} className="min-w-0 flex-1 text-[14px] font-medium text-inv-ink">
                    {action.label}
                  </span>
                  <Button
                    href={chatPrefillHref(action.prompt)}
                    variant="outline"
                    size="pill-40"
                    className="px-4"
                    aria-describedby={labelId}
                    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                      openAmoraInsteadOfLink(event, dock, { prefill: action.prompt });
                    }}
                  >
                    {AMORA_TASK_COPY.resultNextButton}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
