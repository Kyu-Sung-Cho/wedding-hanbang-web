// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it } from "vitest";
import ProtectionToolCard from "./ProtectionToolCard";
import { executeSimulateGuestGuarantee } from "@/lib/ai/tools/riskSupportTools";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("shows a useful partial calculation while keeping missing contract terms unresolved", () => {
  const result = executeSimulateGuestGuarantee({ estimated_guests: 150, meal_price: 8 });
  act(() => root.render(<ProtectionToolCard result={result} />));
  expect(container.textContent).toContain("150명 × 한 사람당 8만원 = 1,200만원");
  expect(container.textContent).toContain("최종 정산액이 아닙니다");
  expect(container.textContent).toContain("추가로 확인할 것");
  expect(container.textContent).not.toContain("사용자 지정 불참률 0%");
});

it("renders one-won meal price precision in the result table", () => {
  const result = executeSimulateGuestGuarantee({ estimated_guests: 1, guaranteed_guests: 1, meal_price: 87555, no_show_rate_percent: 0 });
  act(() => root.render(<ProtectionToolCard result={result} />));
  const scenario = Array.from(container.querySelectorAll("section div.grid")).find(node => node.textContent?.includes("사용자 지정 불참률"));
  expect(scenario?.textContent).toContain("8.7555만원");
  expect(scenario?.textContent).not.toContain("8.756만원");
});
