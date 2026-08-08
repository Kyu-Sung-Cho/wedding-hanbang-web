import { describe, expect, it } from "vitest";
import {
  chatAttachmentKey,
  CHAT_ATTACHMENT_MAX_PROVIDER_BASE64_CHARS,
  CHAT_ATTACHMENT_SIZE_ERROR,
  CHAT_ATTACHMENT_SNAPSHOT_ERROR,
  createChatAttachmentBindings,
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

  it("builds primitive-only snapshots for image, PDF, and DOCX attachments", () => {
    const attachments = [
      { base64: "aGVsbG8=", mediaType: "image/png", previewUrl: "blob:image", fileName: "photo.png" },
      { base64: "JVBERg==", mediaType: "application/pdf", previewUrl: "file:pdf", fileName: "plan.pdf" },
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
        { base64: "JVBERg==", mediaType: "application/pdf", fileName: "plan.pdf" },
        {
          base64: "UEsDBA==",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileName: "plan.docx",
        },
      ],
    });
  });

  it("binds each ordered provider attachment to its exact media type, byte length, and SHA-256", async () => {
    const result = await createChatAttachmentBindings([
      { base64: "aGVsbG8=", mediaType: "image/png", fileName: "first.png" },
      { base64: "d29ybGQ=", mediaType: "application/pdf", fileName: "second.pdf" },
    ]);

    expect(result).toEqual({
      ok: true,
      bindings: [
        {
          mediaType: "image/png",
          byteLength: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
        {
          mediaType: "application/pdf",
          byteLength: 5,
          sha256: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7",
        },
      ],
    });

    const changedBytes = await createChatAttachmentBindings([
      { base64: "SEVMTE8=", mediaType: "image/png", fileName: "first.png" },
      { base64: "d29ybGQ=", mediaType: "application/pdf", fileName: "second.pdf" },
    ]);
    expect(changedBytes).toMatchObject({ ok: true });
    if (changedBytes.ok) {
      expect(changedBytes.bindings[0]?.sha256).not.toBe(
        result.ok ? result.bindings[0]?.sha256 : undefined
      );
    }
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
