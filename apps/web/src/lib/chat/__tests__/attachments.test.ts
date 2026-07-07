import { describe, expect, it } from "vitest";
import { chatAttachmentKey, dedupeChatAttachments } from "../attachments";

describe("chat attachment helpers", () => {
  it("deduplicates identical pasted images by media type and base64 data", () => {
    const first = {
      base64: "same-image-data",
      mediaType: "image/png",
      previewUrl: "blob:first",
      fileName: "image.png",
    };
    const duplicate = {
      base64: "same-image-data",
      mediaType: "image/png",
      previewUrl: "blob:duplicate",
      fileName: "image-copy.png",
    };
    const other = {
      base64: "other-image-data",
      mediaType: "image/png",
      previewUrl: "blob:other",
      fileName: "other.png",
    };

    expect(dedupeChatAttachments([first, duplicate, other])).toEqual([first, other]);
  });

  it("keeps attachments with the same data but different media types distinct", () => {
    const png = { base64: "data", mediaType: "image/png" };
    const jpeg = { base64: "data", mediaType: "image/jpeg" };

    expect(dedupeChatAttachments([png, jpeg])).toEqual([png, jpeg]);
    expect(chatAttachmentKey(png)).not.toBe(chatAttachmentKey(jpeg));
  });
});
