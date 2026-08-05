import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// P0-5 두 번째 축. `providerEgressCallerContract.test.ts`는 "audited wrapper를
// 부르는 호출부가 gate를 넘기는가"를 고정한다. 이 파일은 그 반대편, 즉 "wrapper를
// 아예 거치지 않고 OpenAI SDK에 직접 닿는 코드가 있는가"를 고정한다. 둘 다 있어야
// egress 경계가 닫힌다. wrapper 밖에서 클라이언트를 하나 만들면 gate·감사·kill
// switch를 전부 우회한 채 원문이 나가기 때문이다.
//
// 근거: docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md §10.2
// "모든 SDK 접근을 하나의 audited egress gateway 뒤로 모으고 ... input-token count,
// moderation, Files, image/file input, embedding, web/file search, tool/MCP,
// prompt cache와 retry를 모두 포함한다."
// docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
// §14.5 "모든 SDK endpoint가 audited egress gateway를 통과한다는 증명".

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "../../..");

/**
 * OpenAI SDK를 직접 만질 수 있는 유일한 두 파일. 이 목록을 늘리는 변경은
 * egress 경계를 넓히는 결정이므로 리뷰에서 명시적으로 다뤄야 한다.
 */
const GATEWAY_ROUTES = ["lib/ai/openai.ts", "lib/ai/auditedOpenAI.ts"] as const;

/**
 * gateway가 아직 gate 뒤로 통합하지 못한 SDK 표면. Responses API 외의 endpoint는
 * 사용 자체를 막는 것이 fail-closed다. 통합 전에 열면 그 경로만 감사·kill switch
 * 밖에 남는다.
 */
const UNGATED_SDK_SURFACES = [
  "embeddings",
  "moderations",
  "files",
  "vectorStores",
  "batches",
  "images",
  "audio",
  "fineTuning",
  "conversations",
  "uploads",
  "containers",
  "evals",
  "webhooks",
  "assistants",
  "threads",
  "realtime",
  "videos",
  "completions",
  "beta",
] as const;

const UNGATED_SDK_SURFACE_RE = new RegExp(
  String.raw`\.(${UNGATED_SDK_SURFACES.join("|")})\s*\.`,
  "u",
);

/** `import ... from "openai"` / `"openai/..."`의 import clause를 뽑는다. */
const OPENAI_PACKAGE_IMPORT_RE =
  /import\s+([\s\S]*?)\s*from\s*["'](openai(?:\/[^"']*)?)["']/gu;

interface SourceFile {
  route: string;
  source: string;
}

interface Violation {
  route: string;
  rule: string;
  evidence: string;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "node_modules"
        ? []
        : sourceFiles(path);
    }
    if (!entry.isFile()) return [];
    if (!/\.tsx?$/u.test(entry.name)) return [];
    if (/\.test\.tsx?$/u.test(entry.name)) return [];
    return [path];
  });
}

function toRoute(absolutePath: string): string {
  return relative(SRC_ROOT, absolutePath).replaceAll("\\", "/");
}

function readSourceFiles(): SourceFile[] {
  return sourceFiles(SRC_ROOT).map((path) => ({
    route: toRoute(path),
    source: readFileSync(path, "utf8"),
  }));
}

/**
 * 타입 전용 import는 런타임에 사라지므로 네트워크를 열 수 없다. 값 import만
 * 실제 SDK 접근 능력을 준다.
 */
function isTypeOnlyImportClause(clause: string): boolean {
  return /^type\b/u.test(clause.trim());
}

