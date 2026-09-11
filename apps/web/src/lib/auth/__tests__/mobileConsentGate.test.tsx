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

// 실제 native gate의 React 효과를 실행하며 네트워크·네이티브 화면만 합성한다.
const compiled = ts.transpileModule(readFileSync(resolve(process.cwd(), "../mobile/src/components/ConsentGate.tsx"), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const interception = ts.transpileModule(readFileSync(resolve(process.cwd(), "../mobile/src/lib/consentInterception.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let pathname: string;
const session = { user: { id: "synthetic-owner" } };
const replace = vi.fn();
const reads: { resolve: (access: SignupConsentAccess) => void; signal: AbortSignal }[] = [];
const read = vi.fn((_id: string, signal: AbortSignal) => new Promise<SignupConsentAccess>(resolveRead => reads.push({ resolve: resolveRead, signal })));
function View(props: { children?: React.ReactNode; pointerEvents?: string }) {
  return <div data-pointer-events={props.pointerEvents}>{props.children}</div>;
}
function loadGate() {
  const gateExports = {};
  new Function("exports", interception)(gateExports);
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "expo-router": { router: { replace }, usePathname: () => pathname, useRootNavigationState: () => ({ key: "synthetic-navigation" }) },
    "react-native": { View, ActivityIndicator: () => <span>checking</span>, StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} } },
    "@hanbang/design-tokens": { colors: { ivory: { 50: "white" } } },
    "@/components/ui/AppUI": { AppText: View, PrimaryButton: View },
    "@/lib/signupConsentAccess": { readMobileSignupConsentAccess: read },
    "@/lib/consentInterception": gateExports,
    "@/lib/supabase": { supabase: { auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: async () => ({ data: { session } }),
    } } },
  };
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name: string) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected test dependency: ${name}`);
    return dependencies[name];
  });
  return z.object({ default: z.custom<React.ComponentType<{ children: React.ReactNode }>>(value => typeof value === "function") }).parse(exports).default;
}
let root: Root;
let host: HTMLDivElement;
let Gate: ReturnType<typeof loadGate>;
async function render(path: string) {
  pathname = path;
  await React.act(async () => root.render(<Gate><span>protected stack</span></Gate>));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reads.length = 0;
  read.mockClear();
  replace.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Gate = loadGate();
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each(["required", "server_verified"] as const)("동의 예외 화면에서 돌아오면 이전 %s 판정을 재사용하지 않는다", async access => {
  await render("/budget");
  await React.act(async () => reads[0].resolve(access));
  const previousRedirects = replace.mock.calls.length;
  await render("/consent");
  await render("/budget");
  expect(read).toHaveBeenCalledTimes(2);
  expect(replace).toHaveBeenCalledTimes(previousRedirects);
  expect(host.querySelector('[data-pointer-events="none"]')).not.toBeNull();
  expect(host.textContent).toContain("protected stack");
  await React.act(async () => reads[1].resolve("server_verified"));
  expect(host.querySelector('[data-pointer-events="none"]')).toBeNull();
});

it("예외 화면 이전의 지연 응답은 새 보호 화면을 열거나 재이동시키지 않는다", async () => {
  await render("/budget");
  await render("/consent");
  expect(reads[0].signal.aborted).toBe(true);
  await render("/budget");
  await React.act(async () => reads[0].resolve("required"));
  expect(replace).not.toHaveBeenCalled();
  expect(host.querySelector('[data-pointer-events="none"]')).not.toBeNull();
  await React.act(async () => reads[1].resolve("server_verified"));
  expect(host.querySelector('[data-pointer-events="none"]')).toBeNull();
});
