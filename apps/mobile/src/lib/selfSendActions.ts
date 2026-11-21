// 직접 보내기(D-83 1단계, 2026-11-18): 아모라가 쓴 편지 글을 두 분 폰에서 보내는 길.
//
// 아모라 서버는 아무것도 보내지 않는다. 여기는 폰이 이미 가진 길만 연다.
//   - 복사: expo-clipboard(이미 앱에 들어 있다. 새 네이티브 모듈 없음, OTA).
//   - 공유: React Native `Share.share({ message })`. 카카오톡·문자처럼 사람이 고른 앱으로 간다.
//   - 문자: `sms:` 주소로 문자 앱을 연다. 받는 번호는 우리 자료에 없어 글만 채운다.
// 지키는 것:
//   - 글은 서버가 저장한 판으로 엮은 그대로다. 고치지 않고, 어디에도 적지 않는다(로그·저장소·알림 없음).
//   - `canOpenURL` 은 쓰지 않는다. 안드로이드 11 이상·iOS 는 따로 선언해야 답하고, 선언 없이 물으면 열 수
//     있는데도 "못 연다"고 답한다. 열어 보고, 못 열면 잡는다.
//   - 공유 창이나 문자 앱을 못 열면 글을 복사해 둔다. 사람이 문자나 카톡에 붙여 넣을 수 있게. 이때는 그냥
//     복사와 다르게 답한다("copiedInstead"): 누른 앱이 열리지 않았다는 것까지 사람이 알아야 한다.
//   - 네이버를 못 열면 그렇다고 답한다("findHallFailed"). 열렸으면 화면은 아무 말도 하지 않는다.
//   - 무엇이 열렸는지만 돌려준다. 보냈는지는 모른다(사람이 공유 창을 닫았을 수도 있다).
import * as Clipboard from "expo-clipboard";
import { Linking, Platform, Share } from "react-native";

/**
 * 화면이 사람에게 할 말을 고르는 값. "cancelled"(사람이 공유 창을 닫았다)와 "hallSearchOpened"(네이버를 열었다)는
 * 아무 말도 하지 않는다. 나머지는 같은 이름의 `SELF_SEND_COPY` 문장으로 말한다.
 */
export type SelfSendOutcome =
  | "copied"
  | "copiedInstead"
  | "copyFailed"
  | "shareOpened"
  | "smsOpened"
  | "hallSearchOpened"
  | "findHallFailed"
  | "cancelled";

/** 받는 번호 없이 본문만 채운 문자 주소. iOS 는 `sms:&body=`, 안드로이드는 `sms:?body=` 를 읽는다. */
export function smsHref(text: string, os: string): string {
  return `sms:${os === "ios" ? "&" : "?"}body=${encodeURIComponent(text)}`;
}

/** 네이버에서 홀 이름을 찾는 주소. 업체 연락처는 우리 자료에 없어서 사람이 찾아 보게 한다. */
export function hallSearchUrl(name: string): string {
  return `https://m.search.naver.com/search.naver?query=${encodeURIComponent(name)}`;
}

export async function copyLetterText(text: string): Promise<SelfSendOutcome> {
  try {
    // 웹에서는 복사하지 못하면 false 로 답한다. 네이티브는 true 다.
    const copied = await Clipboard.setStringAsync(text);
    return copied === false ? "copyFailed" : "copied";
  } catch {
    return "copyFailed";
  }
}

/** 공유 창이나 문자 앱을 열지 못했을 때 같은 글을 대신 복사한다. 복사했으면 앱을 못 열었다는 것까지 말하게 한다. */
async function copyInstead(text: string): Promise<SelfSendOutcome> {
  return (await copyLetterText(text)) === "copied" ? "copiedInstead" : "copyFailed";
}

export async function shareLetterText(text: string): Promise<SelfSendOutcome> {
  let result: Awaited<ReturnType<typeof Share.share>>;
  try {
    result = await Share.share({ message: text });
  } catch {
    return copyInstead(text);
  }
  // iOS 는 사람이 창을 닫으면 dismissedAction 으로 답한다. 안드로이드는 창이 열리면 sharedAction 이다.
  return result.action === Share.dismissedAction ? "cancelled" : "shareOpened";
}

export function openLetterSms(text: string): Promise<SelfSendOutcome> {
  return Linking.openURL(smsHref(text, Platform.OS))
    .then((): SelfSendOutcome => "smsOpened")
    .catch(() => copyInstead(text));
}

/** 홀 이름으로 네이버 검색을 연다. 브라우저를 열지 못하면 "findHallFailed"(화면이 그 홀의 글 아래에서 말한다). */
export function openHallSearch(name: string): Promise<SelfSendOutcome> {
  return Linking.openURL(hallSearchUrl(name)).then(
    (): SelfSendOutcome => "hallSearchOpened",
    (): SelfSendOutcome => "findHallFailed",
  );
}
