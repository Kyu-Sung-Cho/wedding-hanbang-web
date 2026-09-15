"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";

import { captureWeddingCodeEvent } from "@/lib/analytics";
import { CONTACT } from "@/lib/constants/contact";
import {
  WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  WEDDING_CODE_RESEARCH_MIN_AGE,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  WEDDING_CODE_RESEARCH_SCENE_VERSION,
  isWeddingCodeResearchAnswerCode,
} from "@/lib/weddingCode/contribution/contract";

const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";
const primaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-action)] px-6"
  + " text-[15px] font-semibold text-white transition-colors duration-150 ease-out"
  + " hover:bg-[var(--hb-action-hover)] focus-visible:outline-none focus-visible:ring-2"
  + " focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2"
  + " disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] border"
  + " border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[var(--hb-text-strong)]"
  + " transition-colors duration-150 ease-out hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none"
  + " focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2"
  + " disabled:cursor-not-allowed disabled:opacity-40";

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; receipt: string }
  | { kind: "deleted" }
  | { kind: "error"; message: string };

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data: typeof data === "object" && data ? data as Record<string, unknown> : {} };
}

/**
 * 내 답을 익명으로 보태기 — **선택**이다.
 *
 * 연구 명세(`docs/wedding-code/56` §8.1)의 수집 전 조건을 화면에서 그대로 지킨다:
 * 기본값이 꺼진 동의 체크, 성인 확인, 목적·항목·보유 기간·제3자 제공 여부, 동의하지
 * 않아도 불이익이 없다는 안내, 담당 연락처와 삭제 방법. 로그인·마케팅 동의와 묶지 않는다.
 *
 * 보내는 것은 **이 방문자가 이번에 직접 고른 답**뿐이다. 링크로 받은 상대의 답은 보내지 않는다.
 * 삭제 코드는 브라우저 저장소에 두지 않는다 — 새로고침하면 사라지고, 보관은 본인이 한다.
 */
