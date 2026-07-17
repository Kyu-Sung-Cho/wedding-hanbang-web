// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import { uploadCommunityMedia } from "../uploadMedia";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${USER_ID}/${UPLOAD_ID}.png`;

describe("uploadCommunityMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends only small JSON to the app, uploads bytes to the exact signed path, and returns finalize output", async () => {
    const uploadToSignedUrl = vi.fn(async () => ({
      data: { path: PATH, fullPath: `community-media-staging/${PATH}` },
      error: null,
    }));
    const storageFrom = vi.fn(() => ({ uploadToSignedUrl }));
    mocks.createClient.mockReturnValue({ storage: { from: storageFrom } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        uploadId: UPLOAD_ID,
        bucket: "community-media-staging",
        path: PATH,
        token: "signed-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        url: `https://project.supabase.co/storage/v1/object/public/community-images/${PATH}`,
        type: "image",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "웨딩 사진.png", {
      type: "image/png",
    });

    const result = await uploadCommunityMedia(file);

    expect(result).toEqual({
      url: `https://project.supabase.co/storage/v1/object/public/community-images/${PATH}`,
      type: "image",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/community/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "image/png", size: 3 }),
    });
    expect(storageFrom).toHaveBeenCalledWith("community-media-staging");
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      PATH,
      "signed-token",
      file,
      { cacheControl: "31536000", contentType: "image/png", upsert: false },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/community/upload/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: UPLOAD_ID }),
    });
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      uploadToSignedUrl.mock.invocationCallOrder[0],
    );
    expect(uploadToSignedUrl.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[1],
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.body).toEqual(expect.any(String));
      expect(init?.body).not.toBeInstanceOf(FormData);
    }
  });

  it("never calls finalize or returns a public URL when signed upload fails", async () => {
    const uploadToSignedUrl = vi.fn(async () => ({
      data: null,
      error: { message: "network failed" },
    }));
    mocks.createClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ uploadToSignedUrl })) },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      uploadId: UPLOAD_ID,
      bucket: "community-media-staging",
      path: PATH,
      token: "signed-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadCommunityMedia(new File(["png"], "a.png", { type: "image/png" })))
      .rejects.toThrow("파일 전송에 실패했어요");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed initiation response before sending bytes to Storage", async () => {
    const uploadToSignedUrl = vi.fn();
    mocks.createClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ uploadToSignedUrl })) },
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      uploadId: UPLOAD_ID,
      bucket: "community-images",
      path: "attacker/path.png",
      token: "signed-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, { status: 201 })));

    await expect(uploadCommunityMedia(new File(["png"], "a.png", { type: "image/png" })))
      .rejects.toThrow("업로드 준비 응답을 확인할 수 없어요");
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects video locally before requesting a signed upload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadCommunityMedia(new File(["video"], "clip.mp4", { type: "video/mp4" })))
      .rejects.toThrow("지원하는 파일 형식과 용량을 확인해 주세요.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("routes every web community uploader through the shared signed-upload helper", () => {
    const roots = [
      "src/components/community/ImageUploader.tsx",
      "src/components/community/PollEditor.tsx",
      "src/components/community/SlideBuilder.tsx",
      "src/app/(community)/community/post/write/page.tsx",
      "src/app/(community)/community/cohort/[id]/page.tsx",
    ];
    for (const path of roots) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).toContain("uploadCommunityMedia");
      expect(source, path).not.toContain('fetch("/api/community/upload"');
      expect(source, path).not.toContain("new FormData()");
    }
  });
});
