import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 목표 아키텍처 §6 불변식 8: "partner-direct 원문은 AI 문맥, 요약, 기억, 중재에
// 들어가지 않는다." 현재 이 경계는 지켜지고 있지만, DB가 아니라 애플리케이션 쿼리의
// 필터로만 지켜진다.
//
// `target`은 정규 컬럼이 아니라 `metadata` JSONB 안에 있어서 RLS나 CHECK 제약으로
// 강제할 수 없다. 따라서 새 AI 경로가 `chat_messages` 본문을 읽으면서 partner 제외를
// 빠뜨리면, 파트너에게 직접 보낸 사적인 문장이 조용히 모델 문맥으로 들어간다.
//
// 이 파일은 그 실수를 CI에서 막는다. 본문을 읽는 모든 서버 경로는 둘 중 하나여야 한다.
//   1) partner 제외 필터를 가진다 (AI 문맥으로 갈 수 있는 경로)
//   2) 아래 면제 목록에 "왜 AI로 가지 않는지"가 적혀 있다
//
// 근거: docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md §6, §10.1
// ("partner direct는 항상 제외").

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "../../..");

/**
 * AI 문맥·요약·기억을 만들기 위해 본문을 읽는 알려진 경로. 이 목록의 파일은 partner
 * 제외 필터가 반드시 있어야 한다.
 */
const AI_CONTEXT_READERS = [
  "app/api/chat/route.ts",
  "app/api/chat/check-couple-conflict/route.ts",
  "app/api/cron/amora-memory/route.ts",
] as const;

/**
 * 본문을 읽지만 그 내용을 모델로 보내지 않는 경로. 면제하려면 이유를 적어야 하고,
 * 그 자체가 리뷰 대상이 된다.
 */
const CONTENT_READERS_NOT_BOUND_FOR_AI = new Map<string, string>([
  [
    "lib/ai/chatMessagePersistence.ts",
    "AI 응답 저장과 중복 확인 전용. 읽은 본문을 모델로 되돌려 보내지 않는다.",
  ],
  [
    "app/api/chat/feedback/route.ts",
    "sender_type='ai'인 아모라 답변에 대한 사용자 피드백 저장. AI 호출이 없다.",
  ],
]);

/** `metadata->>target` (PostgREST) 와 `metadata?.target` (JS) 두 형태를 모두 본다. */
const PARTNER_FENCE_RE = /metadata->>target|metadata\?\.target|metadata\.target/u;

