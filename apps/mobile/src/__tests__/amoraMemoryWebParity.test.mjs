// 앱의 「아모라 기억」 화면이 웹 설정 화면과 같은 사실을 말하는가.
//
// 2026-07-16 웹은 이 화면의 말을 고쳤다(`fix: harden Amora V2 consent and mediation`).
//   - 종류 라벨 "확정한 선택" → "대화에서 말한 선택"
//     아모라가 대화에서 **들은** 선택이지, 두 사람이 **확정한** 결정이 아니다.
//   - "직접 확인" 표시 → `userCorrected` 일 때만 "한 사람이 직접 고침 · 공동 확인 아님"
//     (나만 상담에서는 "내가 직접 고침"). 공유 기억을 한 사람이 고치면 DB 는
//     `user_confirmed_at` 을 비우고 `correction_confirmation = 'single_member'` 로 남긴다
//     (20260716090000_amora_memory_engine_v2.sql). 앱은 여전히 `userConfirmedAt` 을 보고
//     "직접 확인" 이라고 적어, 공동 확인이 아닌 것을 확인된 것처럼 보여줄 수 있었다.
//   - 민감정보 안내, 「상담할 때 참고하는 맥락」, 두 사람 동의 상태 문장.
// 앱은 그 뒤로 따라오지 않았다. 이 파일은 (1) 앱 화면이 실제로 그 문장을 그리는지
// 화면을 렌더해서 보고, (2) 그 문장이 지금 웹의 문장과 글자까지 같은지 웹 소스와 맞댄다.
// 웹이 다시 고치면 (2)가 빨간불을 켠다 — 두 화면이 다른 말을 하는 채로 조용히 남지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function compile(relative, deps = {}, { jsx = false } = {}) {
  const compiled = ts.transpileModule(read(relative), {
    fileName: jsx ? "module.tsx" : "module.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}

const WEB_PAGE = "../../../web/src/app/(app)/settings/amora-memory/page.tsx";
const webSource = read(WEB_PAGE);
const display = compile("../lib/amoraMemoryDisplay.ts");

// ── 화면 렌더 ──────────────────────────────────────────────────────────────
// 훅은 부르는 순서대로 상태를 돌려준다. 순서가 바뀌면 여기가 **시끄럽게** 깨진다
// (데이터 자리에 다른 값이 들어가 문장이 안 나온다) — 조용히 통과하지 않는다.
const STATE_ORDER = ["data", "activeVisibility", "loading", "busy", "error", "editing", "editTitle", "editValue"];

function renderScreen(state) {
  let hook = 0;
  const react = {
    useState: (initial) => {
      const name = STATE_ORDER[hook++];
      const value = Object.hasOwn(state, name) ? state[name] : (typeof initial === "function" ? initial() : initial);
      return [value, () => {}];
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, {
    get: (_target, key) => (typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined),
  });
  const icons = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? `Icon:${key}` : undefined) });
  const screen = compile("../../app/settings/amora-memory.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      Alert: { alert: () => {} },
      Modal: "Modal",
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      StyleSheet: { create: (value) => value },
      Switch: "Switch",
      View: "View",
    },
    "@/components/ui/AppText": { TextInput: "TextInput" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { router: { back: () => {} } },
    "lucide-react-native": icons,
    "@hanbang/design-tokens": { colors: token, radius: token, spacing: token, amoraIdentity: token },
    "@/lib/api": { apiJsonForExpectedUser: async () => { throw new Error("렌더 중에는 요청하지 않는다"); } },
    "@/lib/supabase": { supabase: {} },
    "@/lib/ownerCoupleSessionFence.mjs": { createOwnerCoupleSessionFence: () => ({}) },
    "@/lib/amoraMemoryDisplay": display,
    "@/components/ui/AppUI": {
      AppHeader: "AppHeader",
      AppText: "AppText",
      EmptyState: "EmptyState",
      LoadingState: "LoadingState",
      PrimaryButton: "PrimaryButton",
      StatusPill: "StatusPill",
      Surface: "Surface",
    },
  }, { jsx: true });
  const tree = screen.default();
  assert.equal(hook, STATE_ORDER.length, `useState 를 ${hook}번 불렀다 — STATE_ORDER 를 화면과 맞춰라`);

  const texts = [];
  const props = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string" || typeof node === "number") return void texts.push(String(node));
    if (!node || typeof node !== "object") return;
    props.push(node);
    for (const key of ["label", "title", "subtitle", "description", "accessibilityLabel"]) {
      if (typeof node.props[key] === "string") texts.push(node.props[key]);
    }
    if (Array.isArray(node.props.children)
      && node.props.children.every((child) => typeof child === "string" || typeof child === "number")) {
      // `정리된 기억 {n}개` 처럼 한 덩어리로 읽히는 글자는 이어서도 넣는다.
      texts.push(node.props.children.join(""));
    }
    walk(node.props.children);
  })(tree);
  return { texts, nodes: props };
}

