import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { chatWithToolsStream } from "@/lib/ai/openai";
import { sanitizeProviderImage } from "@/lib/chat/providerImageSanitization";
import { attachmentProviderConsentVersion } from "@hanbang/shared";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/ai/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/openai")>()),
  chatWithToolsStream: vi.fn(),
}));
vi.mock("@/lib/chat/providerImageSanitization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/providerImageSanitization")>()),
  sanitizeProviderImage: vi.fn(),
}));

function attachmentRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Amora attachment provider consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an attachment without provider consent before auth, DB, decoding, or OpenAI", async () => {
    const response = await POST(attachmentRequest({
      attachments: [{
        base64: "this-is-not-a-decodable-image",
        mediaType: "image/png",
        fileName: "private.png",
      }],
    }));

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({
      code: "attachment_provider_consent_required",
    });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sanitizeProviderImage).not.toHaveBeenCalled();
    expect(chatWithToolsStream).not.toHaveBeenCalled();
  });

  it("rejects a stale provider consent version at the same side-effect-free boundary", async () => {
    const response = await POST(attachmentRequest({
      attachmentProviderConsentVersion: "2026-07-13.openai-attachments.v0",
      attachments: [{
        base64: "this-is-not-a-decodable-image",
        mediaType: "image/png",
        fileName: "private.png",
      }],
    }));

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({
      code: "attachment_provider_consent_required",
      requiredVersion: attachmentProviderConsentVersion,
    });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sanitizeProviderImage).not.toHaveBeenCalled();
    expect(chatWithToolsStream).not.toHaveBeenCalled();
  });

  it("rejects the legacy images field before auth or file handling", async () => {
    const response = await POST(attachmentRequest({
      attachmentProviderConsentVersion,
      images: [],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "legacy_chat_images_rejected",
    });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sanitizeProviderImage).not.toHaveBeenCalled();
    expect(chatWithToolsStream).not.toHaveBeenCalled();
  });
});
