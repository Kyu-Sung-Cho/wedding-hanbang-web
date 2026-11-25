/**
 * 상담 문의(W4 파일럿)의 스위치 셋. 모두 서버 환경값이고 기본은 꺼짐이다(WS5).
 *
 *   INQUIRY_SENDING_ENV          "true" 일 때만 승인된 편지를 운영자 대기열에 넣는다. 다른 값은 모두 꺼짐.
 *                                꺼져 있으면 승인은 저장되고 대기열에는 아무것도 들어가지 않는다. 꺼진 동안의
 *                                승인은 켜진 뒤 대기열로 이어지지 않는다(켜진 뒤 다시 승인해야 한다).
 *   INQUIRY_DAILY_CAP_ENV        커플마다 한국 날짜로 하루에 대기열에 넣을 수 있는 곳의 수. 비어 있으면 5.
 *                                숫자가 아니거나 범위(1~50) 밖이면 0 으로 보고 아무것도 넣지 않는다.
 *   INQUIRY_GLOBAL_DAILY_CAP_ENV 서비스 전체가 한국 날짜로 하루에 대기열에 넣을 수 있는 곳의 수(0~1000).
 *                                닫힌 채 실패한다: 비어 있거나 틀리면 0 으로 보고 아무것도 넣지 않는다.
 *   INQUIRY_SELF_SEND_ENV        "true" 일 때만 커플이 편지를 자기 폰에서 직접 보낸다(D-83 1단계). 서버는 아무것도
 *                                보내지 않는다. 편지 응답에 받는 곳마다 보낼 글을 싣고, 승인 경로는 승인을 받지 않으며,
 *                                상담 화면에 받은 답 붙여 넣기를 연다. INQUIRY_SENDING_ENV 가 "true" 이면 운영자
 *                                대기열이 이기고 이 스위치는 꺼진 것으로 본다. 꺼져 있으면 모든 응답이 이 스위치 전과 같다.
 *                                켜기 전에: 직접 보내기·받은 답 붙여 넣기 화면이 든 앱 업데이트를 먼저 내고 퍼진 것을
 *                                확인한다. PR #531 의 청첩장 화면은 있고 이 화면들은 없는 앱은 승인이 409 로 막혀 앱을
 *                                업데이트하거나 화면을 새로 고치라는 말을 듣는다. 새로 고쳐도 같은 승인 단추가 나와
 *                                업데이트만 길이다. 붙여 넣어 넣은 상담도 몰라 아직 잡힌 상담이 없다고 한다.
 *                                켜기 전에 나간 편지 승인 요청 알림은 읽음 처리하거나 새 판을 저장할 때까지 그대로 남는다.
 *
 * 운영에서 켜는 것은 파운더 결정(D-19)이다. 켜도 보내는 일은 사람(운영자 또는 커플 자신)이 한다.
 */

export const INQUIRY_SENDING_ENV = "HALL_INQUIRY_SENDING_ENABLED";
export const INQUIRY_DAILY_CAP_ENV = "HALL_INQUIRY_DAILY_CAP";
export const INQUIRY_GLOBAL_DAILY_CAP_ENV = "HALL_INQUIRY_GLOBAL_DAILY_CAP";
export const INQUIRY_SELF_SEND_ENV = "HALL_INQUIRY_SELF_SEND_ENABLED";

export const DEFAULT_INQUIRY_DAILY_CAP = 5;
export const MAX_INQUIRY_DAILY_CAP = 50;
export const MAX_INQUIRY_GLOBAL_DAILY_CAP = 1000;

type Env = Record<string, string | undefined>;

export function isInquirySendingEnabled(env: Env = process.env): boolean {
  return env[INQUIRY_SENDING_ENV] === "true";
}

/** 커플이 직접 보내기(D-83 1단계). 운영자 대기열이 켜져 있으면 늘 꺼짐이다: 두 길이 한꺼번에 열리지 않는다. */
export function isInquirySelfSendEnabled(env: Env = process.env): boolean {
  return env[INQUIRY_SELF_SEND_ENV] === "true" && !isInquirySendingEnabled(env);
}

export type InquiryDailyCap = { value: number; misconfigured: boolean };

export function inquiryDailyCap(env: Env = process.env): InquiryDailyCap {
  const raw = env[INQUIRY_DAILY_CAP_ENV]?.trim();
  if (raw === undefined || raw === "") return { value: DEFAULT_INQUIRY_DAILY_CAP, misconfigured: false };
  if (!/^\d{1,3}$/.test(raw)) return { value: 0, misconfigured: true };
  const value = Number(raw);
  if (value < 1 || value > MAX_INQUIRY_DAILY_CAP) return { value: 0, misconfigured: true };
  return { value, misconfigured: false };
}

/** 서비스 전체 하루 상한. 값이 없거나 틀리면 0(아무것도 넣지 않음)이고 misconfigured 로 알린다. */
export function inquiryGlobalDailyCap(env: Env = process.env): InquiryDailyCap {
  const raw = env[INQUIRY_GLOBAL_DAILY_CAP_ENV]?.trim();
  if (raw === undefined || raw === "" || !/^\d{1,4}$/.test(raw)) return { value: 0, misconfigured: true };
  const value = Number(raw);
  if (value > MAX_INQUIRY_GLOBAL_DAILY_CAP) return { value: 0, misconfigured: true };
  return { value, misconfigured: false };
}
