// 받은 답 붙여 넣기(D-83 1단계, 2026-11-18). 일정 탭·상담 화면의 아래에 둔다(서버가 `replyPaste` 를 줄 때만).
//
// 커플이 업체에게 받은 문자·카톡을 붙여 넣으면 이 기기 안에서만 읽는다(`readVendorReply`).
//   - 붙여 넣은 원문은 화면 상태에만 잠깐 있고 읽자마자 비운다. 그 뒤에는 가린 글(연락처·링크·번호를 가림)만 남는다.
//     서버로도 아모라에게도 가지 않고, 기기 저장소에도 적지 않는다. 읽어 주는 이름에도 넣지 않는다.
//   - 업체가 적은 날짜·시간·금액·보증 인원과 업체가 쓴 말을 칩으로 옮긴다. 좋고 나쁨을 말하지 않는다.
//   - 일정에 넣는 것은 사람이 홀과 날짜를 고르고 단추를 누를 때만이다. 기기 밖으로 나가는 것은 홀 ID·날짜·시간
//     세 칸뿐이다(`onAdd` → `POST /api/invitation/consultation/paste-schedule`).
//   - 업체가 "2시"처럼 오전·오후 없이 쓴 시간은 짐작한 값으로 넣지 않는다. 사람에게 오전·오후를 묻는다.
//   - 시간은 날짜처럼 칸에 적는다(24시간제 "14:00", 웹의 시간 칸과 같은 값). 시간 칩을 누르면 그 칸을 채우고,
//     "시간 없이 넣기"는 칸을 비운다. 사람이 적은 시간은 짐작이 아니라서 오전·오후를 묻지 않는다. "14:00" 꼴이
//     아니면 보내지 않고 고쳐 적어 달라고 한다. 비어 있으면 날짜만 넣는다.
//   - 업체가 적은 요일이 그 날짜의 달력 요일과 다르면(칩은 달력 요일을 보인다) 한 번 더 보라고 한 줄 둔다.
//   - 고를 웨딩홀이 없으면 날짜 칸도 단추도 없다. 그래서 "직접 골라 넣을 수 있어요"라고 말하지 않고, 웨딩홀을 담는
//     비교 화면으로 가는 단추를 둔다(`onOpenHalls`).
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import {
  VENDOR_REPLY_COPY,
  readVendorReply,
  type ConsultationPasteSchedulePost,
  type ConsultationReplyPaste,
  type ConsultationScheduleResult,
  type VendorReplyChip,
  type VendorReplyReading,
} from "@hanbang/shared/invitation";
import { Text, TextInput } from "@/components/ui/AppText";
import InvitationButton from "@/components/invitation/InvitationButton";
import { lineHeight, palette, typo } from "@/components/invitation/invitationStyle";
import {
  isScheduleTime,
  isScheduleYmd,
  kstTodayYmd,
  scheduleTimeParts,
  withMeridiem,
  type InvitationResult,
} from "@/lib/invitationApi.mjs";

type Halls = ConsultationReplyPaste["halls"];
type AddResult = InvitationResult<ConsultationScheduleResult> | null;
type OnAdd = (input: ConsultationPasteSchedulePost) => Promise<AddResult>;

type Props = {
  halls: Halls;
  /** 사람이 누른 "이 날짜로 일정에 넣기". 홀 ID·날짜·시간만 받는다. null 은 보내지 못한 것이다(로그인 확인 중). */
  onAdd: OnAdd;
  /** 고를 웨딩홀이 없을 때 "웨딩홀 보러 가기". 웨딩홀 비교 화면을 연다. */
  onOpenHalls: () => void;
};

/**
 * 고른 홀·날짜·시간. 날짜와 시간은 칸에 든 글자 그대로다(시간이 ""이면 시간 없이 넣는다). 칩을 누르면 칸을 채운다.
 * `meridiemPending` 이면 칩이 오전·오후를 짐작한 시간이라 아직 사람이 고르지 않았다.
 */
type Form = { hallId: string | null; date: string; time: string; meridiemPending: boolean };
type SetForm = Dispatch<SetStateAction<Form>>;
type Problem = "pickHall" | "pickDate" | "time" | "meridiem";

const PROBLEM_COPY: Record<Problem, string> = {
  pickHall: VENDOR_REPLY_COPY.pickHall,
  pickDate: VENDOR_REPLY_COPY.pickDate,
  time: VENDOR_REPLY_COPY.timeInvalid,
  meridiem: VENDOR_REPLY_COPY.meridiemQuestion,
};

