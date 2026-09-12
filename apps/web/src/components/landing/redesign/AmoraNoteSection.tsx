import { LockKeyhole, Users } from "lucide-react";
import AmoraAvatar from "@/components/ui/AmoraAvatar";

import { landingContent } from "./landingContent";
import { band, bodyText, eyebrowText, noteText, shell } from "./notebook";

/**
 * ③ 막막한 그대로 말해도 돼요 — 아모라가 **처음 말하는 자리**.
 *
 * 2026-09-03 시안: 왼쪽에 카피와 자리(레인) 카드 둘, 오른쪽에 대화 카드 한 장.
 * 없어진 두 섹션의 몫이 여기로 들어왔다 — `PrivateLaneSection`(함께 보는 자리 /
 * 나만 보는 자리)과 `OneRoomSection`(앞 대화를 기억한다는 캡션).
 *
 * ## 고지가 카드 **안**에 있어야 하는 이유
 *
 * `amoraNote.note` 는 AI 기본법 고지 + 샘플 표시 + 저장 안 함을 함께 진다. 이 카드는
 * 캡처돼 돌아다니기 쉬운 모양이고, 라벨을 카드 바깥 작은 글씨로 빼면 그 순간
 * **연출된 대화가 진짜 대화로 읽힌다.** 그래서 대화 카드 마지막 자식으로 둔다.
 *
 * `privacyNote`(대화 저장·배우자 비노출)는 없어진 `privateLane.note` 가 지던 고지다.
 * 개인 상담 카드 안에 둔다 — 공동 대화까지 비공개라는 뜻으로 읽히지 않게 한다.
 */
export default function AmoraNoteSection() {
  const { amoraNote } = landingContent;

  return (
    <section id="amora" className={`${band} bg-[var(--color-ivory-50)]`} aria-labelledby="amora-title">
      <div className={`${shell} grid gap-y-[22px] lg:grid-cols-2 lg:gap-x-[72px] lg:gap-y-0`}>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="mb-[10px] lg:mb-3">
            <span className={eyebrowText}>
              {amoraNote.eyebrow}
            </span>
          </p>

          <h2 id="amora-title" className="landing-display text-[24px] leading-[1.48] text-[var(--color-paper-ink)] lg:text-[31px] lg:leading-[1.42]">
            {amoraNote.title.split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>

          <p className={`mt-[14px] lg:mt-4 ${bodyText}`}>{amoraNote.body}</p>
        </div>

        <div className="min-w-0 rounded-[16px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-[18px] shadow-raised lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center lg:rounded-[18px] lg:p-6">
          <p className="mb-[6px] text-[11px] text-[var(--color-paper-ink-faint)] lg:mb-[7px] lg:text-[11.5px]">
            {amoraNote.chat.meLabel}
          </p>
          <p className="rounded-[13px] rounded-br-[4px] bg-[var(--color-surface-low)] px-[14px] py-3 text-[13.5px] leading-[1.7] text-[var(--color-paper-ink)] lg:rounded-[15px] lg:rounded-br-[5px] lg:px-[17px] lg:py-[14px] lg:text-[14.5px]">
            {amoraNote.chat.me}
          </p>

          <p className="mb-[7px] mt-[13px] flex items-center gap-[6px] text-[11.5px] font-semibold text-[var(--color-rose-700)] lg:mb-2 lg:mt-4 lg:gap-[7px] lg:text-[12px]">
            <AmoraAvatar sizeClassName="size-6" />
            <span>{amoraNote.chat.amoraLabel}</span>
          </p>
          <p className="rounded-[13px] rounded-bl-[4px] bg-[var(--color-sage-pale)] px-[14px] py-3 text-[13.5px] leading-[1.7] text-[var(--color-paper-ink)] lg:rounded-[15px] lg:rounded-bl-[5px] lg:px-[17px] lg:py-[14px] lg:text-[14.5px]">
            {amoraNote.chat.amora}
          </p>

          {/* 칩은 **그림이다.** 누를 수 있는 것처럼 보이지만 이 화면에서는 아무 일도
              일어나지 않는다(비로그인 아모라 체험이 닫혀 있다). 보조기기가 진짜
              버튼으로 읽지 않도록 aria-hidden 으로 묶는다. */}
          <div aria-hidden className="mt-[13px] flex gap-2 lg:mt-4 lg:gap-[9px]">
            {amoraNote.chat.chips.map((chip) => (
              <span
                key={chip}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border-[1.5px] border-[var(--color-paper-ink)] px-4 text-[13.5px] font-semibold text-[var(--color-paper-ink)] lg:flex-none lg:px-5"
              >
                {chip}
              </span>
            ))}
          </div>

          <p className={`mt-[14px] lg:mt-4 ${noteText}`}>{amoraNote.chat.caption}</p>
          <p className={`mt-4 ${noteText}`}>{amoraNote.note}</p>
        </div>

        {/* 모바일에서는 대화 다음에, 넓은 화면에서는 설명 아래에 두 자리를 소개한다. */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:mt-8 lg:self-start">
          <ul className="grid gap-[10px] lg:grid-cols-2 lg:gap-4">
            {amoraNote.lanes.map((lane) => (
              <li
                key={lane.name}
                className={`rounded-[13px] border p-[17px] lg:rounded-[14px] lg:px-[22px] lg:py-5 ${
                  lane.shared
                    ? "border-[var(--color-paper-edge)] bg-[var(--color-paper-card)]"
                    : "border-dashed border-[var(--color-paper-outline)] bg-[var(--color-ivory-50)]"
                }`}
              >
                <p className="flex items-center gap-[7px] text-[13.5px] font-semibold text-[var(--color-paper-ink)] lg:gap-2 lg:text-[14px]">
                  {lane.shared
                    ? <Users aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
                    : <LockKeyhole aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />}
                  {lane.name}
                </p>
                <p className={`mt-[7px] lg:mt-2 ${noteText}`}>{lane.detail}</p>
                {!lane.shared && <p className={`mt-2 ${noteText}`}>{amoraNote.privacyNote}</p>}
              </li>
            ))}
          </ul>
          <p className={`mt-3 lg:mt-[14px] ${noteText}`}>{amoraNote.laneNote}</p>
        </div>
      </div>
    </section>
  );
}
