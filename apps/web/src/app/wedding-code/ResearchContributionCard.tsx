"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";

import Button from "@/components/ui/Button";
import { CONTACT } from "@/lib/constants/contact";
import {
  WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  WEDDING_CODE_RESEARCH_MIN_AGE,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  createWeddingCodeResearchReceipt,
  isWeddingCodeResearchAnswerCode,
  isWeddingCodeResearchSceneVersion,
  type WeddingCodeResearchSceneVersion,
} from "@/lib/weddingCode/contribution/contract";

const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";

type Stage =
  | "idle"
  | "sending"
  /** 서버가 저장했다고 답했다. */
  | "sent"
  /** 응답을 못 받았다 — 저장됐을 수도, 아닐 수도 있다. */
  | "uncertain"
  /** 서버가 저장하지 않았다고 답했다. */
  | "rejected"
  | "deleting"
  | "deleted";

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
 * 내 답을 이름·계정 없이 보태기 — **선택**이다.
 *
 * 연구 명세(`docs/wedding-code/56` §8.1)의 수집 전 조건을 화면에서 그대로 지킨다:
 * 기본값이 꺼진 동의 체크, 성인 확인, 목적·항목·보유 기간·제3자 제공 여부, 동의하지
 * 않아도 불이익이 없다는 안내, 담당 연락처와 삭제 방법. 로그인·마케팅 동의와 묶지 않는다.
 *
 * 보내는 것은 **이 방문자가 이번에 직접 고른 답**뿐이다. 링크로 받은 상대의 답은 보내지 않는다.
 *
 * ## 삭제 코드를 브라우저가 먼저 만드는 이유
 *
 * 서버가 코드를 만들어 응답에 실어 주면, 저장은 됐는데 응답이 끊긴 사람은 코드를 영영
 * 못 받는다 — 지울 수 없는 답이 남고, 다시 누르면 두 번 저장된다(2026-09-16 적대 검토).
 * 카드가 뜰 때 코드를 만들어 두면 끊겨도 같은 코드로 다시 보내 한 번만 저장되고, 그
 * 코드로 지울 수도 있다. 코드는 메모리에만 두고 브라우저 저장소·URL·분석에 싣지 않는다.
 *
 * 보냈다는 이벤트는 분석으로 보내지 않는다. 보낸 시각이 분석 기록과 맞춰지면 이름 없는
 * 답이 한 기기에 이어질 수 있어서다. 몇 명이 보탰는지는 테이블에서 센다.
 */