/** 시간 칸의 보기. 틀리게 적었을 때의 말(`VENDOR_REPLY_COPY.timeInvalid`)과 같은 보기다. */
const TIME_PLACEHOLDER = "14:00";

export default function VendorReplyPaste({ halls, onAdd, onOpenHalls }: Props) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [reading, setReading] = useState<VendorReplyReading | null>(null);
  // 읽을 때마다 늘린다. 홀·날짜·시간은 새로 읽은 답마다 처음부터 고른다.
  const [readCount, setReadCount] = useState(0);

  const read = () => {
    if (raw.trim().length === 0) return;
    Keyboard.dismiss();
    setReading(readVendorReply(raw));
    // 원문은 읽자마자 비운다. 화면에는 가린 글만 남는다.
    setRaw("");
    setReadCount((count) => count + 1);
  };
  const again = () => {
    setReading(null);
    setRaw("");
  };
  const close = () => {
    setOpen(false);
    again();
  };

  if (!open) {
    return (
      <View style={styles.closed}>
        <Pill label={VENDOR_REPLY_COPY.open} onPress={() => setOpen(true)} />
      </View>
    );
  }
  return (
    <View style={styles.panel}>
      {reading ? (
        <ReplyReading key={readCount} reading={reading} halls={halls} onAdd={onAdd} onOpenHalls={onOpenHalls} />
      ) : (
        <PasteInput raw={raw} onChange={setRaw} onRead={read} />
      )}
      <View style={styles.row}>
        {reading ? <Pill label={VENDOR_REPLY_COPY.again} onPress={again} /> : null}
        <Pill label={VENDOR_REPLY_COPY.close} onPress={close} tone="plain" />
      </View>
    </View>
  );
}

function PasteInput({ raw, onChange, onRead }: { raw: string; onChange: (text: string) => void; onRead: () => void }) {
  return (
    <View style={styles.group}>
      <Text style={[typo.sans, styles.note]}>{VENDOR_REPLY_COPY.helper}</Text>
      <TextInput
        value={raw}
        onChangeText={onChange}
        multiline
        autoCorrect={false}
        // 붙여 넣은 원문(번호·계좌가 섞일 수 있다)을 안드로이드 자동 완성 서비스가 받는 화면 구조에 싣지 않는다.
        importantForAutofill="no"
        placeholder={VENDOR_REPLY_COPY.placeholder}
        placeholderTextColor={palette.muted}
        accessibilityLabel={VENDOR_REPLY_COPY.inputLabel}
        style={[typo.sans, styles.input]}
      />
      <Pill label={VENDOR_REPLY_COPY.read} onPress={raw.trim().length > 0 ? onRead : undefined} tone="ink" />
    </View>
  );
}

/** 칩 하나를 고르면 그 날짜·시간을 칸에 옮긴다. 금액·보증 인원·업체가 쓴 말은 보여 주기만 한다. */
function withChip(form: Form, chip: VendorReplyChip): Form {
  if (chip.kind === "date") return { ...form, date: chip.ymd };
  if (chip.kind === "datetime") return { ...form, date: chip.ymd, time: chip.time, meridiemPending: chip.meridiemGuessed };
  if (chip.kind === "time") return { ...form, time: chip.time, meridiemPending: chip.meridiemGuessed };
  return form;
}

/** 업체가 적은 요일이 달력과 다른 날짜가 하나라도 있는가. 여러 날짜가 어긋나도 한 줄로 알린다. */
function hasWeekdayMismatch(chips: readonly VendorReplyChip[]): boolean {
  return chips.some((chip) => (chip.kind === "date" || chip.kind === "datetime") && chip.weekdayMismatch);
}

