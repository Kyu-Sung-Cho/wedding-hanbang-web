/**
 * 초대 코드를 파트너에게 **보낼 수 있는가**를 지키는 테스트.
 *
 * 이 앱의 테스트는 TypeScript를 실행하지 못한다(`node --test`가 .mjs만 돌린다).
 * 그래서 화면과 계약은 소스를 읽어 배선을 확인하고, 순수 로직(.mjs)은 실제로
 * 불러서 동작을 확인한다. 여기서 지키려는 것은 렌더링 결과가 아니라 "사람이
 * 코드를 손으로 옮겨 적지 않아도 되는가"라는 사실이다.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  PENDING_INVITE_STORAGE_KEY,
  PENDING_INVITE_TTL_MS,
  clearPendingCoupleInviteCode,
  consumePendingCoupleInviteCode,
  parsePendingInvite,
  peekPendingCoupleInviteCode,
  rememberPendingCoupleInviteCode,
  serializePendingInvite,
} from "../lib/pendingCoupleInvite.mjs";

/** expo-secure-store 모양의 가짜 저장소. 테스트는 네이티브 모듈을 쓸 수 없다. */
function fakeStorage(initial = {}) {
  const box = { ...initial };
  return {
    box,
    async getItemAsync(key) {
      return Object.hasOwn(box, key) ? box[key] : null;
    },
    async setItemAsync(key, value) {
      box[key] = value;
    },
    async deleteItemAsync(key) {
      delete box[key];
    },
  };
}

const read = (relativePath) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8",
);

const cardSource = read("../components/invite/InviteCodeCard.tsx");
const onboardingSource = read("../../app/onboarding/index.tsx");
const settingsSource = read("../../app/settings/index.tsx");
const inviteLandingSource = read("../../app/invite.tsx");
const rootLayoutSource = read("../../app/_layout.tsx");
const pendingInviteSource = read("../lib/pendingCoupleInvite.mjs");
const appJsonSource = read("../../app.json");
const packageJsonSource = read("../../package.json");
const linkContractSource = read(
  "../../../../packages/shared/src/contracts/coupleInviteLink.ts",
);
const codeContractSource = read(
  "../../../../packages/shared/src/contracts/coupleInviteCode.ts",
);

// (a) 코드가 없으면 카드가 아무것도 그리지 않는다.
test("the invite card renders nothing without a well-formed code", () => {
  // 연결이 끝나면 /api/couple/code는 inviteCode: null을 준다(의도된 fail-closed).
  // 그때 빈 QR이나 "null" 글자가 그려지면, 이미 연결된 사람에게 아직 초대할 것이
  // 남은 것처럼 보인다.
  assert.match(cardSource, /const validCode = isCoupleInviteCode\(normalizedCode\)\s*\?\s*normalizedCode\s*:\s*null;/);
  assert.match(cardSource, /if \(!validCode\) return null;/);
  // 검사를 통과한 값만 화면에 나간다 — 서버가 준 원본을 그대로 그리지 않는다.
  assert.doesNotMatch(cardSource, /\{code\}/);
});

