// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PriceUploadPanel } from "./PriceUploadPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("PriceUploadPanel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function selectFile(file: File) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input?.dispatchEvent(new Event("change", { bubbles: true })));
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const hasError = container.querySelector('[role="alert"]') !== null;
      const hasSelectedFile = container.textContent?.includes(file.name) ?? false;
      expect(hasError || hasSelectedFile).toBe(true);
    });
  }

  function validJson() {
    return JSON.stringify({
      period_label: "2026Q3",
      source: "mixed",
      source_note: "수동 공시 자료",
      collected_at: "2026-07-18",
      entries: [{
        vendor_name: "샘플스튜디오가",
        category: "studio",
        region_code: "seoul_gangnam3",
        aliases: [],
        prices: [{
          agency_slug: "sample-agency-a",
          price_min_krw: 1_000_000,
          price_max_krw: 1_200_000,
          price_note: null,
          base_spec: "샘플 기본 구성",
          options: [],
        }],
      }],
    });
  }

  it("explains the JSON and 2MiB boundary and exposes the current-data export", async () => {
    await act(async () => root.render(<PriceUploadPanel />));

    expect(container.textContent).toContain("공시 JSON 적재");
    expect(container.textContent).toContain("2MiB 이하");
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toContain(".json");
    const exportLink = Array.from(container.querySelectorAll("a"))
      .find((link) => link.textContent?.includes("현재 발행 데이터 JSON"));
    expect(exportLink?.getAttribute("href")).toBe("/api/admin/price/export");
  });

  it("rejects an oversized file on the client before upload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<PriceUploadPanel />));

    await selectFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "too-large.json", {
      type: "application/json",
    }));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("2MiB");
    const uploadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("업로드"));
    expect(uploadButton?.hasAttribute("disabled")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses the selected JSON and rejects malformed or incomplete payloads", async () => {
    await act(async () => root.render(<PriceUploadPanel />));

    await selectFile(new File(["{not-json"], "invalid.json", { type: "application/json" }));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("JSON 형식");
    const uploadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("업로드"));
    expect(uploadButton?.hasAttribute("disabled")).toBe(true);
  });

  it("uploads a validated file and renders a reviewable summary and detail tables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot_id: "snapshot-1",
      counts: {
        auto_matched: 1,
        newly_created: 1,
        needs_confirmation: 1,
        errors: 1,
        staged_prices: 2,
      },
      details: {
        auto_matched: [{ entry_index: 0, vendor_id: "vendor-1", vendor_name: "샘플스튜디오가" }],
        newly_created: [{ entry_index: 1, vendor_id: "vendor-2", vendor_name: "샘플드레스가" }],
        needs_confirmation: [{
          confirmation_id: "00000000-0000-4000-8000-000000000099",
          version: 0,
          entry_index: 2,
          vendor_name: "샘플메이크업가",
          candidates: [{
            vendorId: "vendor-3",
            vendorName: "샘플메이크업나",
            vendorSlug: "sample-makeup-b",
            aliases: [],
            similarity: 0.72,
            matchKind: "similar",
          }],
        }],
        errors: [{
          entry_index: 3,
          vendor_name: "샘플예식장가",
          code: "AGENCY_NOT_FOUND",
          message: "등록되지 않은 샘플 대행사입니다.",
        }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<PriceUploadPanel />));
    const json = validJson();
    await selectFile(new File([json], "sample-disclosure.json", { type: "application/json" }));
    const uploadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("JSON 업로드"));

    await act(async () => {
      uploadButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("적재가 끝났습니다");
    expect(container.textContent).toContain("자동 매칭1");
    expect(container.textContent).toContain("신규 생성1");
    expect(container.textContent).toContain("확인 필요1");
    expect(container.textContent).toContain("오류1");
    expect(container.textContent).toContain("적재 가격2");
    expect(container.textContent).toContain("샘플메이크업나");
    expect(container.textContent).toContain("72%");
    expect(container.textContent).toContain("AGENCY_NOT_FOUND");
    expect(container.querySelectorAll("table").length).toBeGreaterThanOrEqual(3);
  });

  it("announces a server failure and retries the same validated file", async () => {
    const successReport = {
      snapshot_id: null,
      counts: { auto_matched: 0, newly_created: 0, needs_confirmation: 0, errors: 0, staged_prices: 0 },
      details: { auto_matched: [], newly_created: [], needs_confirmation: [], errors: [] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "일시적으로 적재할 수 없습니다." }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successReport), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<PriceUploadPanel />));
    await selectFile(new File([validJson()], "sample-disclosure.json", { type: "application/json" }));
    const uploadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("JSON 업로드"));
    await act(async () => {
      uploadButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("일시적으로");
    const retryButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("다시 시도"));
    expect(retryButton).toBeDefined();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("적재가 끝났습니다");
  });

  it("clears the selected file and result when the operator resets the panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot_id: "snapshot-1",
      counts: { auto_matched: 1, newly_created: 0, needs_confirmation: 0, errors: 0, staged_prices: 1 },
      details: {
        auto_matched: [{ entry_index: 0, vendor_id: "vendor-1", vendor_name: "샘플스튜디오가" }],
        newly_created: [],
        needs_confirmation: [],
        errors: [],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<PriceUploadPanel />));
    await selectFile(new File([validJson()], "sample-disclosure.json", { type: "application/json" }));
    const uploadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("JSON 업로드"));
    await act(async () => {
      uploadButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("적재가 끝났습니다");
    const resetButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("초기화"));

    await act(async () => resetButton?.click());

    expect(container.textContent).not.toContain("적재가 끝났습니다");
    expect(container.textContent).not.toContain("sample-disclosure.json");
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.value).toBe("");
    expect(uploadButton?.hasAttribute("disabled")).toBe(true);
  });

  it("announces the busy state and prevents changing files while the upload is in flight", async () => {
    let resolveUpload: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<PriceUploadPanel />));
    await selectFile(new File([validJson()], "sample-disclosure.json", { type: "application/json" }));
    const uploadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("JSON 업로드"));

    await act(async () => {
      uploadButton?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain("적재하는 중");
    expect(uploadButton?.getAttribute("aria-busy")).toBe("true");
    expect(uploadButton?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);

    await act(async () => {
      resolveUpload?.(new Response(JSON.stringify({
        snapshot_id: null,
        counts: { auto_matched: 0, newly_created: 0, needs_confirmation: 0, errors: 0, staged_prices: 0 },
        details: { auto_matched: [], newly_created: [], needs_confirmation: [], errors: [] },
      }), { status: 200, headers: { "content-type": "application/json" } }));
      await Promise.resolve();
    });
  });
});