function ReplyReading({ reading, halls, onAdd, onOpenHalls }: { reading: VendorReplyReading; halls: Halls; onAdd: OnAdd; onOpenHalls: () => void }) {
  // 담은 홀이 하나뿐이면 그 홀로 둔다. 날짜와 시간은 칩을 누르거나 칸에 적어 사람이 고른다.
  const [form, setForm] = useState<Form>({ hallId: halls.length === 1 ? halls[0].hallId : null, date: "", time: "", meridiemPending: false });
  const values = reading.chips.filter((chip) => chip.kind !== "phrase");
  const quotes = reading.chips.filter((chip) => chip.kind === "phrase");
  const foundNothing = !reading.chips.some((chip) => chip.kind === "date" || chip.kind === "datetime" || chip.kind === "price");
  return (
    <View style={styles.group}>
      <Text style={[typo.sansBold, styles.heading]}>{VENDOR_REPLY_COPY.foundHeading}</Text>
      <View style={styles.textBox}>
        <Text selectable style={[typo.sans, styles.masked]}>{reading.masked}</Text>
      </View>
      {reading.maskedCount > 0 ? <Text style={[typo.sans, styles.note]}>{VENDOR_REPLY_COPY.masked(reading.maskedCount)}</Text> : null}
      {reading.truncated ? <Text style={[typo.sans, styles.note]}>{VENDOR_REPLY_COPY.truncated}</Text> : null}
      {reading.caution ? <Text style={[typo.sansMedium, styles.note]}>{VENDOR_REPLY_COPY.caution}</Text> : null}
      {hasWeekdayMismatch(reading.chips) ? <Text style={[typo.sans, styles.note]}>{VENDOR_REPLY_COPY.weekdayMismatch}</Text> : null}
      {values.length > 0 ? (
        <View style={styles.wrap}>
          {values.map((chip, index) => (
            <ValueChip key={`${chip.kind}-${index}`} chip={chip} form={form} onPick={() => setForm((current) => withChip(current, chip))} />
          ))}
        </View>
      ) : null}
      {quotes.length > 0 ? (
        <View style={styles.group}>
          <Text style={[typo.sansMedium, styles.label]}>{VENDOR_REPLY_COPY.quoteLabel}</Text>
          {quotes.map((chip, index) => (
            <Text key={`quote-${index}`} style={[typo.sans, styles.quote]}>{chip.quote}</Text>
          ))}
        </View>
      ) : null}
      {foundNothing ? (
        // 고를 웨딩홀이 없으면 날짜 칸이 없으니 "직접 골라 넣을 수 있어요"까지 말하지 않는다.
        <Text style={[typo.sans, styles.note]}>{halls.length === 0 ? VENDOR_REPLY_COPY.noneOnly : VENDOR_REPLY_COPY.none}</Text>
      ) : null}
      {halls.length === 0 ? (
        <View style={styles.group}>
          <Text style={[typo.sans, styles.note]}>{VENDOR_REPLY_COPY.noHalls}</Text>
          <Pill label={VENDOR_REPLY_COPY.noHallsAction} onPress={onOpenHalls} />
        </View>
      ) : (
        <ScheduleForm form={form} setForm={setForm} halls={halls} onAdd={onAdd} />
      )}
    </View>
  );
}

function chipSelected(chip: VendorReplyChip, form: Form): boolean {
  if (chip.kind === "date") return form.date === chip.ymd;
  if (chip.kind === "datetime") return form.date === chip.ymd && form.time === chip.time;
  if (chip.kind === "time") return form.time === chip.time;
  return false;
}

function ValueChip({ chip, form, onPick }: { chip: VendorReplyChip; form: Form; onPick: () => void }) {
  // 날짜·시간은 눌러 칸에 옮긴다. 금액·보증 인원은 업체가 적은 값을 옮겨 보여 줄 뿐이라 누르지 않는다.
  if (chip.kind === "price" || chip.kind === "count" || chip.kind === "phrase") {
    return (
      <View style={styles.valueChip}>
        <Text style={[typo.sans, styles.chipText]}>{chip.label}</Text>
      </View>
    );
  }
  const selected = chipSelected(chip, form);
  return (
    <InvitationButton
      label={chip.label}
      onPress={onPick}
      selected={selected}
      variant={selected ? "ink" : "outline"}
      height={36}
      paddingHorizontal={14}
      fontSize={13}
    />
  );
}

/**
 * 보낼 세 칸. 빠지거나 틀린 것이 있으면 무엇을 고쳐야 하는지 돌려준다. 시간 칸이 비어 있으면 시간 없이 넣는다.
 * 붙여 넣은 글이나 칩의 따온 말은 싣지 않는다.
 */
