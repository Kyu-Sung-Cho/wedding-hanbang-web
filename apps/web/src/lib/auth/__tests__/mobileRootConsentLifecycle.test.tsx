// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import { z } from "zod";
import type { SignupConsentAccess } from "@hanbang/shared";

type Session = { user: { id: string } } | null;
const a: Session = { user: { id: "owner-a" } };
const b: Session = { user: { id: "owner-b" } };
function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolveValue = resolvePromise; rejectValue = rejectPromise; });
  return { promise, resolve: resolveValue, reject: rejectValue };
}
const code = ts.transpileModule(readFileSync(resolve(process.cwd(), "../mobile/app/index.tsx"), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policy = ts.transpileModule(readFileSync(resolve(process.cwd(), "../mobile/src/lib/rootDestination.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const consentReads: ({ id: string; signal?: AbortSignal } & ReturnType<typeof deferred<SignupConsentAccess>>)[] = [];
const profileReads: ({ id: string } & ReturnType<typeof deferred<{ data: { onboarding_completed: boolean }; error: null }>>)[] = [];
const listeners = new Set<(event: string, session: Session) => void>();
let currentSession: Session;
const getSession = vi.fn(async () => ({ data: { session: currentSession }, error: null }));
const read = vi.fn((id: string, signal?: AbortSignal) => {
  const result = deferred<SignupConsentAccess>();
  consentReads.push({ id, signal, ...result });
  return result.promise;
});
function View({ children }: { children?: React.ReactNode }) { return <div>{children}</div>; }
function Button({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) { return <button onClick={onPress}>{children}</button>; }
function loadIndex() {
  const policyExports = {};
  new Function("exports", policy)(policyExports);
  const deps: Record<string, unknown> = {
    react: React, "react/jsx-runtime": jsxRuntime,
    "expo-router": { Redirect: ({ href }: { href: string }) => <span data-destination={href}>{href}</span> },
    "react-native": { View, Text: View, ActivityIndicator: () => <span>checking</span>, StyleSheet: { create: (value: unknown) => value } },
    "@hanbang/design-tokens": { colors: { rose: { 500: "pink" }, noir: { 800: "black" } } },
    "@/components/ui/AppUI": { PrimaryButton: Button },
    "@/lib/rootDestination": policyExports,
    "@/lib/signupConsentAccess": { readMobileSignupConsentAccess: read },
    "@/lib/siteUrl.mjs": { resolveMobileSiteOrigin: () => "https://synthetic.example" },
    "@/lib/mobileWebRuntime": { verifyMobileWebRuntime: async () => ({ ok: true }) },
    "@/lib/supabase": { supabase: {
      auth: {
        getSession,
        onAuthStateChange: (listener: (event: string, session: Session) => void) => {
          listeners.add(listener);
          return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
        },
      },
      from: () => ({ select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: () => {
        const result = deferred<{ data: { onboarding_completed: boolean }; error: null }>();
        profileReads.push({ id, ...result });
        return result.promise;
      } }) }) }),
    } },
  };
  const exports = {};
  new Function("exports", "require", "__DEV__", code)(exports, (name: string) => {
    if (!Object.hasOwn(deps, name)) throw new Error(name);
    return deps[name];
  }, false);
  return z.object({ default: z.custom<React.ComponentType>(value => typeof value === "function") }).parse(exports).default;
}
let root: Root;
let host: HTMLDivElement;
async function auth(session: Session) {
  await React.act(async () => {
    currentSession = session;
    for (const listener of [...listeners]) listener(session ? "SIGNED_IN" : "SIGNED_OUT", session);
  });
}
async function mount() { const Index = loadIndex(); await React.act(async () => root.render(<Index />)); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  currentSession = a;
  getSession.mockReset().mockImplementation(async () => ({ data: { session: currentSession }, error: null }));
  read.mockClear();
  consentReads.length = 0;
  profileReads.length = 0;
  listeners.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await React.act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const destination = () => host.querySelector("[data-destination]")?.getAttribute("data-destination");

it("A 동의 읽기 중 B로 바뀌면 A 결과는 폐기하고 B의 동의·프로필만으로 이동한다", async () => {
  await mount();
  await auth(b);
  expect(consentReads.map(row => row.id)).toEqual(["owner-a", "owner-b"]);
  expect(consentReads[0].signal?.aborted).toBe(true);
  await React.act(async () => consentReads[0].resolve("required"));
  expect(destination()).toBeUndefined();
  await React.act(async () => consentReads[1].resolve("server_verified"));
  expect(profileReads.map(row => row.id)).toEqual(["owner-b"]);
  await React.act(async () => profileReads[0].resolve({ data: { onboarding_completed: true }, error: null }));
  expect(destination()).toBe("/(tabs)/lounge");
});

it("A 프로필의 늦은 성공은 B 온보딩 목적지를 덮지 않는다", async () => {
  await mount();
  await React.act(async () => consentReads[0].resolve("server_verified"));
  await auth(b);
  await React.act(async () => profileReads[0].resolve({ data: { onboarding_completed: true }, error: null }));
  expect(destination()).toBeUndefined();
  await React.act(async () => consentReads[1].resolve("server_verified"));
  await React.act(async () => profileReads[1].resolve({ data: { onboarding_completed: false }, error: null }));
  expect(destination()).toBe("/onboarding");
});

it("auth event 뒤에 도착한 이전 getSession은 현재 계정을 되돌리지 않는다", async () => {
  const initial = deferred<{ data: { session: Session }; error: null }>();
  getSession.mockImplementationOnce(() => initial.promise);
  await mount();
  await auth(b);
  await React.act(async () => initial.resolve({ data: { session: a }, error: null }));
  expect(consentReads.map(row => row.id)).toEqual(["owner-b"]);
  await React.act(async () => consentReads[0].resolve("required"));
  expect(destination()).toBe("/(auth)/consent");
  expect(profileReads).toHaveLength(0);
});

it("대기 중 로그아웃은 지난 응답을 기다리지 않고 로그인으로 간다", async () => {
  await mount();
  await auth(null);
  expect(destination()).toBe("/(auth)/login");
  await React.act(async () => consentReads[0].reject(new Error("late old failure")));
  expect(destination()).toBe("/(auth)/login");
});

it("현재 동의 읽기가 실패하면 기존 재시도 화면에서 같은 주체를 다시 판정한다", async () => {
  await mount();
  await React.act(async () => consentReads[0].reject(new Error("SIGNUP_CONSENT_TIMEOUT")));
  expect(host.textContent).toContain("다시 시도");
  await React.act(async () => host.querySelector("button")?.click());
  expect(consentReads.map(row => row.id)).toEqual(["owner-a", "owner-a"]);
  await React.act(async () => consentReads[1].resolve("required"));
  expect(destination()).toBe("/(auth)/consent");
  expect(profileReads).toHaveLength(0);
});

it("언마운트는 읽기를 취소하고 계정 구독을 해제한다", async () => {
  await mount();
  const signal = consentReads[0].signal;
  await React.act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
  expect(listeners.size).toBe(0);
  await React.act(async () => consentReads[0].resolve("required"));
  expect(host.textContent).toBe("");
});
