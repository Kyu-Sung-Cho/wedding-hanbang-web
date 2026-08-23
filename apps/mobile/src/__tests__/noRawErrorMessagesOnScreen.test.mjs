import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

/**
 * 영어 오류 원문이 화면에 그대로 나가지 않는가.
 *
 * ## 왜 목록이 아니라 훑기인가
 *
 * PR #176 에서 세 곳을 고쳤다. 그런데 같은 모양이 **다섯 곳 더** 남아 있었다 —
 * 온보딩 제출, 15초 후기, 예약 결과, 커플 재시작, 탈퇴. 손으로 적은 목록으로
 * 고쳤기 때문이다.
 *
 *     Alert.alert("오류", err instanceof Error ? err.message : "저장에 실패했어요")
 *
 * `apiFetch` 가 네트워크로 실패하면 여기 오는 것은 "Network request failed" 다.
 * 한국어 앱에서 영어 문장이 뜬다. 온보딩은 신규 사용자가 제품에서 **처음 보는**
 * 화면이다.
 *
 * 그래서 자리를 세지 않고 **모양을 금지한다.** 새 화면이 같은 실수를 하면 여기서
 * 깨진다.
 */

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

/** 잡은 오류의 message 를 그대로 사용자 문구로 쓰는 모양. */
const RAW_MESSAGE_RE =
  /\b(?:err|error|e)\s+instanceof\s+Error\s*\?\s*(?:err|error|e)\.message/u;

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(?:ts|tsx)$/u.test(entry) || entry.includes(".test.")) continue;
    found.push(full);
  }
  return found;
}

test("잡은 오류의 원문을 화면 문구로 쓰지 않는다", () => {
  const offenders = [];
  for (const file of [...sourceFiles(join(appRoot, "app")), ...sourceFiles(join(appRoot, "src"))]) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, index) => {
      if (RAW_MESSAGE_RE.test(line)) {
        offenders.push(`${file.slice(appRoot.length).replace(/\\/gu, "/")}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `영어 원문이 그대로 나갈 수 있습니다. toKoreanErrorMessage 를 쓰세요:\n  ${offenders.join("\n  ")}`,
  );
});

test("고친 자리들이 도우미를 실제로 부른다", () => {
  // 위 검사만 있으면 `String(err)` 같은 다른 모양으로 우회해도 통과한다.
  const expected = [
    ["app/onboarding/index.tsx", "저장하지 못했어요"],
    ["app/community/quick-review.tsx", "후기를 올리지 못했어요"],
    ["app/bookings/index.tsx", "저장하지 못했어요"],
    ["app/settings/index.tsx", "탈퇴를 끝내지 못했어요"],
  ];
  for (const [relative, fallback] of expected) {
    const text = readFileSync(join(appRoot, relative), "utf8");
    assert.match(text, /toKoreanErrorMessage\(/u, `${relative} 가 도우미를 안 부릅니다`);
    assert.ok(text.includes(fallback), `${relative} 의 기본 문구가 사라졌습니다: ${fallback}`);
  }
});

test("도우미를 부르는 화면은 import 도 갖고 있다", () => {
  // 문자열만 맞고 import 가 없으면 빌드가 깨진다. 타입 검사가 잡지만 여기서도 본다.
  for (const file of [...sourceFiles(join(appRoot, "app")), ...sourceFiles(join(appRoot, "src"))]) {
    const text = readFileSync(file, "utf8");
    // 도우미를 정의하는 파일은 자기를 import 하지 않는다.
    if (text.includes("export function toKoreanErrorMessage")) continue;
    if (!text.includes("toKoreanErrorMessage(")) continue;
    assert.match(
      text,
      /import \{[^}]*toKoreanErrorMessage[^}]*\} from "@\/lib\/errorCopy";/u,
      `${file.slice(appRoot.length)} 가 도우미를 부르면서 import 하지 않습니다`,
    );
  }
});
