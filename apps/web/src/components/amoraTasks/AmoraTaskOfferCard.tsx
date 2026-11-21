"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AMORA_TASK_COPY,
  amoraTaskWebPath,
  parseAmoraTaskDetail,
  parseAmoraTaskOffer,
  type AmoraTaskOffer,
} from "@hanbang/shared/amora-tasks";

import Button from "@/components/ui/Button";
import type { ToolExecutionResult } from "@/types/database.types";

import {
  AmoraTaskLine,
  amoraTaskApiPath,
  amoraTaskReplyCode,
  isAmoraTaskReplyAccepted,
  isAmoraTasksOff,
  requestAmoraTasks,
  type AmoraTasksReply,
} from "./amoraTaskParts";

/**
 * - `checking`: 처음 그릴 때 지금 상태를 읽는 중. 단추를 아직 두지 않는다.
 * - `offered`·`starting`·`failed`: 맡기기 단추가 있다(`failed` 는 다시 누를 수 있다).
 * - `started`·`expired`·`unavailable`·`limit`: 단추 없이 한 줄로 말한다(`unavailable` 은 문지기가 준 문장이 있으면 그 문장).
 * - `hidden`: 스위치가 꺼졌거나 표가 없다. 아무것도 그리지 않는다.
 */
type Phase = "checking" | "offered" | "starting" | "failed" | "started" | "expired" | "unavailable" | "limit" | "hidden";

/** 처음 읽은 지금 상태. 읽지 못하면 맡기기 단추를 둔다(누르면 서버가 다시 판단한다). */
function phaseFromDetail(reply: AmoraTasksReply): Phase {
  if (isAmoraTasksOff(reply)) return "hidden";
  if (!reply.received) return "offered";
  // 이 커플의 카드인데 서버에 없다. 닫힌 카드로 말하고 다시 부탁하게 한다.
  if (reply.status === 404) return "expired";
  if (!reply.ok) return "offered";
  const detail = parseAmoraTaskDetail(reply.payload);
  if (!detail) return "offered";
  if (detail.status === "offered") return "offered";
  if (detail.status === "expired" || detail.status === "cancelled") return "expired";
  return "started";
}

/** 맡기기를 누른 결과. 서버가 받아들였을 때만 맡았다고 말한다. */
function phaseFromStart(reply: AmoraTasksReply): Phase {
  if (isAmoraTasksOff(reply)) return "hidden";
  if (isAmoraTaskReplyAccepted(reply)) return "started";
  switch (amoraTaskReplyCode(reply)) {
    case "daily_task_limit":
      return "limit";
    case "offer_expired":
    case "offer_closed":
      return "expired";
    case "gate_blocked":
      return "unavailable";
    default:
      return "failed";
  }
}

// 문지기 문장의 한도. 서버(`lib/amoraTasks/adapters.ts`)도 300자에서 자른다.
const GATE_REPLY_MAX_LENGTH = 300;
// 제어·서식·줄 구분·문단 구분 문자. 하나라도 들었으면 그 문장은 쓰지 않는다(보이지 않는 글자가 문장을 다르게 보이게 한다).
const GATE_REPLY_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * 문지기가 맡기기를 막았을 때(`gate_blocked`) 서버가 함께 준 문장(`reply`). 문지기 담당이 정한 대로 다듬거나 고치지 않고
 * 그대로 쓴다. 문장이 없거나 비었거나 문자열이 아니면, 300자를 넘거나 제어·서식 문자가 들었으면 null 이고 카드는
 * `offerUnavailable` 로 말한다. 문지기가 막은 답이 아니면 문장이 있어도 null 이다.
 */
function gateReplyFromStart(reply: AmoraTasksReply): string | null {
  if (!reply.received || amoraTaskReplyCode(reply) !== "gate_blocked") return null;
  // 결과 코드를 읽었으면 본문은 객체다(`amoraTaskReplyCode`).
  const sentence = (reply.payload as { reply?: unknown }).reply;
  if (typeof sentence !== "string" || sentence.trim() === "") return null;
  if (sentence.length > GATE_REPLY_MAX_LENGTH || GATE_REPLY_UNSAFE.test(sentence)) return null;
  return sentence;
}

