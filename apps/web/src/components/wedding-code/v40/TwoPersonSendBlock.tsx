"use client";

import { useId, useRef, useState } from "react";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ShareEnv, ShareSentEvent } from "./shareActions";
import {
  AddressField,
  ConsentCheck,
  MessageField,
  SectionHeading,
  SendButton,
  SendStatusLine,
  useLinkSender,
} from "./ShareBlock";
import { bodyText, card, cx, noteText } from "./styles";

export interface TwoPersonSendBlockProps {
  /**
   * 두 사람의 답이 든 링크를 만든다(누를 때만 부른다). 먼저 답한 사람의 답이 앞, 나중에 답한 사람의 답이 뒤다.
   * 만들 수 없으면 null. 이 컴포넌트는 코덱도 window 도 모른다.
   */
  readonly buildUrl: () => string | null;
  /**
   * 링크를 실제로 보냈을 때 부른다. kind 는 shared, copied, revealed. 사람이 공유 창을 닫은 경우는 부르지 않는다.
   * 이용 통계 wedding_code_share_copied 는 kind 가 copied 일 때만 보낸다.
   */
  readonly onSent: (event: ShareSentEvent) => void;
  /** 시험용 공유 환경. 없으면 지금 브라우저의 공유 창과 클립보드. */
  readonly env?: ShareEnv;
  /** 한 화면 안에서 겹치지 않는 접두어. 없으면 자동. */
  readonly idPrefix?: string;
  /** 제목 레벨. 기본 2. */
  readonly headingLevel?: 2 | 3;
  /**
   * 이 블록의 뿌리 요소에 줄 id. 주면 뿌리가 초점을 받을 수 있게 되어(tabIndex -1) 화면 위쪽의 「상대에게 보내는 곳으로 가기」가 이 블록으로 초점과 스크롤을 옮길 수 있다.
   */
  readonly regionId?: string;
}

/**
 * 이 결과를 상대에게도 보내기. 상대가 답을 마쳐 두 사람 결과가 열린 화면에서만 나오는 유일한 링크 단추다.
 * 링크에는 두 사람의 답이 모두 들어서, 체크 둘을 모두 켜야 단추가 열린다(막힌 동안은 aria-disabled 와 이유 글).
 * 이걸 보내야 상대도 두 사람 결과를 볼 수 있다는 사실을 도움말이 말한다. 내 글자는 보낼 말에 넣지 않는다.
 * 보내기는 ShareBlock 과 같은 길이다(공유 창, 클립보드, 읽기 전용 주소 칸).
 */
export function TwoPersonSendBlock({ buildUrl, onSent, env, idPrefix, headingLevel = 2, regionId }: TwoPersonSendBlockProps) {
  const uid = useId();
  const prefix = idPrefix ?? `wc40-couple-send${uid}`;
  const ids = {
    title: `${prefix}-title`,
    message: `${prefix}-message`,
    reason: `${prefix}-reason`,
    status: `${prefix}-status`,
    address: `${prefix}-address`,
  } as const;

  const [allAnswers, setAllAnswers] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [message, setMessage] = useState<string>(V40_COPY.coupleSend.message);
  const allAnswersRef = useRef<HTMLInputElement>(null);
  const firstPersonRef = useRef<HTMLInputElement>(null);
  const sender = useLinkSender(onSent, env);
  const blocked = !allAnswers || !firstPerson;

  const send = () => {
    if (blocked) {
      // 비어 있는 첫 체크로 초점을 옮겨 무엇을 해야 하는지 보이게 한다.
      (allAnswers ? firstPersonRef : allAnswersRef).current?.focus();
      return;
    }
    let url: string | null;
    try {
      url = buildUrl();
    } catch {
      url = null;
    }
    void sender.run(url, message);
  };

  return (
    <section
      id={regionId}
      tabIndex={regionId === undefined ? undefined : -1}
      aria-labelledby={ids.title}
      className={cx(card, "p-4", regionId !== undefined && "outline-none")}
    >
      <SectionHeading level={headingLevel} id={ids.title}>
        {V40_COPY.coupleSend.title}
      </SectionHeading>
      <p className={cx(bodyText, "mt-2")}>{V40_COPY.coupleSend.help}</p>

      <div className="mt-3 space-y-2">
        <ConsentCheck inputRef={allAnswersRef} checked={allAnswers} onChange={setAllAnswers}>
          {V40_COPY.coupleSend.consentAllAnswers}
        </ConsentCheck>
        <ConsentCheck inputRef={firstPersonRef} checked={firstPerson} onChange={setFirstPerson}>
          {V40_COPY.coupleSend.consentSelf}
        </ConsentCheck>
      </div>

      <div className="mt-4">
        <MessageField
          id={ids.message}
          label={V40_COPY.coupleSend.messageLabel}
          value={message}
          onChange={setMessage}
        />
      </div>

      <div className={cx(noteText, "mt-4 space-y-1")}>
        <p>{V40_COPY.coupleSend.sensitiveInfo}</p>
        <p>{V40_COPY.coupleSend.anyoneCanReadInfo}</p>
        <p>{V40_COPY.coupleSend.oldLinksRemainInfo}</p>
        <p>{V40_COPY.send.shareSheetInfo}</p>
      </div>

      <div className="mt-4">
        <SendButton label={V40_COPY.coupleSend.sendButton} blocked={blocked} busy={sender.busy} reasonId={ids.reason} onClick={send} />
        {blocked ? (
          <p id={ids.reason} className={cx(noteText, "mt-2")}>
            {V40_COPY.coupleSend.disabledReason}
          </p>
        ) : null}
      </div>

      <SendStatusLine id={ids.status} status={sender.status} />
      {sender.revealedUrl !== null ? <AddressField id={ids.address} url={sender.revealedUrl} describedBy={ids.status} /> : null}
    </section>
  );
}

export default TwoPersonSendBlock;