function scheduleInput(form: Form): { ok: true; input: ConsultationPasteSchedulePost } | { ok: false; problem: Problem } {
  if (!form.hallId) return { ok: false, problem: "pickHall" };
  if (!isScheduleYmd(form.date)) return { ok: false, problem: "pickDate" };
  const time = typedTime(form.time);
  if (time !== "" && !isScheduleTime(time)) return { ok: false, problem: "time" };
  if (form.meridiemPending) return { ok: false, problem: "meridiem" };
  const input = time ? { hallId: form.hallId, date: form.date, time } : { hallId: form.hallId, date: form.date };
  return { ok: true, input };
}

/** 손으로 적은 "9:30" 은 "09:30" 으로 읽는다(웹의 시간 칸과 같은 꼴). 그 밖의 꼴은 그대로 두어 틀리면 시간 말을 보인다. */
function typedTime(value: string): string {
  return /^\d:[0-5]\d$/.test(value) ? `0${value}` : value;
}

function resultLine(result: AddResult): string {
  if (!result || !result.ok) return result?.message ?? VENDOR_REPLY_COPY.failed;
  if (result.data.added) return VENDOR_REPLY_COPY.added;
  return result.data.alreadyInCalendar ? VENDOR_REPLY_COPY.alreadyAdded : VENDOR_REPLY_COPY.failed;
}

function ScheduleForm({ form, setForm, halls, onAdd }: { form: Form; setForm: SetForm; halls: Halls; onAdd: OnAdd }) {
  const [adding, setAdding] = useState(false);
  // `adding` 은 다음 그리기 전까지 옛 값이다. 같은 순간의 두 번째 누름은 이 값이 막는다.
  const addingRef = useRef(false);
  // 한 줄은 그 줄을 만든 칸 값에 대한 말이다. 사람이 홀·날짜·시간을 바꾸면 옛 줄은 내린다.
  const [line, setLine] = useState<{ text: string; form: Form } | null>(null);

  const add = async () => {
    if (addingRef.current) return;
    const checked = scheduleInput(form);
    if (!checked.ok) {
      setLine({ text: PROBLEM_COPY[checked.problem], form });
      return;
    }
    addingRef.current = true;
    setAdding(true);
    setLine(null);
    try {
      setLine({ text: resultLine(await onAdd(checked.input)), form });
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
  const shownLine = line && line.form === form ? line.text : null;
  return (
    <View style={styles.group}>
      <HallPicker halls={halls} hallId={form.hallId} onPick={(hallId) => setForm((current) => ({ ...current, hallId }))} />
      <View style={styles.group}>
        <Text style={[typo.sansMedium, styles.label]}>{VENDOR_REPLY_COPY.dateLabel}</Text>
        <TextInput
          value={form.date}
          onChangeText={(text) => setForm((current) => ({ ...current, date: text.trim() }))}
          placeholder={kstTodayYmd(Date.now())}
          placeholderTextColor={palette.muted}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          autoCorrect={false}
          accessibilityLabel={VENDOR_REPLY_COPY.dateLabel}
          style={[typo.sans, styles.field]}
        />
      </View>
      <View style={styles.group}>
        <Text style={[typo.sansMedium, styles.label]}>{VENDOR_REPLY_COPY.timeLabel}</Text>
        <TextInput
          value={form.time}
          // 사람이 적은 시간은 짐작이 아니다. 칩이 짐작한 시간을 고쳐 적었으면 오전·오후도 더 묻지 않는다.
          onChangeText={(text) => setForm((current) => ({ ...current, time: text.trim(), meridiemPending: false }))}
          placeholder={TIME_PLACEHOLDER}
          placeholderTextColor={palette.muted}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          autoCorrect={false}
          accessibilityLabel={VENDOR_REPLY_COPY.timeLabel}
          style={[typo.sans, styles.field]}
        />
      </View>
      {form.time ? <TimeChoice time={typedTime(form.time)} pending={form.meridiemPending} setForm={setForm} /> : null}
      <Pill
        label={adding ? VENDOR_REPLY_COPY.adding : VENDOR_REPLY_COPY.add}
        onPress={adding ? undefined : () => {
          void add();
        }}
        tone="ink"
      />
      {shownLine ? <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.note]}>{shownLine}</Text> : null}
    </View>
  );
}

