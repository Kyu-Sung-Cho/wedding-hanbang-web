import { describe, expect, it } from "vitest";
import {
  chatAttachmentKey,
  CHAT_ATTACHMENT_MAX_PROVIDER_BASE64_CHARS,
  CHAT_PDF_DISABLED_ERROR,
  CHAT_ATTACHMENT_SIZE_ERROR,
  CHAT_ATTACHMENT_SNAPSHOT_ERROR,
  dedupeChatAttachments,
  prepareChatAttachmentPayload,
} from "../attachments";

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

  it("builds primitive-only snapshots for image and DOCX attachments", () => {
    const attachments = [
      { base64: "aGVsbG8=", mediaType: "image/png", previewUrl: "blob:image", fileName: "photo.png" },
      {
        base64: "UEsDBA==",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        previewUrl: "file:docx",
        fileName: "plan.docx",
      },
    ];

    expect(prepareChatAttachmentPayload(attachments)).toEqual({
      ok: true,
      attachments: [
        { base64: "aGVsbG8=", mediaType: "image/png", fileName: "photo.png" },
        {
          base64: "UEsDBA==",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileName: "plan.docx",
        },
      ],
    });
  });

  it("rejects PDF before a provider snapshot can retain its original bytes", () => {
    expect(prepareChatAttachmentPayload([{
      base64: "JVBERg==",
      mediaType: "application/pdf",
      previewUrl: "file:pdf",
      fileName: "plan.pdf",
    }])).toEqual({ ok: false, error: CHAT_PDF_DISABLED_ERROR });
  });

  it("rejects aggregate provider payload overflow and exceptional attachment objects", () => {
    expect(prepareChatAttachmentPayload([{
      base64: "a".repeat(CHAT_ATTACHMENT_MAX_PROVIDER_BASE64_CHARS + 4),
      mediaType: "image/png",
      fileName: "large.png",
    }])).toEqual({ ok: false, error: CHAT_ATTACHMENT_SIZE_ERROR });

    const unreadable = new Proxy({}, {
      get() {
        throw new Error("unreadable attachment");
      },
    });
    expect(prepareChatAttachmentPayload([unreadable])).toEqual({
      ok: false,
      error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
    });
  });
});