export default function ResearchContributionCard({ answerCode }: { answerCode: string }) {
  const [adult, setAdult] = useState(false);
  const [consented, setConsented] = useState(false);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const adultId = useId();
  const consentId = useId();

  if (!isWeddingCodeResearchAnswerCode(answerCode)) return null;

  async function contribute() {
    setState({ kind: "sending" });
    try {
      const { ok, data } = await postJson("/api/wedding-code/research-contribution", {
        sceneVersion: WEDDING_CODE_RESEARCH_SCENE_VERSION,
        answerCode,
        consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
        adultConfirmed: adult,
        consented,
      });
      if (ok && typeof data.receipt === "string") {
        setState({ kind: "sent", receipt: data.receipt });
        captureWeddingCodeEvent("wedding_code_research_contributed", {
          version: WEDDING_CODE_RESEARCH_SCENE_VERSION,
        });
        return;
      }
      setState({
        kind: "error",
        message: typeof data.error === "string" && !data.error.startsWith("wedding_code_")
          ? data.error
          : "지금은 답을 보태지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      });
    } catch {
      setState({ kind: "error", message: "연결이 끊겨 보내지 못했어요. 잠시 뒤 다시 시도해 주세요." });
    }
  }

  async function deleteNow(receipt: string) {
    setState({ kind: "sending" });
    try {
      const { ok } = await postJson("/api/wedding-code/research-contribution/delete", { receipt });
      setState(ok
        ? { kind: "deleted" }
        : { kind: "sent", receipt });
    } catch {
      setState({ kind: "sent", receipt });
    }
  }

  if (state.kind === "deleted") {
    return (
      <section className={`${surface} mt-5 px-5 py-5 sm:px-8`} data-research-contribution="deleted" role="status">
        <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">보낸 답을 지웠어요</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">이 답은 더 이상 연구 자료에 남지 않아요.</p>
      </section>
    );
  }

  if (state.kind === "sent") {
    return (
      <section className={`${surface} mt-5 px-5 py-5 sm:px-8`} data-research-contribution="sent" role="status">
        <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">답을 보탰어요. 고마워요</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
          아래 삭제 코드는 <b className="font-semibold text-[var(--hb-text-strong)]">지금 한 번만</b> 보여드려요.
          이름이나 계정을 받지 않아서, 코드를 잃어버리면 누가 보낸 답인지 알 수 없어 찾아 지울 수 없어요.
          {` ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 코드가 없어도 자동으로 지워져요.`}
        </p>
        <input
          aria-label="삭제 코드"
          readOnly
          value={state.receipt}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-3 min-h-12 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-3 font-mono text-[13px]"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={`${primaryButton} flex-1`}
            onClick={() => {
              void navigator.clipboard?.writeText?.(state.receipt).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
            {copied ? "복사했어요" : "삭제 코드 복사하기"}
          </button>
          <button type="button" className={`${secondaryButton} flex-1`} onClick={() => void deleteNow(state.receipt)}>
            지금 바로 지우기
          </button>
        </div>
      </section>
    );
  }

  const sending = state.kind === "sending";
  return (
    <section className={`${surface} mt-5 overflow-hidden`} data-research-contribution="form">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">내 답을 익명으로 보태기 (선택)</h2>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          장면과 선택지가 읽기 쉬운지, 한쪽 답으로 쏠리지 않는지 고치는 데 써요. 성격·궁합·결혼 결과를 판정하는 연구가 아니에요.
        </p>
      </div>
      <div className="px-5 py-5 sm:px-8">
        <ul className="space-y-2 text-[13px] leading-[1.65] text-[var(--hb-text-body)]">
          <li><b className="font-semibold text-[var(--hb-text-strong)]">보내는 것:</b> 문항 판, 장면마다 고른 답 기호(건너뛴 장면 포함), 동의 문구 판, 보낸 시각</li>
          <li><b className="font-semibold text-[var(--hb-text-strong)]">받지 않는 것:</b> 이름·연락처·계정·IP 주소·공유 링크·상대의 답</li>
          <li><b className="font-semibold text-[var(--hb-text-strong)]">보관:</b> 보낸 날부터 {WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워요. 다른 회사에 제공하지 않아요.</li>
          <li><b className="font-semibold text-[var(--hb-text-strong)]">지우기:</b> 보낸 직후 한 번 보여주는 삭제 코드로 언제든 지울 수 있어요. 문의는 <a className="underline underline-offset-4" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
          <li>보태지 않아도 웨딩코드를 쓰는 데 아무 차이가 없어요.</li>
        </ul>

        <div className="mt-4 space-y-2">
          <label htmlFor={adultId} className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
            <input id={adultId} type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            만 {WEDDING_CODE_RESEARCH_MIN_AGE}세 이상이에요
          </label>
          <label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
            <input id={consentId} type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            위 내용을 읽었고, 내 답을 익명으로 보태는 데 동의해요
          </label>
        </div>

        {state.kind === "error" ? <p role="alert" className="mt-3 text-sm text-[var(--hb-text-body)]">{state.message}</p> : null}

        <button
          type="button"
          disabled={!adult || !consented || sending}
          aria-busy={sending || undefined}
          onClick={() => void contribute()}
          className={`${secondaryButton} mt-4 w-full`}
        >
          {sending ? "보내는 중..." : "내 답 보태기"}
        </button>
      </div>
    </section>
  );
}

/** 나중에 삭제 코드로 지우는 자리. 코드를 받은 방문과 다른 날·다른 기기에서도 쓸 수 있다. */
export function ResearchContributionDeleteForm() {
  const [receipt, setReceipt] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "deleted" | "invalid" | "failed">("idle");
  const inputId = useId();

  async function submit() {
    setState("sending");
    try {
      const { ok, data } = await postJson("/api/wedding-code/research-contribution/delete", { receipt: receipt.trim() });
      if (ok) {
        setReceipt("");
        setState("deleted");
      } else {
        setState(typeof data.error === "string" && data.error.includes("삭제 코드 모양") ? "invalid" : "failed");
      }
    } catch {
      setState("failed");
    }
  }

  return (
    <details className="border-t border-[var(--hb-hairline)] px-5 py-4 sm:px-8" data-research-delete="">
      <summary className="cursor-pointer py-2 text-sm font-semibold text-[var(--hb-text-strong)]">보탠 답 지우기</summary>
      <label htmlFor={inputId} className="mt-2 block text-sm leading-relaxed text-[var(--hb-text-body)]">답을 보낼 때 받은 삭제 코드(wc_del_로 시작)를 붙여넣어 주세요.</label>
      <input
        id={inputId}
        value={receipt}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => { setReceipt(event.target.value); setState("idle"); }}
        className="mt-2 min-h-12 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-3 font-mono text-[13px]"
      />
      <button
        type="button"
        disabled={receipt.trim() === "" || state === "sending"}
        onClick={() => void submit()}
        className={`${secondaryButton} mt-3 w-full`}
      >
        {state === "sending" ? "지우는 중..." : "이 코드로 지우기"}
      </button>
      <p role="status" className="mt-2 text-sm text-[var(--hb-text-body)]">
        {state === "deleted"
          ? "처리했어요. 이 코드로 보낸 답이 있었다면 지워졌어요."
          : state === "invalid"
            ? "삭제 코드 모양이 맞지 않아요. 복사한 코드를 그대로 붙여넣어 주세요."
            : state === "failed"
              ? "지금은 지우지 못했어요. 잠시 뒤 다시 시도해 주세요."
              : ""}
      </p>
    </details>
  );
}
