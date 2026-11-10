import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithToolsStream } from "../openai";
import {
  createOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit,
} from "../auditedOpenAI";

// P0-5 호출부 계약. SDK 경계에 egress gate가 있어도 호출부가 넘기지 않으면 실제
// 운영 경로의 원문은 그대로 `responses.inputTokens.count`로 나간다. 이 파일은
// "gate가 존재한다"가 아니라 "모든 production 호출부가 gate를 통과한다"를 고정한다.
// 근거: docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
// §8 P0-5 / §16 카드 E / §17.3 "모든 content-bearing provider egress가 최종 gate 뒤".

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "../../..");

/** gate 계약을 정의하는 파일 자신은 호출부가 아니다. */
const WRAPPER_DEFINITION_FILES = new Set([
  resolve(SRC_ROOT, "lib/ai/openai.ts"),
  resolve(SRC_ROOT, "lib/ai/auditedOpenAI.ts"),
]);

const AUDITED_WRAPPERS = [
  "chatWithToolsStream",
  "createOpenAIResponseWithAudit",
  "createOpenAIStructuredResponseWithAudit",
] as const;

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

/** `name(` 뒤의 괄호를 균형 있게 잘라 실제 인자 텍스트만 돌려준다. */
function callArgumentSlices(source: string, functionName: string): string[] {
  const slices: string[] = [];
  const pattern = new RegExp(`(?<![.\\w$])${functionName}\\s*(?:<[^(){}]*>)?\\s*\\(`, "gu");
  for (const match of source.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          slices.push(source.slice(open + 1, index));
          break;
        }
      }
    }
  }
  return slices;
}

interface CallSite {
  file: string;
  route: string;
  wrapper: string;
  argumentText: string;
}

const CALL_SITES: CallSite[] = sourceFiles(SRC_ROOT)
  .filter((file) => !WRAPPER_DEFINITION_FILES.has(file))
  .flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return AUDITED_WRAPPERS.flatMap((wrapper) => {
      // import 문만 있고 실제 호출이 없는 파일은 건너뛴다.
      if (!source.includes(wrapper)) return [];
      return callArgumentSlices(source, wrapper).map((argumentText) => ({
        file,
        route: relative(SRC_ROOT, file).replaceAll("\\", "/"),
        wrapper,
        argumentText,
      }));
    });
  })
  // 타입 위치(`typeof x`, `ReturnType<...>`)는 호출이 아니다.
  .filter((site) => site.argumentText.trim().startsWith("{"));

/**
 * gate를 전달하지 않는 호출부가 남으면 실패한다. 새 provider 호출부가 생겼을 때
 * 조용히 빠져나가지 못하게 하는 것이 이 테스트의 목적이다.
 */
describe("provider egress gate — production caller contract (P0-5)", () => {
  it("finds every audited provider call site in src", () => {
    expect(CALL_SITES.length).toBeGreaterThanOrEqual(9);
  });

  for (const site of CALL_SITES) {
    it(`${site.route} passes beforeProviderEgress to ${site.wrapper}`, () => {
      expect(
        /(?<![.\w$])beforeProviderEgress\s*:/u.test(site.argumentText),
        `${site.route} calls ${site.wrapper} without a beforeProviderEgress gate, so the full instructions and input reach responses.inputTokens.count before any privacy/kill-switch check runs.`,
      ).toBe(true);
    });
  }

  it("never lets a caller pass an obviously inert gate literal", () => {
    for (const site of CALL_SITES) {
      const inert = /beforeProviderEgress\s*:\s*(?:undefined|null|\(\s*\)\s*=>\s*\{\s*\})/u;
      expect(
        inert.test(site.argumentText),
        `${site.route} passes an inert beforeProviderEgress to ${site.wrapper}`,
      ).toBe(false);
    }
  });
});

// ── 원장 밖 유료 실행기: 운영 호출부 0곳 ─────────────────────────────────────
//
// `runAmoraSafeGuardrailPipeline`은 transport.generateMainResponse 없이 부르면 audited wrapper로 유료 생성을
// 직접 한다. 비용 원장도 상한도 요청 제한도 거치지 않는다. 이 실행기를 그대로 부르던
// `/api/amora/safe-chat`은 2026-11-11에 지웠다(화면·앱 호출부 0곳, 운영 모델 호출 기록 0건).
// 운영 경로에 다시 연결하려면 원장과 요청 제한을 먼저 붙이고, 그 뒤에 이 검사를 고친다.
const UNMETERED_RUNNER = "runAmoraSafeGuardrailPipeline";
const UNMETERED_RUNNER_FILE = resolve(SRC_ROOT, "lib/ai/amoraSafeGuardrailPipeline.ts");

