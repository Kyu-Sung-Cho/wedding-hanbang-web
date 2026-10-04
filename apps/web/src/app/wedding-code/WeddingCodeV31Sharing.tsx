"use client";

import { Copy, Link as LinkIcon } from "lucide-react";
import { useId, useState } from "react";
import Button from "@/components/ui/Button";
import { WEDDING_CODE_V31_VERSION, type V31Draft } from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { buildV31ShareUrl, hasV31Content } from "@/lib/weddingCode/v31";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Connection from "./WeddingCodeV31Connection";

function CopyLink({ url, label, inputLabel, resultKind }: { url: string; label: string; inputLabel: string; resultKind?: "solo" | "couple" }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url); setState("copied");
      if (resultKind) captureWeddingCodeEvent("wedding_code_share_copied", { version: WEDDING_CODE_V31_VERSION, result_kind: resultKind, placement: "result" });
    }
    catch { setState("failed"); }
  }
  return <div className="mt-4">
    <Button variant="secondary" fullWidth onClick={copy} className="whitespace-normal!">
      <Copy aria-hidden="true" className="size-4 shrink-0" />{state === "copied" ? "링크를 복사했어요" : label}
    </Button>
    <p aria-live="polite" className="mt-2 text-xs leading-relaxed text-[var(--hb-text-body)]">
      {state === "failed" ? "자동 복사가 안 됐어요. 아래 주소를 길게 누르거나 선택해서 직접 복사해 주세요." : state === "copied" ? "보내고 싶은 대화창에 붙여 넣어 주세요." : ""}
    </p>
    <details open={state === "failed" || undefined} className="mt-2 text-xs text-[var(--hb-text-body)]">
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">링크 주소 직접 복사하기</summary>
      <input readOnly aria-label={inputLabel} value={url} onFocus={event => event.currentTarget.select()}
        className="min-h-12 w-full rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] px-3 focus-visible:outline-2 focus-visible:outline-[var(--hb-focus-ring)]" />
    </details>
  </div>;
}

export default function WeddingCodeV31Sharing({ shareOrigin, first, second, received = false }: {
  shareOrigin: string; first: V31Draft; second?: V31Draft; received?: boolean;
}) {
  const consentId = useId();
  const [consent, setConsent] = useState(false);
  const [partnerConsent, setPartnerConsent] = useState(false);
  const genericUrl = new URL("/wedding-code", shareOrigin).toString();
  const canShare = !received && hasV31Content(first) && (!second || hasV31Content(second));
  const mayBuild = canShare && consent && (!second || partnerConsent);
  const url = mayBuild ? buildV31ShareUrl({ origin: shareOrigin, first, second }) : null;

  return <>
    {canShare && !second ? <WeddingCodeV31Connection draft={first} /> : null}
    <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-labelledby={`${consentId}-heading`} data-share-box="v31">
    <div className="flex items-center gap-2"><LinkIcon aria-hidden="true" className="size-5 text-[var(--hb-text-body)]" /><h2 id={`${consentId}-heading`} className={`text-lg ${v31Title}`}>같이 이야기하고 싶다면</h2></div>
    <p className={`mt-3 ${v31Body}`}>답을 보내지 않고 웨딩코드만 권할 수도 있어요. 일반 시작 링크에는 답이 담기지 않고, 두 사람의 결과가 자동으로 연결되지 않아요.</p>
    <CopyLink url={genericUrl} label="답 없는 시작 링크 복사" inputLabel="웨딩코드 일반 시작 링크" />
    {canShare ? <details className="mt-5 border-t border-[var(--hb-hairline)] pt-5">
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>답을 링크에 담아 직접 보내기</summary>
      <h3 className={`text-base ${v31Title}`}>{second ? "둘이 답한 결과 공유하기" : "내 답을 보내고 함께 비교하기"}</h3>
      <p className={`mt-2 ${v31Body}`}>
        {second ? "두 사람의 답 전체가 링크에 담겨요." : "내가 고른 답 전체가 링크 주소 안에 그대로 들어가요. 링크를 받은 사람이 답하면 두 사람의 내용을 나란히 볼 수 있어요."}
        {" "}가족·돈·받고 싶은 도움에 관한 답, 고른 취향, 피하고 싶은 것, 더 쓰고 싶은 곳, 꼭 지키고 싶은 것도 들어 있어요.
      </p>
      <p className={`mt-3 ${v31Body}`}>링크를 가진 누구나 답을 읽고 다시 전달할 수 있어요. 비밀번호나 본인 확인은 없고, 이미 보낸 링크는 회수하거나 사용을 막을 수 없어요. 답을 고쳐 새 링크를 만들어도 예전 링크는 그대로 남아요.</p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
        <span className={`text-sm ${v31Title}`}>공개 범위를 확인했고, 내 답 전체가 담긴 링크를 만들게요.</span>
      </label>
      {second ? <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
        <input type="checkbox" checked={partnerConsent} onChange={event => setPartnerConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
        <span className={`text-sm ${v31Title}`}>먼저 답한 사람에게 두 사람의 답을 함께 링크에 담아 보내도 되는지 물어보고 허락을 받았어요.</span>
      </label> : null}
      {url ? <CopyLink key={url} url={url} label={second ? "두 사람 결과 링크 복사" : "비교 초대 링크 복사"} inputLabel="답이 담긴 웨딩코드 공유 링크" resultKind={second ? "couple" : "solo"} /> : <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{mayBuild ? "공유 링크를 만들지 못했어요. 답을 확인해 주세요." : "동의 항목에 체크하면 답이 담긴 링크가 나타나요."}</p>}
    </details> : <p className={`mt-4 border-t border-[var(--hb-hairline)] pt-4 ${v31Body}`} data-response-share-unavailable>
      {received ? "받은 링크를 열었다고 이 답이 내 것으로 저장되지는 않아요. 다른 사람의 답을 다시 보낼 때는 먼저 그 사람에게 확인해 주세요. 여기서는 답 없는 시작 링크만 제공해요."
        : second ? "두 사람 모두 직접 고른 답이 하나라도 있어야 결과 링크를 만들 수 있어요. ‘아직 모르겠어요’나 건너뛴 답만으로는 만들지 않아요."
          : "지금은 공유할 답이 없어요. 원하는 내용에 답한 뒤 결과를 보낼 수 있어요."}
    </p>}
  </section></>;
}