export function scanForProviderSdkBypass(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  const gateway = new Set<string>(GATEWAY_ROUTES);

  for (const { route, source } of files) {
    const isGateway = gateway.has(route);

    if (!isGateway) {
      for (const match of source.matchAll(OPENAI_PACKAGE_IMPORT_RE)) {
        const [, clause, specifier] = match;
        if (isTypeOnlyImportClause(clause)) continue;
        violations.push({
          route,
          rule: "openai_package_value_import",
          evidence: `import ... from "${specifier}"`,
        });
      }

      if (/(?<![.\w$])getOpenAIClient\b/u.test(source)) {
        violations.push({
          route,
          rule: "get_openai_client_outside_gateway",
          evidence: "getOpenAIClient",
        });
      }

      if (/new\s+OpenAI\s*\(/u.test(source)) {
        violations.push({
          route,
          rule: "openai_client_constructed_outside_gateway",
          evidence: "new OpenAI(",
        });
      }

      // SDK를 우회해 provider host로 직접 요청하는 경로도 같은 누출이다.
      if (/api\.openai\.com/u.test(source)) {
        violations.push({
          route,
          rule: "direct_provider_host_request",
          evidence: "api.openai.com",
        });
      }
      continue;
    }

    // gateway 안에서는 아직 gate 뒤로 통합하지 못한 SDK 표면을 쓰지 않는다.
    const ungated = source.match(UNGATED_SDK_SURFACE_RE);
    if (ungated) {
      violations.push({
        route,
        rule: "ungated_sdk_surface_in_gateway",
        evidence: ungated[0].trim(),
      });
    }
  }

  return violations;
}

const SOURCE_FILES = readSourceFiles();

describe("provider SDK access fence (P0-5)", () => {
  it("keeps the declared gateway files present so the scan cannot silently pass", () => {
    const routes = new Set(SOURCE_FILES.map((file) => file.route));
    for (const gatewayRoute of GATEWAY_ROUTES) {
      expect(routes.has(gatewayRoute), `${gatewayRoute} must exist`).toBe(true);
    }
    // 스캐너가 실제 트리를 읽고 있다는 최소 증거.
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
  });

  it("has no code that reaches the OpenAI SDK outside the audited gateway", () => {
    expect(scanForProviderSdkBypass(SOURCE_FILES)).toEqual([]);
  });

  it("keeps the gateway itself on Responses only, with no ungated SDK surface", () => {
    const gatewayFiles = SOURCE_FILES.filter((file) =>
      (GATEWAY_ROUTES as readonly string[]).includes(file.route),
    );
    expect(gatewayFiles).toHaveLength(GATEWAY_ROUTES.length);
    expect(
      scanForProviderSdkBypass(gatewayFiles).filter(
        (violation) => violation.rule === "ungated_sdk_surface_in_gateway",
      ),
    ).toEqual([]);
  });
});

// 위 세 테스트는 현재 코드가 깨끗하면 항상 통과한다. 그것만으로는 스캐너가
// 고장 나도 알 수 없으므로, 합성 위반이 실제로 검출되는지 함께 고정한다.
describe("provider SDK access fence — the scanner actually catches bypasses", () => {
  it.each([
    [
      "default value import of the SDK",
      'import OpenAI from "openai";\nconst client = new OpenAI({ apiKey });',
      "openai_package_value_import",
    ],
    [
      "named value import of the SDK",
      'import { APIUserAbortError } from "openai";',
      "openai_package_value_import",
    ],
    [
      "borrowing the shared audited client",
      'import { getOpenAIClient } from "@/lib/ai/openai";\nconst c = getOpenAIClient();',
      "get_openai_client_outside_gateway",
    ],
    [
      "constructing a second client",
      "const rogue = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
      "openai_client_constructed_outside_gateway",
    ],
    [
      "hand-rolled request straight to the provider host",
      'await fetch("https://api.openai.com/v1/responses", { method: "POST" });',
      "direct_provider_host_request",
    ],
  ])("flags %s", (_label, source, expectedRule) => {
    const violations = scanForProviderSdkBypass([
      { route: "lib/ai/roguePath.ts", source },
    ]);
    expect(violations.map((violation) => violation.rule)).toContain(expectedRule);
  });

  it.each([
    ["embeddings", "await client.embeddings.create({ input });"],
    ["moderations", "await client.moderations.create({ input });"],
    ["files", "await client.files.create({ file });"],
    ["chat completions", "await client.chat.completions.create({ messages });"],
    ["beta surface", "await client.beta.threads.create();"],
  ])("flags the ungated %s surface even inside the gateway", (_label, snippet) => {
    const violations = scanForProviderSdkBypass([
      { route: "lib/ai/openai.ts", source: snippet },
    ]);
    expect(violations.map((violation) => violation.rule)).toContain(
      "ungated_sdk_surface_in_gateway",
    );
  });

  it("does not flag type-only SDK imports, which cannot open a connection", () => {
    expect(scanForProviderSdkBypass([{
      route: "lib/ai/typesOnly.ts",
      source: [
        'import type OpenAI from "openai";',
        'import type { Response } from "openai/resources/responses/responses";',
      ].join("\n"),
    }])).toEqual([]);
  });

  it("does not flag ordinary code that merely looks like an SDK surface", () => {
    expect(scanForProviderSdkBypass([{
      route: "components/Uploader.tsx",
      source: [
        // 브라우저 File API와 도메인 객체는 provider SDK가 아니다.
        "const picked = event.dataTransfer.files.length;",
        "const names = attachment.files.map((file) => file.name);",
        // 내부 모듈 경로는 패키지 import가 아니다.
        'import { normalizeOpenAIProviderError } from "@/lib/ai/openai";',
      ].join("\n"),
    }])).toEqual([]);
  });
});