describe("unmetered safe guardrail runner — no production caller", () => {
  it("still defines the runner this guard watches", () => {
    // 이름이 바뀌거나 파일이 옮겨지면 아래 스캔이 조용히 0건이 된다.
    expect(readFileSync(UNMETERED_RUNNER_FILE, "utf8")).toContain(
      `export async function ${UNMETERED_RUNNER}(`,
    );
  });

  it("keeps runAmoraSafeGuardrailPipeline out of every production source file", () => {
    const referencingFiles = sourceFiles(SRC_ROOT)
      .filter((file) => file !== UNMETERED_RUNNER_FILE)
      .filter((file) => readFileSync(file, "utf8").includes(UNMETERED_RUNNER))
      .map((file) => relative(SRC_ROOT, file).replaceAll("\\", "/"));

    expect(
      referencingFiles,
      `${UNMETERED_RUNNER} reaches a paid model call outside the cost ledger, the caps and the request limiter. Route it through runAmoraProviderCallWithLedger before giving it a production caller.`,
    ).toEqual([]);
  });

  it("gives the runner no other name or caller inside its own file", () => {
    // 위 스캔은 이 파일을 보지 않는다. 여기서 다른 이름으로 내보내면 그 이름은 잡히지 않는다.
    const otherUses = readFileSync(UNMETERED_RUNNER_FILE, "utf8")
      .split("\n")
      .filter((line) => line.includes(UNMETERED_RUNNER))
      .filter((line) => !["//", "/*", "*"].some((mark) => line.trimStart().startsWith(mark)))
      .filter((line) => !line.startsWith(`export async function ${UNMETERED_RUNNER}(`));

    expect(otherUses).toEqual([]);
  });
});

// ── SDK 경계의 fail-closed: gate 자체가 없으면 provider 요청 0회 ──────────────

function recordingClient() {
  const calls: string[] = [];
  const count = vi.fn(() => {
    calls.push("count");
    return {
      withResponse: vi.fn().mockResolvedValue({
        data: { object: "response.input_tokens", input_tokens: 11 },
        response: new Response(),
        request_id: "req_count",
      }),
    };
  });
  const create = vi.fn(() => {
    calls.push("create");
    return {
      withResponse: vi.fn().mockResolvedValue({
        data: {},
        response: new Response(),
        request_id: "req_create",
      }),
    };
  });
  return {
    client: { responses: { create, inputTokens: { count } } } as unknown as OpenAI,
    calls,
  };
}

const originalEnabled = process.env.AMORA_OPENAI_ENABLED;
const originalApiKey = process.env.OPENAI_API_KEY;

describe("provider egress gate — the gate itself cannot be omitted", () => {
  beforeEach(() => {
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.AMORA_OPENAI_ENABLED;
    else process.env.AMORA_OPENAI_ENABLED = originalEnabled;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("chatWithToolsStream refuses to reach the provider without an egress gate", async () => {
    const { client, calls } = recordingClient();
    const beforeGeneration = vi.fn();

    await expect(
      (chatWithToolsStream as unknown as (options: Record<string, unknown>) => Promise<unknown>)({
        systemPrompt: "SYNTHETIC-SYSTEM",
        input: "SYNTHETIC-INPUT",
        tools: [],
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeGeneration,
        client,
      }),
    ).rejects.toThrow(/beforeProviderEgress/u);

    expect(calls).toEqual([]);
    expect(beforeGeneration).not.toHaveBeenCalled();
  });

  it("createOpenAIResponseWithAudit refuses to reach the provider without an egress gate", async () => {
    const { client, calls } = recordingClient();
    const beforeGeneration = vi.fn();

    await expect(
      (createOpenAIResponseWithAudit as unknown as (
        options: Record<string, unknown>,
      ) => Promise<unknown>)({
        modelRole: "fast",
        instructions: "SYNTHETIC-SYSTEM",
        input: "SYNTHETIC-INPUT",
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeGeneration,
        client,
        audit: { interactionType: "chat_turn" },
      }),
    ).rejects.toThrow(/beforeProviderEgress/u);

    expect(calls).toEqual([]);
    expect(beforeGeneration).not.toHaveBeenCalled();
  });

  it("createOpenAIStructuredResponseWithAudit refuses to reach the provider without an egress gate", async () => {
    const { client, calls } = recordingClient();

    await expect(
      (createOpenAIStructuredResponseWithAudit as unknown as (
        options: Record<string, unknown>,
      ) => Promise<unknown>)({
        modelRole: "fast",
        instructions: "SYNTHETIC-SYSTEM",
        input: "SYNTHETIC-INPUT",
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeGeneration: vi.fn(),
        client,
        audit: { interactionType: "chat_turn" },
        responseFormat: {
          name: "probe",
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
        validate: (value: unknown) => value as { ok: boolean },
      }),
    ).rejects.toThrow(/beforeProviderEgress/u);

    expect(calls).toEqual([]);
  });
});
