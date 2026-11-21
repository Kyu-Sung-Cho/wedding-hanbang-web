"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  VENDOR_REPLY_COPY,
  readVendorReply,
  type ConsultationReplyPaste,
  type VendorReplyChip,
  type VendorReplyReading,
} from "@hanbang/shared/invitation";

import Button from "@/components/ui/Button";

import { cx } from "../invitationScreen";
import { LiveNotice } from "./LiveParts";
import { liveRoute } from "./liveRoutes";
import { usePastedConsultationSchedule, type PastedScheduleOutcome } from "./useInvitationHome";
import {
  chipIsChosen,
  draftWithChip,
  draftWithMeridiem,
  foundAnyValue,
  hasWeekdayMismatch,
  initialPasteDraft,
  isSchedulableChip,
  pasteScheduleBody,
  type PasteDraft,
  type PasteDraftProblem,
  type SchedulableChip,
} from "./vendorReplyDraft";

/**
 * 받은 답 붙여 넣기(D-83 1단계, 2026-11-18). 상담 화면(`/halls/consultation`)에 둔다.
 *
 * 두 분이 업체에게 받은 문자·카톡을 붙여 넣으면 이 기기 안에서만 읽는다(`readVendorReply`). 원문 대신 연락처·링크·번호를
 * 가린 글을 보이고, 업체가 적은 날짜·시간·금액·보증 인원과 업체가 쓴 말을 칩으로 옮긴다. 칩은 좋고 나쁨을 말하지 않는다.
 *
 * 붙여 넣은 글은 이 화면의 상태에만 있다(대화 초안·브라우저 저장소에 넣지 않는다). 읽고 나면 원문은 버리고 가린 글만
 * 둔다. 서버로도 아모라에게도 가지 않는다. 일정에 넣는 것은 사람이 홀과 날짜를 고르고 넣기를 누를 때만이고, 그때도
 * 홀·날짜·시간 세 칸만 나간다. 글을 밖으로 보낼 수 있는 브라우저 맞춤법 검사는 이 칸에서 끈다.
 */

const FIELD = cx(
  "rounded-[14px] border-none bg-inv-paper-soft px-4 text-[15px] text-inv-ink outline-none",
  "shadow-[inset_0_0_0_1px_var(--inv-chip-line)] focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]",
);

/** 보여 주기만 하는 칩(금액·보증 인원). 모두 같은 모양이다(좋고 나쁨의 색을 쓰지 않는다). */
const VALUE_CHIP = "inline-flex min-h-[34px] items-center rounded-[17px] border border-inv-chip-line bg-inv-white px-3 text-[13px] text-inv-ink";

const PROBLEM_TEXT: Readonly<Record<PasteDraftProblem, string>> = {
  hall: VENDOR_REPLY_COPY.pickHall,
  date: VENDOR_REPLY_COPY.pickDate,
  timeIncomplete: VENDOR_REPLY_COPY.timeIncomplete,
  meridiem: VENDOR_REPLY_COPY.meridiemQuestion,
};

type Halls = ConsultationReplyPaste["halls"];

