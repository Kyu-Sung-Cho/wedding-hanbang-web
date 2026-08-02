// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createChatImageObjectPath,
  isExistingChatImageUploadError,
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