function HallPicker({ halls, hallId, onPick }: { halls: Halls; hallId: string | null; onPick: (hallId: string) => void }) {
  return (
    <View style={styles.group}>
      <Text style={[typo.sansMedium, styles.label]}>{VENDOR_REPLY_COPY.hallLabel}</Text>
      <View style={styles.wrap}>
        {halls.map((hall) => (
          <InvitationButton
            key={hall.hallId}
            label={hall.name}
            onPress={() => onPick(hall.hallId)}
            selected={hall.hallId === hallId}
            variant={hall.hallId === hallId ? "ink" : "outline"}
            height={36}
            paddingHorizontal={14}
            fontSize={13}
          />
        ))}
      </View>
    </View>
  );
}

function timeText(time: string): string | null {
  const parts = scheduleTimeParts(time);
  if (!parts) return null;
  return VENDOR_REPLY_COPY.timeChip(parts.meridiem === "am" ? VENDOR_REPLY_COPY.am : VENDOR_REPLY_COPY.pm, parts.hour12, parts.minute);
}

/**
 * 시간 칸 아래 줄. 칩이 짐작한 시간이면 오전·오후를 묻고, 아니면 칸의 시간을 오전·오후로 읽어 보인다(다 적었을 때).
 * "시간 없이 넣기"는 칸을 비운다.
 */
function TimeChoice({ time, pending, setForm }: { time: string; pending: boolean; setForm: SetForm }) {
  const choose = (meridiem: "am" | "pm") => {
    const chosen = withMeridiem(time, meridiem);
    if (chosen) setForm((current) => ({ ...current, time: chosen, meridiemPending: false }));
  };
  const am = withMeridiem(time, "am");
  const pm = withMeridiem(time, "pm");
  const readBack = timeText(time);
  return (
    <View style={styles.group}>
      {pending ? <Text style={[typo.sans, styles.note]}>{VENDOR_REPLY_COPY.meridiemQuestion}</Text> : null}
      <View style={styles.wrap}>
        {pending && am && pm ? (
          <>
            <Pill label={timeText(am) ?? VENDOR_REPLY_COPY.am} onPress={() => choose("am")} />
            <Pill label={timeText(pm) ?? VENDOR_REPLY_COPY.pm} onPress={() => choose("pm")} />
          </>
        ) : readBack ? (
          <View style={styles.valueChip}>
            <Text style={[typo.sans, styles.chipText]}>{readBack}</Text>
          </View>
        ) : null}
        <Pill label={VENDOR_REPLY_COPY.noTime} onPress={() => setForm((current) => ({ ...current, time: "", meridiemPending: false }))} tone="plain" />
      </View>
    </View>
  );
}

function Pill({ label, onPress, tone = "outline" }: { label: string; onPress?: () => void; tone?: "ink" | "outline" | "plain" }) {
  return (
    <InvitationButton
      label={label}
      onPress={onPress}
      variant={tone}
      height={tone === "plain" ? 36 : 40}
      paddingHorizontal={tone === "plain" ? 4 : 18}
      fontSize={13}
      weight={tone === "ink" ? "700" : "500"}
      underline={tone === "plain"}
      style={!onPress && styles.unavailable}
    />
  );
}

const styles = StyleSheet.create({
  closed: { alignSelf: "stretch", alignItems: "center" },
  panel: {
    alignSelf: "stretch",
    gap: 14,
    borderWidth: 1,
    borderColor: palette.ring,
    borderRadius: 18,
    padding: 16,
    backgroundColor: palette.white,
  },
  group: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  heading: { fontSize: 15, lineHeight: lineHeight(15, 1.45) },
  label: { fontSize: 13, lineHeight: lineHeight(13, 1.5), color: palette.body },
  note: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: palette.chipLine,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    lineHeight: lineHeight(15, 1.6),
    backgroundColor: palette.paperSoft,
    textAlignVertical: "top",
  },
  field: {
    height: 44,
    borderWidth: 1,
    borderColor: palette.chipLine,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: palette.paperSoft,
  },
  textBox: { backgroundColor: palette.paperSoft, borderRadius: 12, padding: 12 },
  masked: { fontSize: 14, lineHeight: lineHeight(14, 1.7), color: palette.letter },
  quote: {
    fontSize: 14,
    lineHeight: lineHeight(14, 1.6),
    color: palette.letter,
    borderLeftWidth: 2,
    borderLeftColor: palette.chipLine,
    paddingLeft: 10,
  },
  valueChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: palette.stone,
  },
  chipText: { fontSize: 13, color: palette.ink },
  unavailable: { opacity: 0.4 },
});
