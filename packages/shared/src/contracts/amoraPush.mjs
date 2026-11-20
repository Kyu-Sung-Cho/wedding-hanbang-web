// 아모라 앱 알림(결정 D-86, 설계 25장 2절)의 웹·앱 공용 계약.
//
// 알림에는 내용을 넣지 않는다. 잠금화면에 보이는 것은 아래 고정 문장뿐이고, 알림 자료(data)에는 보낸 기록 id 와
// 열 화면 이름만 든다(이름·날짜·업체·금액·대화 글 없음). 문장은 파운더가 정한다(18장 D-12).
//
// 받을 사람·시간·상한은 서버(`sendAmoraPush`)와 DB(`claim_amora_push_delivery`)가 지킨다. 앱은 알림을 눌렀을 때
// 이 모양이 맞는지만 보고, 맞으면 그 화면을 연다(그 화면은 늘 지금 로그인한 사람의 자료만 읽는다).

export const AMORA_PUSH_COPY = Object.freeze({
  title: "웨딩한방",
  body: "아모라가 정리한 게 있어요.",
});

/** 하루 상한(한국 날짜마다). DB 함수 `claim_amora_push_delivery` 의 `v_daily_cap` 과 같다. */
export const AMORA_PUSH_DAILY_CAP = 2;

/** 보내는 시간(한국 시각). 끝 시각은 들어가지 않는다(오전 9시부터 오후 8시 전까지). */
export const AMORA_PUSH_WINDOW = Object.freeze({ startHour: 9, endHour: 20 });

export const AMORA_PUSH_KINDS = Object.freeze(["today_one", "task_done"]);
export const AMORA_PUSH_ROUTES = Object.freeze(["home", "chat"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const KST_HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  hourCycle: "h23",
});

/** 한국 시각 0~23. */
export function kstHour(date = new Date()) {
  return Number(KST_HOUR_FORMATTER.format(date));
}

/** 지금 보내도 되는 시간인가(09:00 이상 20:00 미만, 한국 시각). */
export function isWithinAmoraPushWindow(date = new Date()) {
  const hour = kstHour(date);
  return hour >= AMORA_PUSH_WINDOW.startHour && hour < AMORA_PUSH_WINDOW.endHour;
}

/** 꺼져 있던 기기가 늦게 받을 수 있는 가장 긴 시간(초). */
export const AMORA_PUSH_MAX_TTL_SECONDS = 4 * 60 * 60;

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * 알림을 늦게 받을 수 있는 시간(초). 기기가 꺼져 있다가 켜져도 받는 시간이 끝난 뒤에는 오지 않게, 받는 시간이 끝나는
 * 시각까지로 줄인다. `windowEndsAt` 은 DB(`claim_amora_push_delivery`)가 그 사람의 받는 시간으로 정한 끝 시각이고,
 * 없거나 잘못된 값이면 오늘 오후 8시(한국 시각)로 본다. 0 이면 보내지 않는다.
 */
export function amoraPushTtlSeconds({ now = new Date(), windowEndsAt } = {}) {
  const endHour = String(AMORA_PUSH_WINDOW.endHour).padStart(2, "0");
  const windowEnd = Date.parse(`${KST_DATE_FORMATTER.format(now)}T${endHour}:00:00+09:00`);
  const personalEnd = typeof windowEndsAt === "string" ? Date.parse(windowEndsAt) : Number.NaN;
  const end = Number.isFinite(personalEnd) ? Math.min(personalEnd, windowEnd) : windowEnd;
  const seconds = Math.floor((end - now.getTime()) / 1000);
  return Math.max(0, Math.min(AMORA_PUSH_MAX_TTL_SECONDS, seconds));
}

export function isAmoraPushKind(value) {
  return typeof value === "string" && AMORA_PUSH_KINDS.includes(value);
}

export function isAmoraPushRoute(value) {
  return typeof value === "string" && AMORA_PUSH_ROUTES.includes(value);
}

export function buildAmoraPushMessage({ to, deliveryId, route, ttlSeconds }) {
  if (
    typeof to !== "string" || !UUID_PATTERN.test(deliveryId ?? "") || !isAmoraPushRoute(route)
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > AMORA_PUSH_MAX_TTL_SECONDS
  ) {
    throw new Error("AMORA_PUSH_MESSAGE_INVALID");
  }
  return Object.freeze({
    to,
    title: AMORA_PUSH_COPY.title,
    body: AMORA_PUSH_COPY.body,
    data: Object.freeze({ type: "amora", deliveryId: deliveryId.toLowerCase(), route }),
    sound: "default",
    // 같은 날 두 번째 알림이 첫 알림을 덮는다(잠금화면에 같은 문장이 쌓이지 않게).
    collapseId: "amora",
    tag: "amora",
    // 받는 시간이 끝나면 기기가 꺼져 있었어도 더는 건네지 않는다(오후 8시 뒤에 오지 않게).
    ttl: ttlSeconds,
    priority: "normal",
  });
}

/** 알림 자료가 아모라 알림 모양과 정확히 같은가. 아니면 null. */
export function parseAmoraPushData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.every((key) => ["type", "deliveryId", "route"].includes(key))) return null;
  if (value.type !== "amora" || typeof value.deliveryId !== "string" || !UUID_PATTERN.test(value.deliveryId)) {
    return null;
  }
  if (!isAmoraPushRoute(value.route)) return null;
  return Object.freeze({ deliveryId: value.deliveryId.toLowerCase(), route: value.route });
}
