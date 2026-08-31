// 아모라 답변이 AI 생성물임을 앱 화면에서 볼 수 있는가.
//
// ## 무엇이 있었나 (2026-08-28 감사)
//
// 모바일 아모라 대화 화면에 AI 생성 표시가 **한 곳도 없었다.** 헤더는
// "아모라 / 결혼 준비 동반자" 뿐이고, 앱 전체에서 "AI 생성"·"인공지능"·
// "ai-policy" 를 찾으면 제품 히트가 커뮤니티 출처 라벨 1건뿐이었다. 설정에도
// 이용약관·개인정보처리방침 둘만 있고 AI 정책 링크가 없었다.
//
// 그런데 **약관과 AI 정책 문서는 표시가 포함된다고 대외에 공표하고 있었고**,
// 웹은 `ChatContent` 헤더에 같은 배지를 늘 그린다. 주 제품인 앱에서만 사용자가
// 그 표시를 한 번도 보지 못했다.
//
// 두 화면이 같은 사실을 다르게 말하면 안 되므로 **웹과 같은 문구**를 쓴다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const chat = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
  "utf8",
);
const settings = readFileSync(
  fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url)),
  "utf8",
);
const web = readFileSync(
  fileURLToPath(new URL("../../../web/src/components/app/chat/ChatContent.tsx", import.meta.url)),
  "utf8",
);

/**
 * 주석을 걷어낸 소스.
 *
 * 이 검사는 **화면에 나가는 문구**를 보는데, 원문을 그대로 보면 "왜 이 표시가
 * 필요한가" 를 설명하는 주석이 대신 답한다. 이 저장소에서 실제로 그렇게 잘못된
 * 초록불이 난 적이 있다.
 */
function withoutComments(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

const chatVisible = withoutComments(chat);
const settingsVisible = withoutComments(settings);

test("대화 화면이 AI 생성 답변임을 표시한다", () => {
  assert.match(chatVisible, /AI 생성 답변/u, "AI 생성 표시가 없습니다");
  assert.match(
    chatVisible,
    /계약·가격·중요 일정은 원문을 다시 확인해 주세요/u,
    "한계 안내가 없습니다",
  );
});

test("웹과 같은 문구를 쓴다", () => {
  // 같은 사실을 두 화면이 다르게 말하면 어느 쪽이 참인지 사용자가 알 수 없다.
  const webVisible = withoutComments(web);
  for (const phrase of ["AI 생성 답변", "계약·가격·중요 일정은 원문을 다시 확인해 주세요"]) {
    assert.ok(webVisible.includes(phrase), `웹에서 ${phrase} 가 사라졌습니다`);
    assert.ok(chatVisible.includes(phrase), `모바일에 ${phrase} 가 없습니다`);
  }
});

test("AI 정책으로 가는 길이 앱 안에 있다", () => {
  // 표시만 하고 갈 곳이 없으면 "더 자세한 내용은 AI 정책에" 라는 약속이 빈다.
  assert.match(chatVisible, /AI 정책/u, "대화 화면에 AI 정책 링크가 없습니다");
  assert.match(settingsVisible, /title="AI 정책"/u, "설정에 AI 정책 항목이 없습니다");
});

test("주소를 손으로 짓지 않는다", () => {
  // siteUrl 헬퍼는 운영에서 EXPO_PUBLIC_SITE_URL 이 없거나 안전하지 않으면 던진다.
  // 하드코딩하면 그 보호가 사라진다.
  for (const [label, source] of [["chat", chat], ["settings", settings]]) {
    assert.match(
      source,
      /buildMobileSiteUrl\("\/ai-policy", \w+\)/u,
      `${label}: AI 정책 주소를 헬퍼로 짓지 않습니다`,
    );
    assert.equal(
      source.includes('"https://hanbang.ai/ai-policy"'),
      false,
      `${label}: AI 정책 주소를 하드코딩했습니다`,
    );
  }
});

test("고지가 스크린리더에서 링크로 읽힌다", () => {
  // 이 저장소에는 `accessible` 한 단어가 자식 버튼을 삼켜 VoiceOver 로 누를 수
  // 없게 된 이력이 있다. 여는 태그부터 읽어야 잡힌다.
  const at = chat.indexOf("st.aiNotice");
  assert.ok(at > -1, "고지 블록이 없습니다");
  const opensAt = chat.lastIndexOf("<View", at);
  const block = chat.slice(opensAt, at + 900);
  assert.equal(
    /\baccessible\b(?!\w)/u.test(block),
    false,
    "accessible 이 자식 링크를 삼킵니다",
  );
  assert.match(block, /accessibilityRole="link"/u);
});
