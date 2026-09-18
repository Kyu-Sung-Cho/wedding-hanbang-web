"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";

import Button from "@/components/ui/Button";
import { CONTACT } from "@/lib/constants/contact";
import {
  WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  WEDDING_CODE_RESEARCH_MIN_AGE,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS,
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
  /**
   * 어느 화면에서 「지금 바로 지우기」를 눌렀나. 지우는 동안에도 그 화면의 제목을 유지한다 —
   * 예전에는 「보냈는지 확인하지 못했어요」에서 눌러도 지우는 동안 「답을 보탰어요」로 바뀌어,
   * 확인하지 못한 저장을 확인한 것처럼 말했다.
   */
  const [deleteFrom, setDeleteFrom] = useState<"sent" | "uncertain">("sent");
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
      // 서버 문장 중 카드 말투(해요체)인 것만 그대로 보여준다. 「잘못된 요청 출처입니다.」
      // 같은 합니다체·내부 코드는 사람에게 도움이 안 되니 같은 뜻의 안내로 덮는다.
      // (「~습니다」만 보면 「~입니다」가 빠진다 — 첫 구현이 그랬고 테스트가 잡았다.)
      setMessage(typeof data.error === "string"
        && !data.error.startsWith("wedding_code_")
        && !/[습입]니다/.test(data.error)
        ? data.error
        : "지금은 답을 보태지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } catch {
      setStage("uncertain");
    }
  }

  async function deleteNow(from: "sent" | "uncertain") {
    setDeleteFrom(from);
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
        <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">지우기를 마쳤어요</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
          이 코드로 저장된 답이 있었다면 이제 연구 자료에 남아 있지 않아요. 같은 코드로 다시 저장되지 않도록, 원래 코드를 알아낼 수 없게 바꾼 값과 지운 날짜만 {WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS}일 동안 남겨 둬요.
        </p>
      </section>
    );
  }

  if (stage === "sent" || stage === "uncertain" || stage === "deleting") {
    const uncertain = stage === "uncertain" || (stage === "deleting" && deleteFrom === "uncertain");
    return (
      <section className={`${surface} mt-5 px-5 py-5 sm:px-8`} data-research-contribution={uncertain ? "uncertain" : "sent"} role="status">
        <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">
          {uncertain ? "보냈는지 확인하지 못했어요" : "답이 저장됐어요. 고마워요"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
          {uncertain
            ? `연결이 끊겨서 답이 저장됐는지 알 수 없어요. 다시 보내기를 눌러도 두 번 저장되지는 않아요. 저장됐을 수도 있으니 아래 삭제 코드는 꼭 복사해 두세요. 코드가 없어도 ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워져요.`
            : `아래 삭제 코드는 이 화면을 떠나거나 새로고침하면 다시 볼 수 없어요. 잃어버리면 저희도 이 답을 찾아 지울 수 없으니 꼭 복사해 두세요. 코드가 없어도 ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워져요.`}
        </p>
        {receiptField}
        {message ? <p role="alert" className="mt-3 text-sm text-[var(--hb-text-body)]">{message}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {copyButton}
          {stage === "uncertain" ? (
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
  const term = "font-semibold text-[var(--hb-text-strong)]";
  return (
    <section className={`${surface} mt-5 overflow-hidden`} data-research-contribution="form">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">질문을 고치는 데 내 답을 보태 주실래요? (선택)</h2>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          아래 &lsquo;내 답 보태기&rsquo;를 누르면 고른 답을 저희가 받아요. 헷갈리는 장면이나 거의 모두 같은 답을 고르는 장면을 찾아서 질문을 고치는 데만 써요. 사람을 평가하거나 두 사람이 잘 어울리는지 따지는 데는 쓰지 않아요.
        </p>
      </div>
      <div className="px-5 py-5 sm:px-8">
        {/*
          쉬운 말로 풀었지만 처리방침 제1조·제3조와 뜻이 같아야 한다.
          「어느 버전 질문」= 문항 판, 「몇 번째를 골랐는지」= 답 기호(선택지 순서가 A→D 로
          고정이라 같은 뜻이다 — 순서를 섞게 되면 이 줄도 고친다), 「어느 안내문」= 동의 문구 판.
          코드를 잃어버리면 지울 수 없다는 한계는 **동의 체크보다 위에** 둔다(연구 명세 §9.1.7).
        */}
        <ul className="space-y-2 text-[13px] leading-[1.65] text-[var(--hb-text-body)]">
          <li><b className={term}>저장하는 것:</b> 장면마다 몇 번째 답을 골랐는지(건너뛴 장면은 건너뛰었다는 것만), 어느 버전의 질문이었는지, 어떤 안내문을 보고 동의했는지, 보낸 날짜</li>
          <li>나중에 맞는 삭제 코드인지 확인하려고, 원래 코드를 알아낼 수 없는 값(해시)으로 바꿔서 함께 저장해요. 코드 그대로는 저장하지 않아요.</li>
          <li><b className={term}>답과 함께 저장하지 않는 것:</b> 이름, 연락처, 계정, IP 주소, 공유 링크, 상대의 답</li>
          <li><b className={term}>보관 기간:</b> 보낸 날부터 {WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워요.</li>
          <li><b className={term}>제공:</b> 다른 회사에는 넘기지 않아요.</li>
          <li><b className={term}>지우고 싶을 때:</b> 보내면 이 자리에 삭제 코드가 한 번만 나와요. 그 코드가 있으면 언제든 지울 수 있어요. 이 화면을 떠난 뒤라면 웨딩코드 첫 화면의 &lsquo;전에 보낸 답 지우기&rsquo;에 코드를 넣으면 돼요.</li>
          <li><b className={term}>코드를 잃어버리면:</b> 이름도 계정도 받지 않아서, 어느 답이 내 것인지 저희도 찾을 수 없고 지워 드릴 수도 없어요. 그 답은 {WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나 자동으로 지워질 때까지 남아요.</li>
          <li><b className={term}>문의:</b> <a className="underline underline-offset-4" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
          <li>보태지 않아도 웨딩코드를 쓰는 데 아무 차이가 없어요.</li>
        </ul>
        <a href="/privacy" className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">
          개인정보 처리방침에서 자세히 보기
        </a>

        <div className="mt-2 space-y-2">
          <label htmlFor={adultId} className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
            <input id={adultId} type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            만 {WEDDING_CODE_RESEARCH_MIN_AGE}세 이상이에요
          </label>
          <label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
            <input id={consentId} type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            위 내용을 읽었고, 질문을 고치는 데 쓰도록 내 답을 이름·계정 없이 보내고 {WEDDING_CODE_RESEARCH_RETENTION_DAYS}일 동안 보관하는 데 동의해요
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
      <summary className="cursor-pointer py-2 text-sm font-semibold text-[var(--hb-text-strong)]">전에 보낸 답 지우기</summary>
      <label htmlFor={inputId} className="mt-2 block text-sm leading-relaxed text-[var(--hb-text-body)]">&lsquo;내 답 보태기&rsquo;로 답을 보냈을 때 받은 삭제 코드를 붙여 넣어 주세요. wc_del_ 로 시작해요.</label>
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
          ? `지우기를 마쳤어요. 이 코드로 저장된 답이 있었다면 이제 연구 자료에 남아 있지 않아요. 같은 코드로 다시 저장되지 않도록, 원래 코드를 알아낼 수 없게 바꾼 값과 지운 날짜만 ${WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS}일 동안 남겨 둬요.`
          : state === "invalid"
            ? "삭제 코드가 아닌 것 같아요. wc_del_ 로 시작하는 코드를 한 글자도 빼지 말고 그대로 붙여 넣어 주세요."
            : state === "failed"
              ? "지금은 지우지 못했어요. 잠시 뒤 다시 시도해 주세요."
              : ""}
      </p>
    </details>
  );
}
