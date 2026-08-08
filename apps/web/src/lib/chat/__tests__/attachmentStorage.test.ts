// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createChatImageObjectPath,
  createChatImageObjectPathV2,
  isExistingChatImageUploadError,
  verifyChatImageObjectBindings,
} from "../attachmentStorage";

const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const CANONICAL_PATH = new RegExp(
  `^${COUPLE_ID}/${USER_ID}/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|gif|webp)$`,
);

describe("chat attachment Storage identity", () => {
  it("derives a stable canonical UUID filename bound to request, slot, type, and bytes", async () => {
    const input = {
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: "image/png",
      base64: "aW1hZ2UtYnl0ZXM=",
    } as const;

    const first = await createChatImageObjectPath(input);
    const second = await createChatImageObjectPath(input);
    const nextSlot = await createChatImageObjectPath({
      ...input,
      attachmentIndex: 1,
    });
    const changedBytes = await createChatImageObjectPath({
      ...input,
      base64: "ZGlmZmVyZW50LWJ5dGVz",
    });

    expect(first).toBe(second);
    expect(first).toMatch(CANONICAL_PATH);
    expect(nextSlot).toMatch(CANONICAL_PATH);
    expect(changedBytes).toMatch(CANONICAL_PATH);
    expect(new Set([first, nextSlot, changedBytes]).size).toBe(3);
  });

  it("normalizes JPEG and keeps non-image provider documents out of chat-image", async () => {
    const common = {
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      base64: "aW1hZ2UtYnl0ZXM=",
    } as const;

    await expect(createChatImageObjectPath({
      ...common,
      mediaType: "image/jpeg",
    })).resolves.toMatch(/\.jpg$/);
    await expect(createChatImageObjectPath({
      ...common,
      mediaType: "application/pdf",
    })).resolves.toBeNull();
    await expect(createChatImageObjectPath({
      ...common,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).resolves.toBeNull();
  });

  it("derives a stable v2 path from the exact manifest digest instead of transient file bytes", async () => {
    const input = {
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: "image/png",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    } as const;

    const first = await createChatImageObjectPathV2(input);
    const retry = await createChatImageObjectPathV2(input);
    const changedDigest = await createChatImageObjectPathV2({
      ...input,
      sha256: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7",
    });

    expect(first).toBe(retry);
    expect(first).toMatch(CANONICAL_PATH);
    expect(changedDigest).toMatch(CANONICAL_PATH);
    expect(changedDigest).not.toBe(first);
  });

  it("fails closed when exact image bytes have no trustworthy stored content type", async () => {
    const binding = {
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    } as const;
    const imagePath = await createChatImageObjectPathV2({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: binding.mediaType,
      sha256: binding.sha256,
    });
    expect(imagePath).not.toBeNull();

    const result = await verifyChatImageObjectBindings({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      manifest: [binding],
      imagePaths: [imagePath as string],
      readObject: async () => ({
        ok: true,
        stream: new Blob(["hello"]).stream(),
        byteLength: 5,
        mediaType: null,
      }),
    });

    expect(result).toEqual({ ok: false, reason: "object_mismatch" });
  });

  it("stops an object stream as soon as it exceeds the manifest byte length", async () => {
    const binding = {
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    } as const;
    const imagePath = await createChatImageObjectPathV2({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: binding.mediaType,
      sha256: binding.sha256,
    });
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello!"));
      },
      cancel() {
        cancelled = true;
      },
    });

    const result = await verifyChatImageObjectBindings({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      manifest: [binding],
      imagePaths: [imagePath as string],
      readObject: async () => ({
        ok: true,
        stream: oversized,
        byteLength: binding.byteLength,
        mediaType: binding.mediaType,
      }),
    });

    expect(result).toEqual({ ok: false, reason: "object_mismatch" });
    expect(cancelled).toBe(true);
  });

  it("fails retryably when a bounded object stream errors mid-read", async () => {
    const binding = {
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    } as const;
    const imagePath = await createChatImageObjectPathV2({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: binding.mediaType,
      sha256: binding.sha256,
    });
    let pullCount = 0;
    const interrupted = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode("he"));
          return;
        }
        controller.error(new Error("storage stream interrupted"));
      },
    });

    const result = await verifyChatImageObjectBindings({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      manifest: [binding],
      imagePaths: [imagePath as string],
      readObject: async () => ({
        ok: true,
        stream: interrupted,
        byteLength: binding.byteLength,
        mediaType: binding.mediaType,
      }),
    });

    expect(result).toEqual({ ok: false, reason: "object_unavailable" });
  });

  it("recognizes only the immutable-upload duplicate response as reusable", () => {
    expect(isExistingChatImageUploadError({
      statusCode: "409",
      error: "Duplicate",
      message: "The resource already exists",
    })).toBe(true);
    expect(isExistingChatImageUploadError({
      statusCode: 409,
      message: "The resource already exists",
    })).toBe(true);
    expect(isExistingChatImageUploadError({
      statusCode: 403,
      message: "row-level security policy denied the upload",
    })).toBe(false);
    expect(isExistingChatImageUploadError(new Error("network unavailable"))).toBe(false);
  });
});
