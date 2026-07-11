import { describe, expect, it, vi } from "vitest";
import { shareFileThenText } from "../nativeShare";

// Regression: ISSUE-002 — file-only sharing skipped supported text Web Share.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

const fileData: ShareData = {
  files: [new File(["image"], "result.png", { type: "image/png" })],
};
const textData: ShareData = {
  title: "Result",
  text: "Share this result",
  url: "https://hanbang.ai/wedding-code",
};

function abortError(): Error {
  const error = new Error("Share cancelled");
  error.name = "AbortError";
  return error;
}

describe("native result sharing regression", () => {
  it("shares the file first when the browser supports file sharing", async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(
      shareFileThenText({
        shareNavigator: { canShare: () => true, share },
        fileData,
        textData,
      })
    ).resolves.toBe("shared-file");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(fileData);
  });

  it("uses text and URL sharing when file sharing is unsupported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(
      shareFileThenText({
        shareNavigator: { canShare: () => false, share },
        fileData,
        textData,
      })
    ).resolves.toBe("shared-text");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(textData);
  });

  it("uses text sharing when canShare is unavailable", async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(
      shareFileThenText({ shareNavigator: { share }, fileData, textData })
    ).resolves.toBe("shared-text");
    expect(share).toHaveBeenCalledWith(textData);
  });

  it("retries with text after a non-cancellation file share failure", async () => {
    const share = vi
      .fn()
      .mockRejectedValueOnce(new Error("File sharing failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      shareFileThenText({
        shareNavigator: { canShare: () => true, share },
        fileData,
        textData,
      })
    ).resolves.toBe("shared-text");
    expect(share).toHaveBeenNthCalledWith(1, fileData);
    expect(share).toHaveBeenNthCalledWith(2, textData);
  });

  it("returns unavailable when both native share attempts fail", async () => {
    const share = vi.fn().mockRejectedValue(new Error("Share failed"));

    await expect(
      shareFileThenText({
        shareNavigator: { canShare: () => true, share },
        fileData,
        textData,
      })
    ).resolves.toBe("unavailable");
    expect(share).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable when the browser has no Web Share API", async () => {
    await expect(
      shareFileThenText({ shareNavigator: {}, fileData, textData })
    ).resolves.toBe("unavailable");
  });

  it("treats user cancellation as final and does not open another share sheet", async () => {
    const share = vi.fn().mockRejectedValue(abortError());

    await expect(
      shareFileThenText({
        shareNavigator: { canShare: () => true, share },
        fileData,
        textData,
      })
    ).resolves.toBe("cancelled");
    expect(share).toHaveBeenCalledTimes(1);
  });
});