function PasteInput({
  raw,
  onChange,
  onRead,
  onClose,
}: {
  raw: string;
  onChange: (raw: string) => void;
  onRead: () => void;
  onClose: () => void;
}) {
  const inputId = useId();
  return (
    <div className="flex flex-col gap-2.5" data-vendor-reply-input>
      <p className="text-[13px] leading-[1.6] text-inv-body">{VENDOR_REPLY_COPY.helper}</p>
      <label htmlFor={inputId} className="text-[13px] text-inv-muted">
        {VENDOR_REPLY_COPY.inputLabel}
      </label>
      <textarea
        id={inputId}
        value={raw}
        rows={6}
        placeholder={VENDOR_REPLY_COPY.placeholder}
        // 붙여 넣기를 누른 사람이 바로 붙여 넣을 수 있게 초점을 옮긴다.
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className={cx(FIELD, "w-full resize-y py-3 font-inv-sans leading-[1.6]")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ink" size="pill-46" weight="bold" className="px-[22px]" disabled={raw.trim() === ""} onClick={onRead}>
          {VENDOR_REPLY_COPY.read}
        </Button>
        <Button variant="text" size="pill-46" className="px-3" onClick={onClose}>
          {VENDOR_REPLY_COPY.close}
        </Button>
      </div>
    </div>
  );
}

/**
 * 원문이 아니라 가린 글. 몇 곳을 가렸는지, 앞부분만 읽었는지, 돈 이야기가 있는지, 업체가 적은 요일이 달력과 다른지를
 * 정해진 줄로 덧붙인다. 요일 줄은 어긋난 날짜가 여럿이어도 한 번만 쓴다.
 */
function MaskedPreview({ reading }: { reading: VendorReplyReading }) {
  return (
    <div className="flex flex-col gap-1.5" data-vendor-reply-preview>
      <p
        className="max-h-48 overflow-y-auto rounded-[14px] bg-inv-paper-soft p-3 font-inv-sans text-[14px] leading-[1.7] whitespace-pre-wrap text-inv-body"
        data-vendor-reply-masked
      >
        {reading.masked}
      </p>
      {reading.maskedCount > 0 ? (
        <p className="text-[12px] leading-[1.5] text-inv-muted">{VENDOR_REPLY_COPY.masked(reading.maskedCount)}</p>
      ) : null}
      {reading.truncated ? <p className="text-[12px] leading-[1.5] text-inv-muted">{VENDOR_REPLY_COPY.truncated}</p> : null}
      {reading.caution ? (
        <p className="text-[13px] leading-[1.6] text-inv-body" data-vendor-reply-caution>
          {VENDOR_REPLY_COPY.caution}
        </p>
      ) : null}
      {hasWeekdayMismatch(reading.chips) ? (
        <p className="text-[13px] leading-[1.6] text-inv-body" data-vendor-reply-weekday-mismatch>
          {VENDOR_REPLY_COPY.weekdayMismatch}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 칩. 날짜·시간 칩은 누르면 아래 칸에 옮기고, 금액·보증 인원은 보여 주기만 한다. 업체가 쓴 말은 그대로 옮긴다.
 * 아무것도 찾지 못했을 때, 고를 웨딩홀이 없어 날짜 칸이 없으면(`canSchedule` 거짓) 직접 골라 넣으라는 뒤 문장을 말하지 않는다.
 */
function ReplyChips({
  chips,
  draft,
  canSchedule,
  onPick,
}: {
  chips: readonly VendorReplyChip[];
  draft: PasteDraft;
  canSchedule: boolean;
  onPick: (chip: SchedulableChip) => void;
}) {
  const schedulable = chips.filter(isSchedulableChip);
  const values = chips.filter((chip) => chip.kind === "price" || chip.kind === "count");
  const phrases = chips.filter((chip) => chip.kind === "phrase");
  return (
    <div className="flex flex-col gap-3" data-vendor-reply-chips>
      {foundAnyValue(chips) ? (
        <ul className="flex flex-wrap gap-2">
          {schedulable.map((chip) => {
            const chosen = chipIsChosen(draft, chip);
            return (
              <li key={`${chip.kind}:${chip.label}`}>
                <Button
                  variant={chosen ? "ink" : "outline"}
                  size="pill-34"
                  className="px-3"
                  aria-pressed={chosen}
                  onClick={() => onPick(chip)}
                >
                  {chip.label}
                </Button>
              </li>
            );
          })}
          {values.map((chip) => (
            <li key={`${chip.kind}:${chip.label}`}>
              <span className={VALUE_CHIP}>{chip.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] leading-[1.6] text-inv-body" data-vendor-reply-none>
          {canSchedule ? VENDOR_REPLY_COPY.none : VENDOR_REPLY_COPY.noneOnly}
        </p>
      )}
      {phrases.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-vendor-reply-phrases>
          <span className="text-[12px] text-inv-muted">{VENDOR_REPLY_COPY.quoteLabel}</span>
          <ul className="flex flex-col gap-1">
            {phrases.map((chip) => (
              <li key={chip.quote} className="font-inv-sans text-[13px] leading-[1.6] text-inv-body">
                <q>{chip.quote}</q>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function HallPicker({ halls, draft, onChange }: { halls: Halls; draft: PasteDraft; onChange: (draft: PasteDraft) => void }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <span id={labelId} className="text-[13px] text-inv-muted">
        {VENDOR_REPLY_COPY.hallLabel}
      </span>
      <div className="flex flex-wrap gap-2">
        {halls.map((hall) => {
          const on = draft.hallId === hall.hallId;
          return (
            <Button
              key={hall.hallId}
              variant={on ? "ink" : "outline"}
              size="pill-38"
              className="px-3.5"
              aria-pressed={on}
              onClick={() => onChange({ ...draft, hallId: hall.hallId })}
            >
              {hall.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 날짜·시간 칸. 짐작한 시간이면 오전·오후를 묻는다. "시간 없이 넣기"를 고르면 시간 칸을 잠근다.
 *
 * 시간 칸에 시만 고르고 분을 비우면 칸의 값은 빈 글이라 빈 칸과 같아 보인다. 그래서 칸의 `validity.badInput` 을 적어 둔다.
 * 값이 바뀔 때와, 빈 칸에서 시만 고를 때처럼 값이 그대로라 바뀜이 오지 않는 경우를 위해 칸을 떠날 때(넣기를 누르기 전)도 읽는다.
 */
function DateTimeFields({ draft, onChange }: { draft: PasteDraft; onChange: (draft: PasteDraft) => void }) {
  const dateId = useId();
  const timeId = useId();
  const noTimeId = useId();
  const questionId = useId();
  const recordTimeValidity = (incomplete: boolean) => {
    if (incomplete !== draft.timeIncomplete) onChange({ ...draft, timeIncomplete: incomplete });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={dateId} className="text-[13px] text-inv-muted">
            {VENDOR_REPLY_COPY.dateLabel}
          </label>
          <input
            id={dateId}
            type="date"
            value={draft.date}
            onChange={(event) => onChange({ ...draft, date: event.target.value })}
            className={cx(FIELD, "h-11")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={timeId} className="text-[13px] text-inv-muted">
            {VENDOR_REPLY_COPY.timeLabel}
          </label>
          <input
            id={timeId}
            type="time"
            value={draft.noTime ? "" : draft.time}
            disabled={draft.noTime}
            onChange={(event) =>
              onChange({ ...draft, time: event.target.value, meridiemPending: false, timeIncomplete: event.target.validity.badInput })}
            onBlur={(event) => recordTimeValidity(event.target.validity.badInput)}
            className={cx(FIELD, "h-11 disabled:opacity-50")}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={noTimeId}
          type="checkbox"
          checked={draft.noTime}
          onChange={(event) => onChange({ ...draft, noTime: event.target.checked })}
          className="size-5 accent-[var(--inv-ink)]"
        />
        <label htmlFor={noTimeId} className="text-[14px] text-inv-body">
          {VENDOR_REPLY_COPY.noTime}
        </label>
      </div>
      {draft.meridiemPending && !draft.noTime ? (
        <div role="group" aria-labelledby={questionId} className="flex flex-col gap-2" data-vendor-reply-meridiem>
          <p id={questionId} className="text-[13px] leading-[1.6] text-inv-body">
            {VENDOR_REPLY_COPY.meridiemQuestion}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="pill-38" className="px-3.5" onClick={() => onChange(draftWithMeridiem(draft, "am"))}>
              {VENDOR_REPLY_COPY.am}
            </Button>
            <Button variant="outline" size="pill-38" className="px-3.5" onClick={() => onChange(draftWithMeridiem(draft, "pm"))}>
              {VENDOR_REPLY_COPY.pm}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 고를 웨딩홀이 없다. 먼저 담으라고 하고, 웨딩홀을 담는 비교 화면으로 가는 링크를 둔다. */
function NoHallsNotice() {
  return (
    <div className="flex flex-col items-start gap-2" data-vendor-reply-no-halls>
      <p className="text-[13px] leading-[1.6] text-inv-body">{VENDOR_REPLY_COPY.noHalls}</p>
      <Button href={liveRoute("compare")} variant="outline" size="pill-38" className="px-3.5">
        {VENDOR_REPLY_COPY.noHallsAction}
      </Button>
    </div>
  );
}

/**
 * 읽은 답과 일정 칸. 칸을 바꾸면 앞 결과 줄을 거둔다. 넣기는 홀·날짜(·오전·오후)가 갖춰졌을 때만 서버를 부르고,
 * 모자라면 무엇을 고르라고 말한다.
 *
 * 결과 줄("일정에 넣었어요." 같은)은 넣기를 누른 그 칸 값에 대한 말이다. 넣는 동안이나 그 뒤에 홀·날짜·시간을 바꾸면
 * 그 줄을 보이지 않는다(앱의 같은 칸과 같다). 그래서 넣기를 누른 칸 값(`submitted`)을 함께 둔다.
 */
function ReplyReading({
  reading,
  halls,
  onAgain,
  onClose,
  onAdded,
}: {
  reading: VendorReplyReading;
  halls: Halls;
  onAgain: () => void;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const [draft, setDraft] = useState<PasteDraft>(() => initialPasteDraft(halls));
  const [problem, setProblem] = useState<PasteDraftProblem | null>(null);
  const [submitted, setSubmitted] = useState<PasteDraft | null>(null);
  const schedule = usePastedConsultationSchedule({ onAdded });
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 읽기 단추가 사라진 자리에서 초점을 잃지 않게, 읽은 답의 머리로 옮긴다.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const change = (next: PasteDraft) => {
    setDraft(next);
    setProblem(null);
    schedule.clear();
  };
  const submit = () => {
    const checked = pasteScheduleBody(draft);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    setProblem(null);
    setSubmitted(draft);
    void schedule.add(checked.body);
  };
  // 칸을 바꿀 때마다 새 칸 값(새 객체)이 되므로, 넣기를 누른 그 칸 값일 때만 결과 줄을 보인다.
  const outcome = submitted === draft ? schedule.outcome : null;
  const line: PastedScheduleOutcome | null = problem ? { tone: "error", text: PROBLEM_TEXT[problem] } : outcome;
  const canSchedule = halls.length > 0;

  return (
    <div className="flex flex-col gap-4" data-vendor-reply-reading>
      <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-bold outline-none">
        {VENDOR_REPLY_COPY.foundHeading}
      </h2>
      <MaskedPreview reading={reading} />
      <ReplyChips
        chips={reading.chips}
        draft={draft}
        canSchedule={canSchedule}
        onPick={(chip) => change(draftWithChip(draft, chip))}
      />
      {!canSchedule ? (
        <NoHallsNotice />
      ) : (
        <div className="flex flex-col gap-3.5" data-vendor-reply-schedule>
          <HallPicker halls={halls} draft={draft} onChange={change} />
          <DateTimeFields draft={draft} onChange={change} />
          <Button variant="ink" size="pill-46" weight="bold" className="self-start px-[22px]" loading={schedule.adding} onClick={submit}>
            {schedule.adding ? VENDOR_REPLY_COPY.adding : VENDOR_REPLY_COPY.add}
          </Button>
          {line ? <LiveNotice tone={line.tone}>{line.text}</LiveNotice> : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="pill-38" className="px-3.5" onClick={onAgain}>
          {VENDOR_REPLY_COPY.again}
        </Button>
        <Button variant="text" size="pill-38" className="px-3" onClick={onClose}>
          {VENDOR_REPLY_COPY.close}
        </Button>
      </div>
    </div>
  );
}

type Step = "closed" | "input" | "read";

/**
 * 붙여 넣기 칸 전체. 처음에는 여는 단추 하나다. 닫으면 붙여 넣은 글과 읽은 답을 모두 버린다.
 * `halls` 는 서버가 준 고를 수 있는 웨딩홀(담은 홀과 열린 편지의 받는 곳)이다. `onAdded` 는 새 상담을 일정에 넣었을 때
 * (이미 있던 것이 아니라 새로 넣었을 때) 부른다. 상담 화면은 그때 상담을 다시 읽어 넣은 상담 수를 맞춘다.
 */
export default function VendorReplyPaste({ halls, onAdded }: { halls: Halls; onAdded?: () => void }) {
  const [step, setStep] = useState<Step>("closed");
  const [raw, setRaw] = useState("");
  const [reading, setReading] = useState<VendorReplyReading | null>(null);
  // 사람이 닫았을 때만 여는 단추로 초점을 돌린다(처음 그릴 때는 옮기지 않는다).
  const [closedByPerson, setClosedByPerson] = useState(false);

  const read = () => {
    if (raw.trim() === "") return;
    setReading(readVendorReply(raw));
    // 읽고 나면 원문은 버린다. 화면은 가린 글만 보인다.
    setRaw("");
    setStep("read");
  };
  const again = () => {
    setReading(null);
    setRaw("");
    setStep("input");
  };
  const close = () => {
    setReading(null);
    setRaw("");
    setClosedByPerson(true);
    setStep("closed");
  };

  if (step === "closed") {
    return (
      <section className="flex flex-col items-start" data-vendor-reply="closed">
        <Button variant="outline" size="pill-46" className="px-[22px]" autoFocus={closedByPerson} onClick={() => setStep("input")}>
          {VENDOR_REPLY_COPY.open}
        </Button>
      </section>
    );
  }
  return (
    <section className="flex w-full flex-col gap-4" data-vendor-reply={step}>
      {step === "read" && reading ? (
        <ReplyReading reading={reading} halls={halls} onAgain={again} onClose={close} onAdded={onAdded} />
      ) : (
        <PasteInput raw={raw} onChange={setRaw} onRead={read} onClose={close} />
      )}
    </section>
  );
}