const sharedPending = {
  visibility: "shared",
  enabled: false,
  consentedByMe: true,
  consentedCount: 1,
  requiredCount: 2,
  legacyPurgedAt: null,
  pendingPurge: { memories: 0, summaries: 0, profiles: 0, total: 0 },
};
const privateOn = { ...sharedPending, visibility: "bride_private", enabled: true, consentedCount: 1, requiredCount: 1 };

const memories = [
  {
    // 예전 흐름에서 user_confirmed_at 이 채워졌지만 사람이 고친 적은 없는 기억.
    id: "m-confirmed-not-corrected",
    visibility: "shared",
    kind: "decision",
    title: "예식 시기",
    value: "내년 봄",
    userConfirmedAt: "2026-09-01T00:00:00.000Z",
    userCorrected: false,
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    // 한 사람이 고친 공유 기억 — DB 가 user_confirmed_at 을 비운다.
    id: "m-corrected",
    visibility: "shared",
    kind: "preference",
    title: "식장 분위기",
    value: "밝은 홀",
    userConfirmedAt: null,
    userCorrected: true,
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
  {
    id: "m-private-corrected",
    visibility: "bride_private",
    kind: "constraint",
    title: "예산 상한",
    value: "3천만 원",
    userConfirmedAt: "2026-09-03T00:00:00.000Z",
    userCorrected: true,
    updatedAt: "2026-09-03T00:00:00.000Z",
  },
];

const sharedProfile = {
  visibility: "shared",
  persona_summary: "차분하게 비교하고 정해요",
  budget_posture: "  ",
  decision_style: "둘이 같이 본 뒤 정해요",
  taste_profile: null,
  communication_style: "짧게 정리해 주면 좋아해요",
  conflict_pattern: "화면에 올리지 않는 값",
  recommendation_rules: ["가격은 항목별로", "추천은 두 개까지", "업체 이름은 확인한 것만", "넷째 규칙"],
  open_questions: ["화면에 올리지 않는 질문"],
  confidence_score: 0.7,
  updated_at: "2026-09-02T00:00:00.000Z",
};

function sharedData(overrides = {}) {
  return {
    runtimeEnabled: true,
    settings: [sharedPending, privateOn],
    memories,
    profiles: [sharedProfile],
    ...overrides,
  };
}

test("종류 라벨은 웹과 같이 「대화에서 말한 선택」이고, 확정했다고 말하지 않는다", () => {
  const { texts } = renderScreen({ data: sharedData(), activeVisibility: "shared", loading: false });
  assert.ok(texts.includes("대화에서 말한 선택"), texts.join(" | "));
  assert.ok(!texts.some((text) => text.includes("확정한 선택")), "옛 라벨이 남아 있다");
});

test("공유 기억의 고침 표시는 사람이 고친 기억에만, 공동 확인이 아니라고 붙는다", () => {
  const { texts } = renderScreen({ data: sharedData(), activeVisibility: "shared", loading: false });
  const corrected = texts.filter((text) => text === "한 사람이 직접 고침 · 공동 확인 아님");
  assert.equal(corrected.length, 1, "고친 기억 하나에만 붙어야 한다 — user_confirmed_at 만 있는 기억에는 안 붙는다");
  assert.ok(!texts.some((text) => text.includes("직접 확인")), "공동 확인이 아닌 것을 「직접 확인」이라고 적었다");
});

test("나만 상담 기억의 고침 표시는 「내가 직접 고침」이다", () => {
  const { texts } = renderScreen({
    data: sharedData({ profiles: [] }),
    activeVisibility: "bride_private",
    loading: false,
  });
  assert.ok(texts.includes("내가 직접 고침"), texts.join(" | "));
  assert.ok(!texts.includes("한 사람이 직접 고침 · 공동 확인 아님"));
});

test("민감정보 안내가 화면에 있다", () => {
  const { texts } = renderScreen({ data: sharedData(), activeVisibility: "shared", loading: false });
  assert.ok(texts.includes(display.AMORA_MEMORY_SENSITIVE_NOTICE), "민감정보 안내가 렌더되지 않았다");
});

test("두 사람 동의 상태를 웹과 같은 문장으로 말한다", () => {
  const pending = renderScreen({ data: sharedData(), activeVisibility: "shared", loading: false }).texts;
  assert.ok(pending.includes("내 공유 기억 동의"), pending.join(" | "));
  assert.ok(
    pending.includes("공유 기억 상태 · 동의 대기 (1/2). 파트너 구성 변경 시 두 분의 동의를 새로 받아요."),
    pending.join(" | "),
  );

  const on = renderScreen({
    data: sharedData({ settings: [{ ...sharedPending, enabled: true, consentedCount: 2 }] }),
    activeVisibility: "shared",
    loading: false,
  }).texts;
  assert.ok(on.includes("공유 기억 상태 · 켜짐. 두 분이 각각 동의했고 함께 보고 활용해요."));

  const off = renderScreen({
    data: sharedData({ settings: [{ ...sharedPending, consentedByMe: false, consentedCount: 0 }] }),
    activeVisibility: "shared",
    loading: false,
  }).texts;
  assert.ok(off.includes("공유 기억 상태 · 꺼짐. 파트너 연결 후 두 분이 각각 동의해야 시작돼요."));

  const mine = renderScreen({ data: sharedData(), activeVisibility: "bride_private", loading: false }).texts;
  assert.ok(mine.includes("나만 상담 기억"));
  assert.ok(mine.includes("나만 상담 기억 상태 · 켜짐. 파트너에게 보이지 않아요."), mine.join(" | "));
});

test("상담할 때 참고하는 맥락은 서버가 준 그 범위의 맥락만, 여섯 줄까지 보여준다", () => {
  const { texts } = renderScreen({ data: sharedData(), activeVisibility: "shared", loading: false });
  assert.ok(texts.includes("상담할 때 참고하는 맥락"), texts.join(" | "));
  const expected = [
    "차분하게 비교하고 정해요",
    "둘이 같이 본 뒤 정해요",
    "짧게 정리해 주면 좋아해요",
    "가격은 항목별로",
    "추천은 두 개까지",
    "업체 이름은 확인한 것만",
  ];
  for (const line of expected) assert.ok(texts.some((text) => text.includes(line)), `빠진 줄: ${line}`);
  assert.ok(!texts.some((text) => text.includes("넷째 규칙")), "여섯 줄을 넘겼다");
  assert.ok(!texts.some((text) => text.includes("화면에 올리지 않는")), "웹이 보여주지 않는 값을 보여줬다");

  // 이 범위의 맥락이 없으면(서버는 켜진 범위만 준다) 제목도 없다.
  const none = renderScreen({ data: sharedData(), activeVisibility: "bride_private", loading: false }).texts;
  assert.ok(!none.includes("상담할 때 참고하는 맥락"));
  // 옛 서버처럼 profiles 가 없어도 깨지지 않는다.
  const legacy = renderScreen({
    data: { runtimeEnabled: true, settings: [sharedPending], memories: [] },
    activeVisibility: "shared",
    loading: false,
  }).texts;
  assert.ok(!legacy.includes("상담할 때 참고하는 맥락"));
});

// ── 웹과 글자까지 같은가 ───────────────────────────────────────────────────

test("측정기가 살아 있다", () => {
  assert.ok(webSource.length > 5000, "웹 기억 설정 화면을 못 읽었다");
  assert.match(webSource, /const KIND_LABELS: Record<string, string> = \{/);
});

test("종류 라벨 표가 웹과 같다", () => {
  const block = webSource.match(/const KIND_LABELS: Record<string, string> = \{([\s\S]*?)\};/);
  assert.ok(block, "웹 KIND_LABELS 를 못 찾았다");
  const web = Object.fromEntries([...block[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.ok(Object.keys(web).length >= 6, "웹 라벨을 덜 읽었다");
  assert.deepEqual({ ...display.AMORA_MEMORY_KIND_LABELS }, web);
  assert.equal(display.memoryKindLabel("decision"), "대화에서 말한 선택");
  assert.equal(display.memoryKindLabel("toString"), "대화 기억", "객체 기본 속성을 라벨로 읽으면 안 된다");
  assert.match(webSource, /KIND_LABELS\[memory\.kind\] \?\? "대화 기억"/);
});

test("민감정보 안내가 웹 문장과 같다", () => {
  const start = webSource.indexOf("건강·임신");
  const end = webSource.indexOf("마세요.", start);
  assert.ok(start > 0 && end > start, "웹 민감정보 안내를 못 찾았다");
  // JSX 는 줄바꿈과 들여쓰기를 공백 하나로 읽는다.
  const web = webSource.slice(start, end + "마세요.".length).replace(/\s*\n\s*/g, " ");
  assert.equal(display.AMORA_MEMORY_SENSITIVE_NOTICE, web);
});

test("고침 표시와 그 조건이 웹과 같다", () => {
  assert.match(webSource, /\{memory\.userCorrected && \(/, "웹은 userCorrected 를 본다");
  assert.ok(webSource.includes('activeVisibility === "shared" ? "한 사람이 직접 고침 · 공동 확인 아님" : "내가 직접 고침"'));
  assert.equal(display.memoryCorrectionLabel({ userCorrected: true }, "shared"), "한 사람이 직접 고침 · 공동 확인 아님");
  assert.equal(display.memoryCorrectionLabel({ userCorrected: true }, "groom_private"), "내가 직접 고침");
  assert.equal(display.memoryCorrectionLabel({ userCorrected: false, userConfirmedAt: "2026-09-01" }, "shared"), null);
  assert.equal(display.memoryCorrectionLabel({ userCorrected: "true" }, "shared"), null);
});

test("동의 상태 문장이 웹과 같다", () => {
  // 웹 템플릿의 자리표시자를 그대로 넣으면 앱 문장이 웹 소스의 글자와 같아야 한다.
  const templated = { enabled: false, consentedByMe: true, consentedCount: "${setting.consentedCount}", requiredCount: "${setting.requiredCount}" };
  for (const sentence of [
    display.memoryConsentStatus("shared", { enabled: true, consentedByMe: true, consentedCount: 2, requiredCount: 2 }),
    display.memoryConsentStatus("shared", templated),
    display.memoryConsentStatus("shared", { enabled: false, consentedByMe: false, consentedCount: 0, requiredCount: 2 }),
    display.memoryConsentStatus("shared", undefined),
    display.memoryConsentHeading("shared"),
    display.memoryConsentHeading("bride_private"),
  ]) {
    assert.ok(webSource.includes(sentence), `웹에 없는 문장: ${sentence}`);
  }
  assert.ok(webSource.includes('`나만 상담 기억 상태 · ${setting?.enabled ? "켜짐" : "꺼짐"}. 파트너에게 보이지 않아요.`'));
  assert.equal(display.memoryConsentStatus("groom_private", { enabled: false }), "나만 상담 기억 상태 · 꺼짐. 파트너에게 보이지 않아요.");
});

test("맥락 제목과 고르는 칸이 웹과 같다", () => {
  assert.ok(webSource.includes(`>${display.AMORA_MEMORY_PROFILE_HEADING}<`));
  const block = webSource.match(/const profileLines = profile\s*\?\s*\[([\s\S]*?)\]\.filter/);
  assert.ok(block, "웹 profileLines 를 못 찾았다");
  const webFields = [...block[1].matchAll(/profile\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(webFields, [...display.AMORA_MEMORY_PROFILE_FIELDS, "recommendation_rules"]);
  assert.match(webSource, /\.slice\(0, 6\)/);
});