/**
 * 대화의 시작 카드 "이 일을 맡을게요"(25장 2절, 허락 규칙 "물어보고 · 카드 한 번"). 도구 결과
 * `offer_amora_task` 를 `ActionCard` 가 이리로 넘긴다. 카드를 읽지 못하면(실패한 도구 결과도) 아무것도 그리지 않는다.
 *
 * 맡은 일은 사람이 맡기기를 눌러야 시작한다(`POST /api/amora/tasks/<id>` 의 `start`). 카드는 처음 그릴 때 지금 상태를
 * 한 번 읽어, 이미 맡긴 일이면 진행 보기를 두고 닫힌 카드면 닫혔다고 말한다. 대화 기록에서 같은 카드가 다시
 * 그려져도 단추가 되살아나지 않는다.
 */
export default function AmoraTaskOfferCard({ result }: { result: ToolExecutionResult }) {
  const offer = result.success ? parseAmoraTaskOffer(result.toolOutput) : null;
  if (!offer) return null;
  return <OfferCard key={offer.taskId} offer={offer} />;
}

function OfferCard({ offer }: { offer: AmoraTaskOffer }) {
  const headingId = useId();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>("checking");
  // 문지기가 막으며 준 문장(확인을 거친 것만). 맡을 수 없는 모습(`unavailable`)에서 계약 문장 대신 그대로 보인다.
  const [gateReply, setGateReply] = useState<string | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void requestAmoraTasks(amoraTaskApiPath(offer.taskId), { signal: controller.signal }).then((reply) => {
      if (controller.signal.aborted) return;
      setPhase((current) => (current === "checking" ? phaseFromDetail(reply) : current));
    });
    return () => controller.abort();
  }, [offer.taskId]);

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setPhase("starting");
    const reply = await requestAmoraTasks(amoraTaskApiPath(offer.taskId), { action: "start" });
    startingRef.current = false;
    setGateReply(gateReplyFromStart(reply));
    setPhase(phaseFromStart(reply));
  };

  if (phase === "hidden") return null;
  const progressHref = amoraTaskWebPath(offer.taskId);
  const canStart = phase === "offered" || phase === "starting" || phase === "failed";

  return (
    <div className="my-1.5 ml-11 flex justify-start" data-amora-task-offer={phase}>
      <section
        aria-labelledby={`${headingId} ${titleId}`}
        className="flex w-full max-w-[24rem] flex-col gap-3 rounded-[22px] bg-inv-paper-soft p-4 text-inv-ink shadow-[inset_0_0_0_1px_#EEEAE6]"
      >
        <div className="flex flex-col gap-1">
          <h3 id={headingId} className="font-inv-serif text-[16px] font-bold">
            {AMORA_TASK_COPY.offerTitle}
          </h3>
          <p id={titleId} className="text-[15px] font-medium leading-[1.45]">
            {offer.title}
          </p>
        </div>
        {offer.plan.length > 0 ? (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-[1.55] text-inv-body">
            {offer.plan.map((line, index) => (
              <li key={`${index}:${line}`}>{line}</li>
            ))}
          </ol>
        ) : null}
        {canStart ? (
          <>
            <p className="text-[13px] leading-[1.6] text-inv-muted">{AMORA_TASK_COPY.offerBody}</p>
            {phase === "failed" ? <AmoraTaskLine tone="error">{AMORA_TASK_COPY.startFailed}</AmoraTaskLine> : null}
            <Button
              variant="ink"
              size="pill-46"
              weight="bold"
              className="self-start px-[22px]"
              loading={phase === "starting"}
              onClick={() => void start()}
            >
              {phase === "starting" ? AMORA_TASK_COPY.offerStarting : AMORA_TASK_COPY.offerStart}
            </Button>
          </>
        ) : null}
        {phase === "started" ? (
          <>
            <AmoraTaskLine>{AMORA_TASK_COPY.offerStarted}</AmoraTaskLine>
            {progressHref ? (
              <Button href={progressHref} variant="outline" size="pill-40" className="self-start px-4">
                {AMORA_TASK_COPY.offerOpen}
              </Button>
            ) : null}
          </>
        ) : null}
        {phase === "expired" ? <AmoraTaskLine>{AMORA_TASK_COPY.offerExpired}</AmoraTaskLine> : null}
        {phase === "unavailable" ? <AmoraTaskLine>{gateReply ?? AMORA_TASK_COPY.offerUnavailable}</AmoraTaskLine> : null}
        {phase === "limit" ? <AmoraTaskLine>{AMORA_TASK_COPY.dailyTaskLimit}</AmoraTaskLine> : null}
      </section>
    </div>
  );
}