const CHAT_MESSAGES_TABLE_RE = /from\(\s*["']chat_messages["']\s*\)/u;

interface SourceFile {
  route: string;
  source: string;
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

function readSourceFiles(): SourceFile[] {
  return sourceFiles(SRC_ROOT).map((path) => ({
    route: relative(SRC_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

/**
 * `from("chat_messages")` 뒤에 이어지는 `.select(...)`가 본문을 가져오는지 본다.
 * `select("*")`도 본문을 포함하므로 같이 잡는다.
 */
export function readsMessageContent(source: string): boolean {
  for (const match of source.matchAll(new RegExp(CHAT_MESSAGES_TABLE_RE, "gu"))) {
    const window = source.slice(match.index, match.index + 400);
    const select = window.match(/\.select\(\s*(["'`])([\s\S]*?)\1/u);
    if (!select) continue;
    const columns = select[2];
    if (/(?:^|[\s,(])\*|content/u.test(columns)) return true;
  }
  return false;
}

export function hasPartnerFence(source: string): boolean {
  return PARTNER_FENCE_RE.test(source);
}

interface Violation {
  route: string;
  reason: string;
}

export function scanForUnfencedContentReaders(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const { route, source } of files) {
    if (!CHAT_MESSAGES_TABLE_RE.test(source)) continue;
    if (!readsMessageContent(source)) continue;
    if (hasPartnerFence(source)) continue;
    if (CONTENT_READERS_NOT_BOUND_FOR_AI.has(route)) continue;
    violations.push({
      route,
      reason:
        "chat_messages 본문을 읽으면서 partner 제외 필터도, 명시적 면제 사유도 없다",
    });
  }
  return violations;
}

const SOURCE_FILES = readSourceFiles();

describe("partner-direct context fence (불변식 8)", () => {
  it("scans a real source tree", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(
      SOURCE_FILES.some((file) => CHAT_MESSAGES_TABLE_RE.test(file.source)),
    ).toBe(true);
  });

  it.each(AI_CONTEXT_READERS)(
    "%s excludes partner-direct messages from the model context",
    (route) => {
      const file = SOURCE_FILES.find((candidate) => candidate.route === route);
      expect(file, `${route} must exist`).toBeDefined();
      expect(
        hasPartnerFence(file!.source),
        `${route}는 AI 문맥을 만들므로 partner 제외 필터가 있어야 한다`,
      ).toBe(true);
    },
  );

  it("has no path that reads message content without a fence or a stated exemption", () => {
    expect(scanForUnfencedContentReaders(SOURCE_FILES)).toEqual([]);
  });

  it("keeps every exemption pointing at a file that still reads content", () => {
    for (const [route, reason] of CONTENT_READERS_NOT_BOUND_FOR_AI) {
      const file = SOURCE_FILES.find((candidate) => candidate.route === route);
      expect(file, `면제 목록의 ${route}가 존재하지 않는다`).toBeDefined();
      // 면제가 오타나 유령 항목으로 남지 않게, 실제로 본문을 읽는 파일인지 확인한다.
      expect(
        readsMessageContent(file!.source),
        `${route}는 더 이상 본문을 읽지 않는다. 면제 항목을 지워야 한다`,
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

// 깨끗한 트리에서는 위 검사가 항상 통과하므로, 스캐너가 고장 나도 알 수 없다.
// 합성 위반이 실제로 검출되는지 함께 고정한다.
describe("partner-direct context fence — the scanner actually catches regressions", () => {
  it("flags a new AI path that forgets the partner filter", () => {
    const rogue = [
      'const { data } = await supabase',
      '  .from("chat_messages")',
      '  .select("id, content, visibility")',
      '  .eq("couple_id", coupleId);',
      "await chatWithToolsStream({ input: data });",
    ].join("\n");

    expect(scanForUnfencedContentReaders([
      { route: "app/api/chat/new-ai-path/route.ts", source: rogue },
    ])).toEqual([
      {
        route: "app/api/chat/new-ai-path/route.ts",
        reason:
          "chat_messages 본문을 읽으면서 partner 제외 필터도, 명시적 면제 사유도 없다",
      },
    ]);
  });

  it("flags a select(*) reader too, because * includes the body", () => {
    const rogue = [
      'await supabase.from("chat_messages").select("*").eq("couple_id", coupleId);',
    ].join("\n");

    expect(
      scanForUnfencedContentReaders([
        { route: "app/api/chat/star-select/route.ts", source: rogue },
      ]).map((violation) => violation.route),
    ).toEqual(["app/api/chat/star-select/route.ts"]);
  });

  it("accepts a reader that keeps the fence", () => {
    const fenced = [
      'await supabase',
      '  .from("chat_messages")',
      '  .select("id, content")',
      '  .or("metadata->>target.is.null,metadata->>target.neq.partner");',
    ].join("\n");

    expect(scanForUnfencedContentReaders([
      { route: "app/api/chat/fenced/route.ts", source: fenced },
    ])).toEqual([]);
  });

  it("does not flag a reader that never touches the body", () => {
    const metadataOnly = [
      'await supabase',
      '  .from("chat_messages")',
      '  .select("id, created_at")',
      '  .eq("sender_type", "ai");',
    ].join("\n");

    expect(scanForUnfencedContentReaders([
      { route: "app/api/chat/proactive/route.ts", source: metadataOnly },
    ])).toEqual([]);
  });

  it("does not flag files that never query chat_messages", () => {
    expect(scanForUnfencedContentReaders([
      { route: "lib/ai/unrelated.ts", source: 'const content = "just a variable";' },
    ])).toEqual([]);
  });
});
