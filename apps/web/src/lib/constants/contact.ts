export const CONTACT = {
  /**
   * 고객 문의 주소. **여기 한 곳에만 적는다.**
   *
   * 예전에는 `support@hanbang.ai` 였고, 이 자리에 "그 주소가 메일을 실제로 받는지
   * 확인하라"는 TODO 가 달려 있었다. 확인해 보니 **받지 않았다** — 그런데 그 사이
   * 여덟 군데가 이 상수를 안 쓰고 주소를 직접 박아 두어서, 한 곳을 고쳐도 나머지가
   * 옛 주소를 계속 말하는 상태였다. 그중 셋이 약관·개인정보 처리방침·AI 고지였다.
   *
   * 2026-08-22 파운더 지시로 `contact@hanbang.ai` 로 바꾸고, 박혀 있던 자리를 전부
   * 이 상수로 모았다. `contactAddressIsSingleSourced.test.ts` 가 다시 박히는 것을 막는다.
   */
  email: "contact@hanbang.ai",
  // TODO(HUMAN): Decide the public representative phone number before exposing phone UI.
  phone: null as string | null,
  phoneHref: null as string | null,
  hours: "평일 10:00 - 18:00",
  lunch: "점심 12:00 - 13:00",
  instagramLabel: "Instagram @wedding_hanbang",
  instagramHref: "https://instagram.com/wedding_hanbang",
} as const;
