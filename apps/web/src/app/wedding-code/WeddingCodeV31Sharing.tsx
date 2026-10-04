"use client";

import { Copy, Link as LinkIcon } from "lucide-react";
import { useId, useState } from "react";
import Button from "@/components/ui/Button";
import { WEDDING_CODE_V31_VERSION, type V31Draft } from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { buildV31ShareUrl, hasV31Content } from "@/lib/weddingCode/v31";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Connection from "./WeddingCodeV31Connection";

/**
 * 링크 복사 단추 하나. 복사했다는 표시는 부모가 하나만 들고 있다: 두 단추를 차례로 눌렀을 때 지금 클립보드에 있는 링크는 나중에 누른 쪽뿐인데
 * 두 곳 모두 ‘복사했어요’가 남아 있으면 어느 링크가 있는지 알 수 없다. copied 는 이 링크가 마지막에 복사한 링크일 때만 true 다.
 */
function CopyLink({ url, label, copiedLabel, inputLabel, resultKind, copied, onCopied }: {
  url: string; label: string; copiedLabel: string; inputLabel: string; resultKind?: "solo" | "couple"; copied: boolean; onCopied: (url: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url); setFailed(false); onCopied(url);
      if (resultKind) captureWeddingCodeEvent("wedding_code_share_copied", { version: WEDDING_CODE_V31_VERSION, result_kind: resultKind, placement: "result" });
    }
    catch { setFailed(true); }
  }
  return <div className="mt-4">
    <Button variant="secondary" fullWidth onClick={copy} className="whitespace-normal!">
      <Copy aria-hidden="true" className="size-4 shrink-0" />{copied && !failed ? copiedLabel : label}
    </Button>
    <p aria-live="polite" className="mt-2 text-xs leading-relaxed text-[var(--hb-text-body)]">
      {failed ? "자동 복사가 안 됐어요. 아래 주소를 길게 누르거나 선택해서 직접 복사해 주세요." : copied ? "보내고 싶은 대화창에 붙여 넣어 주세요." : ""}
    </p>
    <details open={failed || undefined} className="mt-2 text-xs text-[var(--hb-text-body)]">
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">링크 주소 직접 복사하기</summary>
      <input readOnly aria-label={inputLabel} value={url} onFocus={event => event.currentTarget.select()}
        className="min-h-12 w-full rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] px-3 focus-visible:outline-2 focus-visible:outline-[var(--hb-focus-ring)]" />
    </details>
  </div>;
}

