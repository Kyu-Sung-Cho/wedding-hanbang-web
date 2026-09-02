/**
 * 화면이 쓰는 판정을 스크립트도 그대로 쓰게 하는 자리.
 *
 * 판정을 두 벌 두면 스크립트가 「고쳤다」고 한 행을 화면이 여전히 깨졌다고 그린다.
 * 그래서 `packages/shared/src/utils/textEncodingRepair.ts` 를 **그 자리에서 컴파일해**
 * 쓴다 — 복사하지 않는다. 저장소에 이미 있는 방식이다
 * (`packages/shared/src/utils/__tests__/*.test.mjs` 가 같은 방법을 쓴다).
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

// ESM 에서 `require` 는 없다. 명시적으로 만든다 — 있는 것처럼 쓰면 런타임이
// 바뀔 때 조용히 깨진다.
const require = createRequire(import.meta.url);

let cached = null;

export function loadStoredTextDiagnosis() {
  if (cached) return cached;

  const modulePath = fileURLToPath(
    new URL("../../packages/shared/src/utils/textEncodingRepair.ts", import.meta.url),
  );
  const source = readFileSync(modulePath, "utf8");

  // `typescript` 는 이 저장소의 devDependency 다. 타입만 걷어내면 되는 파일이라
  // 트랜스파일만 한다(타입 검사는 `pnpm typecheck` 가 따로 한다).
  const ts = require("typescript");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(
    module.exports,
    module,
    () => {
      throw new Error("textEncodingRepair 는 다른 모듈에 기대지 않아야 합니다");
    },
  );

  const { diagnoseStoredText, repairMojibake, isUnreadableText } = module.exports;
  if (typeof diagnoseStoredText !== "function") {
    throw new Error("diagnoseStoredText 를 불러오지 못했습니다");
  }
  cached = { diagnoseStoredText, repairMojibake, isUnreadableText };
  return cached;
}