export default function ResearchContributionCard({
  answerCode,
  sceneVersion,
}: {
  answerCode: string;
  /**
   * 이 답을 만든 문항 판. **화면이 실제로 푼 판을 그대로** 받는다. 예전에는 카드가 상수
   * 하나(v0.8)를 보냈는데, 받는 판이 둘이 되면 v0.9 답이 v0.8 이름표를 달고 저장된다 —
   * DB 는 둘 다 받으니 아무도 모른다.
   */
  sceneVersion: string;
}) {
  const [adult, setAdult] = useState(false);
  const [consented, setConsented] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [receipt] = useState(createWeddingCodeResearchReceipt);
  const [copied, setCopied] = useState(false);
  const adultId = useId();
  const consentId = useId();

  if (!isWeddingCodeResearchAnswerCode(answerCode)) return null;
  if (!isWeddingCodeResearchSceneVersion(sceneVersion)) return null;
  const acceptedSceneVersion: WeddingCodeResearchSceneVersion = sceneVersion;

  async function contribute() {
    setStage("sending");
    setMessage("");
    try {
      const { ok, data } = await postJson("/api/wedding-code/research-contribution", {
        sceneVersion: acceptedSceneVersion,
        answerCode,
        consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
        adultConfirmed: adult,
        consented,
        receipt,
      });
      if (ok) {
        setStage("sent");
        return;
      }
      setStage("rejected");
      setMessage(typeof data.error === "string" && !data.error.startsWith("wedding_code_")
        ? data.error
        : "지금은 답을 보태지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } catch {
      setStage("uncertain");
    }
  }

  async function deleteNow(from: "sent" | "uncertain") {
    setStage("deleting");
    setMessage("");
    try {
      const { ok } = await postJson("/api/wedding-code/research-contribution/delete", { receipt });
      if (ok) {
        setStage("deleted");
        return;
      }
    } catch {
      // 아래에서 같은 화면으로 돌아가 실패를 알린다.
    }
    setStage(from);
    setMessage("지금은 지우지 못했어요. 삭제 코드를 복사해 두고 잠시 뒤 다시 시도해 주세요.");
  }

  const copyButton = (
    <Button
      variant="primary"
      size="lg"
      className="flex-1"
      onClick={() => {
        void navigator.clipboard?.writeText?.(receipt).then(() => setCopied(true), () => setCopied(false));
      }}
    >
      {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
      {copied ? "복사했어요" : "삭제 코드 복사하기"}
    </Button>
  );

  const receiptField = (
    <input
      aria-label="삭제 코드"
      readOnly
      value={receipt}
      onFocus={(event) => event.currentTarget.select()}
      className="mt-3 min-h-12 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-3 font-mono text-[13px]"
    />
  );

  if (stage === "deleted") {
    return (
      <section className={`${surface} mt-5 px-5 py-5 sm:px-8`} data-research-contribution="deleted" role="status">
        <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">보낸 답을 지웠어요</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">이 삭제 코드로 저장된 답이 있었다면 더 이상 연구 자료에 남지 않아요.</p>
      </section>
    );
  }

  if (stage === "sent" || stage === "uncertain" || (stage === "deleting")) {
    const uncertain = stage === "uncertain";
    return (
      <section className={`${surface} mt-5 px-5 py-5 sm:px-8`} data-research-contribution={uncertain ? "uncertain" : "sent"} role="status">
        <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">
          {uncertain ? "보냈는지 확인하지 못했어요" : "답을 보탰어요. 고마워요"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
          {uncertain
            ? "연결이 끊겨 저장됐는지 알 수 없어요. 다시 보내도 같은 삭제 코드라 한 번만 저장돼요. 저장됐을 경우를 대비해 아래 코드를 복사해 두세요."
            : "아래 삭제 코드는 지금만 보여드려요. 이름이나 계정을 받지 않아서, 코드를 잃어버리면 누가 보낸 답인지 알 수 없어 찾아 지울 수 없어요."}
          {` ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 코드가 없어도 자동으로 지워져요.`}
        </p>
        {receiptField}
        {message ? <p role="alert" className="mt-3 text-sm text-[var(--hb-text-body)]">{message}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {copyButton}
          {uncertain ? (
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => void contribute()}>
              다시 보내기
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            loading={stage === "deleting"}
            onClick={() => void deleteNow(uncertain ? "uncertain" : "sent")}
          >
            {stage === "deleting" ? "지우는 중..." : "지금 바로 지우기"}
          </Button>
        </div>
      </section>
    );
  }

  const sending = stage === "sending";
  return (
    <section className={`${surface} mt-5 overflow-hidden`} data-research-contribution="form">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">내 답을 이름·계정 없이 보태기 (선택)</h2>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          장면과 선택지가 읽기 쉬운지, 한쪽 답으로 쏠리지 않는지 고치는 데 써요. 성격·궁합·결혼 결과를 판정하는 연구가 아니에요.
        </p>
      </div>
      <div className="px-5 py-5 sm:px-8">
        <ul className="space-y-2 text-[13px] leading-[1.65] text-[var(--hb-text-body)]">
          <li><b className="font-semibold text-[var(--hb-text-strong)]">보내는 것:</b> 문항 판, 장면마다 고른 답 기호(건너뛴 장면 포함), 동의 문구 판, 보낸 날짜</li>
          <li><b className="font-semibold text-[var(--hb-text-strong)]">함께 보관하지 않는 것:</b> 이름·연락처·계정·IP 주소·공유 링크·상대의 답</li>
          <li><b className="font-semibold text-[var(--hb-text-strong)]">보관:</b> 보낸 날부터 {WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워요. 다른 회사에 제공하지 않아요.</li>
          <li><b className="font-semibold text-[var(--hb-text-strong)]">지우기:</b> 보낼 때 보여주는 삭제 코드로 언제든 지울 수 있어요. 문의는 <a className="underline underline-offset-4" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
          <li>보태지 않아도 웨딩코드를 쓰는 데 아무 차이가 없어요.</li>
        </ul>

        <div className="mt-4 space-y-2">
          <label htmlFor={adultId} className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
            <input id={adultId} type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            만 {WEDDING_CODE_RESEARCH_MIN_AGE}세 이상이에요
          </label>
          <label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
            <input id={consentId} type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            위 내용을 읽었고, 내 답을 이름·계정 없이 보태는 데 동의해요
          </label>
        </div>

        {stage === "rejected" ? <p role="alert" className="mt-3 text-sm text-[var(--hb-text-body)]">{message}</p> : null}

        <Button
          variant="secondary"
          size="lg"
          fullWidth
          className="mt-4"
          disabled={!adult || !consented}
          loading={sending}
          onClick={() => void contribute()}
        >
          {sending ? "보내는 중..." : "내 답 보태기"}
        </Button>
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
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        className="mt-3"
        disabled={receipt.trim() === ""}
        loading={state === "sending"}
        onClick={() => void submit()}
      >
        {state === "sending" ? "지우는 중..." : "이 코드로 지우기"}
      </Button>
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