export default function WeddingCodeV31Sharing({ shareOrigin, first, second, received = false, openSignal = 0 }: {
  shareOrigin: string; first: V31Draft; second?: V31Draft; received?: boolean;
  /** 값이 바뀔 때마다 ‘답을 링크에 담아 직접 보내기’ 칸을 연다(결과 머리의 ‘상대에게 보내는 곳으로 가기’ 단추). */
  openSignal?: number;
}) {
  const consentId = useId();
  const [consent, setConsent] = useState(false);
  const [partnerConsent, setPartnerConsent] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [directOpen, setDirectOpen] = useState(false);
  // 열기 신호가 바뀐 그 그리기에서 칸을 연다(효과 안에서 상태를 바꾸지 않는다).
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (openSignal !== seenSignal) { setSeenSignal(openSignal); if (openSignal > 0) setDirectOpen(true); }
  const genericUrl = new URL("/wedding-code", shareOrigin).toString();
  const canShare = !received && hasV31Content(first) && (!second || hasV31Content(second));
  const mayBuild = canShare && consent && (!second || partnerConsent);
  const url = mayBuild ? buildV31ShareUrl({ origin: shareOrigin, first, second }) : null;

  return <>
    {canShare && !second ? <WeddingCodeV31Connection draft={first} /> : null}
    <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-labelledby={`${consentId}-heading`} data-share-box="v31">
    <div className="flex items-center gap-2"><LinkIcon aria-hidden="true" className="size-5 text-[var(--hb-text-body)]" /><h2 id={`${consentId}-heading`} className={`text-lg ${v31Title}`}>같이 이야기하고 싶다면</h2></div>
    {second && canShare ? <p className={`mt-3 font-semibold text-[var(--hb-text-strong)] ${v31Body}`} data-return-step>처음 링크를 보내 준 상대에게 두 사람 결과 링크를 다시 보내야 상대도 이 결과를 볼 수 있어요. 아래 ‘답을 링크에 담아 직접 보내기’에서 만들 수 있어요.</p> : null}
    <p className={`mt-3 ${v31Body}`}>내 답 없이 웨딩코드만 권할 수도 있어요. 일반 시작 링크에는 답이 담기지 않고, 두 사람의 결과가 자동으로 연결되지 않아요.</p>
    <CopyLink url={genericUrl} label="답 없는 시작 링크 복사" copiedLabel="시작 링크를 복사했어요" inputLabel="웨딩코드 일반 시작 링크" copied={copiedUrl === genericUrl} onCopied={setCopiedUrl} />
    {canShare ? <details open={directOpen} onToggle={event => setDirectOpen(event.currentTarget.open)} className="mt-5 border-t border-[var(--hb-hairline)] pt-5">
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>답을 링크에 담아 직접 보내기</summary>
      <h3 className={`text-base ${v31Title}`}>{second ? "둘이 답한 결과 공유하기" : "내 답을 링크에 담아 보내기"}</h3>
      <p className={`mt-2 ${v31Body}`}>
        {second ? "두 사람의 답 전체가 링크에 담겨요." : "내가 고른 답 전체가 링크 주소 안에 그대로 들어가요. 링크를 받은 사람이 자기 답을 마치면 그 사람 화면에서 두 사람의 답을 나란히 볼 수 있어요. 나도 보려면 그 사람이 두 사람 결과 링크를 다시 보내 줘야 해요."}
        {" "}가족·돈·받고 싶은 도움에 관한 답, 고른 취향, 피하고 싶은 것, 더 쓰고 싶은 곳, 꼭 지키고 싶은 것도 들어 있어요.
      </p>
      <p className={`mt-3 ${v31Body}`}>링크를 가진 누구나 답을 읽고 다시 전달할 수 있어요. 비밀번호나 본인 확인은 없고, 이미 보낸 링크는 회수하거나 사용을 막을 수 없어요. 답을 고쳐 새 링크를 만들어도 예전 링크는 그대로 남아요.</p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
        <span className={`text-sm ${v31Title}`}>{second ? "공개 범위를 확인했고, 두 사람의 답 전체가 담긴 링크를 만들게요." : "공개 범위를 확인했고, 내 답 전체가 담긴 링크를 만들게요."}</span>
      </label>
      {second ? <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
        <input type="checkbox" checked={partnerConsent} onChange={event => setPartnerConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
        <span className={`text-sm ${v31Title}`}>상대의 답도 이 링크에 담겨요. 이 링크는 상대에게만 보낼게요.</span>
      </label> : null}
      {url ? <CopyLink key={url} url={url} label={second ? "두 사람 결과 링크 복사" : "답이 담긴 링크 복사"} copiedLabel={second ? "두 사람 결과 링크를 복사했어요" : "답이 담긴 링크를 복사했어요"} inputLabel="답이 담긴 웨딩코드 공유 링크" resultKind={second ? "couple" : "solo"} copied={copiedUrl === url} onCopied={setCopiedUrl} /> : <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{mayBuild ? "공유 링크를 만들지 못했어요. 답을 확인해 주세요." : "동의 항목에 체크하면 답이 담긴 링크가 나타나요."}</p>}
    </details> : <p className={`mt-4 border-t border-[var(--hb-hairline)] pt-4 ${v31Body}`} data-response-share-unavailable>
      {received ? "받은 링크를 열었다고 이 답이 내 것으로 저장되지는 않아요. 다른 사람의 답을 다시 보낼 때는 먼저 그 사람에게 확인해 주세요. 여기서는 답 없는 시작 링크만 복사할 수 있어요."
        : second ? "두 사람 모두 직접 고른 답이 하나라도 있어야 결과 링크를 만들 수 있어요. ‘아직 모르겠어요’나 건너뛴 답만으로는 만들지 않아요."
          : "지금은 공유할 답이 없어요. 원하는 내용에 답한 뒤 결과를 보낼 수 있어요."}
    </p>}
  </section></>;
}