// (b) QR 값은 '#' 뒤에 코드를 담은 https 링크다.
test("the QR encodes the https link that keeps the code behind the fragment", () => {
  // 정본: 코드는 경로·쿼리가 아니라 `#` 뒤에 있다. 경로에 실으면 서버 접근 로그와
  // 리퍼러에 열쇠가 쌓인다.
  assert.match(linkContractSource, /COUPLE_INVITE_LANDING_PATH = "\/invite"/);
  assert.match(
    linkContractSource,
    /return `\$\{base\.origin\}\$\{COUPLE_INVITE_LANDING_PATH\}#\$\{code\}`;/,
  );
  // 계약은 https/http만 통과시킨다 — 커스텀 스킴이 QR에 들어가면 기본 카메라가 못 연다.
  assert.match(
    linkContractSource,
    /if \(base\.protocol !== "https:" && base\.protocol !== "http:"\) return null;/,
  );

  // 카드는 그 계약이 만든 문자열을 그대로 QR 값으로 쓴다.
  assert.match(cardSource, /buildCoupleInviteShareUrl\(\{ code: validCode, origin: resolveShareOrigin\(\) \}\)/);
  assert.match(cardSource, /<QRCode[\s\S]{0,200}value=\{shareUrl\}/);
  // origin을 못 구하면 QR을 아예 그리지 않는다 — 깨진 링크를 보내는 것보다 낫다.
  assert.match(cardSource, /\{shareUrl \? \(/);
  assert.match(cardSource, /catch \{\s*return null;\s*\}/);
  // 앱 전용 스킴은 QR에 들어가지 않는다.
  assert.doesNotMatch(cardSource, /buildCoupleInviteAppLink/);
});

// (c) 완료 화면에 복사·공유가 실제로 배선돼 있다.
test("the onboarding done screen wires copy and share instead of plain text", () => {
  // 예전에는 코드가 Text 세 줄이라 누를 수 있는 것이 0개였다.
  assert.doesNotMatch(onboardingSource, /styles\.codeValue/);
  assert.doesNotMatch(onboardingSource, /이 코드를 파트너에게 보내주세요/);

  assert.match(
    onboardingSource,
    /<InviteCodeCard[\s\S]{0,300}code=\{resultCode\}[\s\S]{0,300}onCopy=\{copyResultCode\}/,
  );
  assert.match(onboardingSource, /Clipboard\.setStringAsync\(resultCode\)/);

  // 카드 안에서 복사와 공유가 각각 눌리는 자리로 연결돼 있다.
  assert.match(cardSource, /onPress=\{onCopy\}/);
  assert.match(cardSource, /onPress=\{handleShare\}/);
  assert.match(cardSource, /await Share\.share\(\{ message: shareMessage \}\)/);
  assert.match(cardSource, /buildCoupleInviteShareMessage\(/);
});

// (d) 카메라 권한은 늘어나지 않았다.
test("drawing a QR never adds a camera permission or a native scanner", () => {
  // 권한이 늘면 스토어 개인정보 고지가 바뀌고 OTA 배포가 막힌다. 우리는 QR을
  // 그려서 보여주기만 하고, 읽는 쪽은 파트너 폰의 기본 카메라다.
  const appConfig = JSON.parse(appJsonSource);
  const infoPlist = appConfig.expo.ios.infoPlist ?? {};
  assert.equal(Object.keys(infoPlist).includes("NSCameraUsageDescription"), false);
  assert.equal(appConfig.expo.android.permissions, undefined);

  const pluginNames = appConfig.expo.plugins.map(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin),
  );
  for (const cameraPlugin of ["expo-camera", "expo-barcode-scanner"]) {
    assert.equal(pluginNames.includes(cameraPlugin), false);
  }
  // 사진 선택기의 카메라·마이크는 계속 꺼져 있어야 한다 — QR을 그린다고 이게 켜질
  // 이유가 없고, 켜지는 순간 스토어 고지가 바뀐다.
  const imagePicker = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker",
  );
  assert.equal(imagePicker[1].cameraPermission, false);
  assert.equal(imagePicker[1].microphonePermission, false);

  const pkg = JSON.parse(packageJsonSource);
  for (const nativeScanner of [
    "expo-camera",
    "expo-barcode-scanner",
    "react-native-vision-camera",
    "react-native-camera",
  ]) {
    assert.equal(
      Object.hasOwn(pkg.dependencies, nativeScanner),
      false,
      `${nativeScanner}가 의존성에 추가됐습니다`,
    );
  }

  // QR 라이브러리는 순수 JS다(react-native-svg 위에서 그린다).
  assert.equal(pkg.dependencies["react-native-qrcode-svg"], "^6.3.21");
  assert.match(cardSource, /import QRCode from "react-native-qrcode-svg";/);
  // 안내 문구가 없는 기능(앱 내 스캐너)을 있다고 말하지 않는다.
  assert.match(cardSource, /파트너 폰의 기본 카메라로/);
  // 화면에 나가는 부분만 본다 — 주석에서는 "스캐너를 넣지 않았다"고 말할 수 있어야 한다.
  const cardMarkup = cardSource.slice(cardSource.indexOf("  return ("));
  assert.doesNotMatch(cardMarkup, /스캔|스캐너|찍어|촬영/);
});

test("the settings screen keeps its own clipboard path instead of letting the card copy", () => {
  // 설정 화면의 복사는 지금 로그인한 사람의 코드인지 확인한 뒤에 일어난다.
  // 카드가 클립보드를 직접 만지면 그 방어를 우회하는 두 번째 경로가 생긴다.
  assert.doesNotMatch(cardSource, /expo-clipboard|Clipboard\./);
  assert.match(settingsSource, /<InviteCodeCard[\s\S]{0,400}onCopy=\{copyInviteCode\}/);
  assert.match(
    settingsSource,
    /code=\{coupleConnection\.inviteCode\}/,
  );
  // 초대 UI는 여전히 awaiting_partner 국면에서만 그려진다.
  assert.match(
    settingsSource,
    /phase === "awaiting_partner" \? \([\s\S]{0,700}<InviteCodeCard/,
  );
});

test("the deep link landing reads the code from the fragment and is registered", () => {
  assert.match(inviteLandingSource, /parseCoupleInviteFragment\(linkingUrl\)/);
  // 저장소를 함께 넘겨야 앱이 회수돼도 코드가 남는다(이메일 인증 왕복).
  assert.match(
    inviteLandingSource,
    /rememberPendingCoupleInviteCode\(code, \{ storage: SecureStore \}\)/,
  );
  // 로그인 상태면 루트 게이트로, 아니면 로그인 화면으로. 게이트 판단을 복제하지 않는다.
  assert.match(inviteLandingSource, /router\.replace\(signedIn \? "\/" : "\/\(auth\)\/login"\)/);
  assert.match(rootLayoutSource, /<Stack\.Screen name="invite"/);

  // 링크로 받은 코드는 "코드로 합류" 경로에 앉는다 — 역할 선택은 건너뛰지 않는다.
  assert.match(
    onboardingSource,
    /consumePendingCoupleInviteCode\(\{\s*storage: SecureStore,\s*\}\)/,
  );
  assert.match(onboardingSource, /setCoupleAction\("join"\);\s*\n\s*setInviteCode\(linkedCode\);/);
  assert.doesNotMatch(onboardingSource, /setStep\(2\)/);
});

test("the pending invite code survives the login round trip and is handed over exactly once", async () => {
  await clearPendingCoupleInviteCode();

  assert.equal(
    await rememberPendingCoupleInviteCode("wh-a3f91b2c7d40"),
    "WH-A3F91B2C7D40",
  );
  assert.equal(peekPendingCoupleInviteCode(), "WH-A3F91B2C7D40");
  assert.equal(await consumePendingCoupleInviteCode(), "WH-A3F91B2C7D40");
  // 한 번만 쓰인다 — 온보딩을 마치고 다시 들어왔을 때 예전 링크의 코드가 되살아나면
  // 이미 연결된 사람이 남의 코드로 합류를 시도한다.
  assert.equal(await consumePendingCoupleInviteCode(), null);

  // 형식이 아니면 들고 있지 않는다. 이 값은 앱 밖(딥링크 URL)에서 온 문자열이다.
  await rememberPendingCoupleInviteCode("WH-A3F91B2C7D40");
  assert.equal(await rememberPendingCoupleInviteCode("WH-SHORT"), null);
  assert.equal(peekPendingCoupleInviteCode(), null);
  for (const junk of [null, undefined, 42, "", "javascript:alert(1)", "WH-!!!"]) {
    assert.equal(await rememberPendingCoupleInviteCode(junk), null);
  }
});

test("the code outlives an app restart during email verification, but not the day", async () => {
  // 초대받는 사람의 주 경로는 계정 없는 파트너이고, 가입은 이메일 확인을 강제한다.
  // 그 사람은 반드시 앱을 나갔다 오므로, OS가 앱을 회수해도 코드가 남아야 한다.
  const storage = fakeStorage();
  const linkOpened = 1_000_000;

  await rememberPendingCoupleInviteCode("WH-A3F91B2C7D40", {
    storage,
    now: linkOpened,
  });
  assert.ok(storage.box[PENDING_INVITE_STORAGE_KEY], "저장되지 않았습니다");

  // 앱이 회수돼 메모리가 비었다.
  await clearPendingCoupleInviteCode();

  const afterEmail = await consumePendingCoupleInviteCode({
    storage,
    now: linkOpened + 5 * 60 * 1000,
  });
  assert.equal(afterEmail, "WH-A3F91B2C7D40");
  // 꺼내면서 지운다. 열쇠를 폰에 남겨두지 않는다.
  assert.equal(storage.box[PENDING_INVITE_STORAGE_KEY], undefined);

  // 만료된 값은 없는 것과 같다 — 며칠 뒤 다른 사람이 그 폰을 켜도 코드가 살아나면 안 된다.
  const stale = fakeStorage({
    [PENDING_INVITE_STORAGE_KEY]: serializePendingInvite(
      "WH-A3F91B2C7D40",
      linkOpened,
    ),
  });
  await clearPendingCoupleInviteCode();
  assert.equal(
    await consumePendingCoupleInviteCode({
      storage: stale,
      now: linkOpened + PENDING_INVITE_TTL_MS + 1,
    }),
    null,
  );

  // 시계가 뒤로 돌아가 저장된 값이 영영 만료되지 않는 경우도 버린다.
  assert.equal(
    parsePendingInvite(
      serializePendingInvite("WH-A3F91B2C7D40", linkOpened),
      linkOpened - 1,
    ),
    null,
  );
  // 모양이 깨진 값에 흔들리지 않는다.
  for (const junk of ["", "{", "null", '{"code":"WH-A3F91B2C7D40"}', '{"savedAt":1}']) {
    assert.equal(parsePendingInvite(junk, linkOpened), null);
  }
});

test("the pending store normalizes exactly like the contract it copies", () => {
  // 정본을 그대로 import하지 못하는 이유는 계약이 TypeScript이기 때문이다.
  // 예전에는 정규식만 맞춰 봤는데, 그동안 `.slice(...)` 한 줄이 빠져 있어서
  // 정본이 잘라서 통과시키는 긴 입력을 앱만 거절했다. 그래서 이제 정규화 세 단계를
  // 모두 맞춰 보고, 동작도 함께 확인한다.
  const canonical = /const COUPLE_INVITE_CODE_RE = (\/\S+\/u);/.exec(codeContractSource);
  assert.ok(canonical, "계약의 초대 코드 패턴을 찾지 못했습니다");
  const local = /const COUPLE_INVITE_CODE_RE = (\/\S+\/u);/.exec(pendingInviteSource);
  assert.ok(local, "앱 저장소의 초대 코드 패턴을 찾지 못했습니다");
  assert.equal(local[1], canonical[1]);

  for (const step of [
    /\.toUpperCase\(\)/,
    /\.replace\(\/\[\^A-Z0-9-\]\/gu, ""\)/,
    /\.slice\(0, COUPLE_INVITE_CODE_MAX_LENGTH\)/,
  ]) {
    assert.match(codeContractSource, step);
    assert.match(pendingInviteSource, step);
  }
  assert.match(
    pendingInviteSource,
    /const COUPLE_INVITE_CODE_MAX_LENGTH = 15;/,
  );
  assert.match(
    codeContractSource,
    /COUPLE_INVITE_CODE_MAX_LENGTH = 15;/,
  );
});
