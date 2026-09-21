import Link from "next/link";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { AMORA_DECISION_BOARD_PATH, AMORA_DECISION_SCOPE_NOTICE, AMORA_DECISION_STATUS_LABELS, readAmoraDecisionReceipt } from "@hanbang/shared";
import type { ToolExecutionResult } from "@/types/database.types";

export default function DecisionRecordResultCard({ result }: { result: ToolExecutionResult }) {
  const uncertain = result.toolOutput.requires_state_review === true || result.toolOutput.error === "TOOL_EXECUTION_UNCERTAIN"
    || result.toolOutput.error === "TOOL_EXECUTION_IN_PROGRESS" || result.toolOutput.error === "TOOL_LEDGER_RESULT_INVALID";
  const decision = result.success && !uncertain ? readAmoraDecisionReceipt(result.toolOutput) : null;
  const unconfirmed = result.success || uncertain;
  return <div className="my-1.5 ml-11 flex justify-start">
    <section aria-label="결정 기록 저장 결과" className="w-full max-w-[24rem] rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface)] px-4 py-3 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)]">
        {decision ? <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--hb-success)]" />
          : unconfirmed ? <Info aria-hidden="true" className="size-4" /> : <XCircle aria-hidden="true" className="size-4 text-danger-700" />}
        결정 기록 저장
      </div>
      {decision ? <>
        <p className="break-words text-sm font-semibold text-[var(--hb-text-strong)]">{decision.title}</p>
        <p className="mt-1 text-xs text-[var(--hb-text-muted)]">{AMORA_DECISION_STATUS_LABELS[decision.status]} 상태로 저장했어요.</p>
        {decision.memo && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--hb-text-muted)]">{decision.memo}</p>}
        <p className="mt-1 text-xs leading-relaxed text-[var(--hb-text-muted)]">{AMORA_DECISION_SCOPE_NOTICE}</p>
      </> : <p className="text-xs leading-relaxed text-[var(--hb-text-muted)]">
        {unconfirmed ? "저장 여부를 확인하지 못했어요. 결정 기록에서 확인해 주세요." : "결정 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."}
      </p>}
      <Link href={AMORA_DECISION_BOARD_PATH} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-rose-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
        결정 기록 보기
      </Link>
    </section>
  </div>;
}
