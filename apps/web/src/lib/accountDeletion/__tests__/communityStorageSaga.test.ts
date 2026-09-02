import { describe, expect, it, vi } from "vitest";
import {
  AccountDeletionStorageError,
  buildCommunityDeletionManifest,
  inventoryCommunityDeletionMedia,
  type CommunityDeletionSession,
} from "@/lib/accountDeletion/communityStorageSaga";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const CHAT_FILE_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_PATH = `${USER_ID}/${UPLOAD_ID}.png`;
const NOW = Date.parse("2026-07-17T00:00:00Z");

function session(overrides: Partial<CommunityDeletionSession> = {}): CommunityDeletionSession {
  return {
    id: UPLOAD_ID,
    user_id: USER_ID,
    staging_path: SESSION_PATH,
    final_bucket: "community-images",
    final_path: SESSION_PATH,
    expires_at: "2026-07-17T01:00:00Z",
    ...overrides,
  };
}

describe("community account-deletion Storage manifest", () => {
  it("includes both durable session paths even before either object exists", () => {
    const manifest = buildCommunityDeletionManifest({
      userId: USER_ID,
      sessions: [session()],
      listedNames: {
        "community-media-staging": [],
        "community-images": [],
        "community-videos": [],
      },
      now: NOW,
    });

    expect(manifest).toEqual([
      {
        bucket: "community-images",
        path: SESSION_PATH,
        source: "session_final",
        not_before: "2026-07-17T01:05:00.000Z",
      },
      {
        bucket: "community-media-staging",
        path: SESSION_PATH,
        source: "session_staging",
        not_before: "2026-07-17T01:05:00.000Z",
      },
    ]);
  });

  it("accepts only the bounded historical generator shape and quarantines unproven objects", () => {
    const legacyImage = "1700000000000_66666666-6666-4666-8666-666666666666.jpg";
    const legacyVideo = "1700000000000_77777777-7777-4777-8777-777777777777.mp4";
    const untrackedUuid = "88888888-8888-4888-8888-888888888888.png";
    const manifest = buildCommunityDeletionManifest({
      userId: USER_ID,
      sessions: [],
      listedNames: {
        "community-media-staging": [untrackedUuid],
        "community-images": [legacyImage, untrackedUuid],
        "community-videos": [legacyVideo, "hand-written.mov"],
      },
      now: NOW,
    });

    expect(manifest).toEqual(expect.arrayContaining([
      {
        bucket: "community-images",
        path: `${USER_ID}/${legacyImage}`,
        source: "legacy_prefix",
        not_before: "2026-07-17T00:00:00.000Z",
      },
      {
        bucket: "community-videos",
        path: `${USER_ID}/${legacyVideo}`,
        source: "legacy_prefix",
        not_before: "2026-07-17T00:00:00.000Z",
      },
      expect.objectContaining({
        bucket: "community-images",
        path: `${USER_ID}/${untrackedUuid}`,
        source: "quarantine",
      }),
      expect.objectContaining({
        bucket: "community-videos",
        path: `${USER_ID}/hand-written.mov`,
        source: "quarantine",
      }),
    ]));
    expect(manifest.filter((entry) => entry.source === "quarantine")).toHaveLength(3);
  });

  it("fails closed instead of joining an unsafe or nested listed name", () => {
    for (const unsafeName of ["..", "folder/file.jpg", "bad\\file.jpg", "bad\u0000.jpg"]) {
      expect(() => buildCommunityDeletionManifest({
        userId: USER_ID,
        sessions: [],
        listedNames: {
          "community-media-staging": [],
          "community-images": [unsafeName],
          "community-videos": [],
        },
        now: NOW,
      })).toThrowError(AccountDeletionStorageError);
    }
  });

  it("fails closed on a malformed durable session instead of inventing ownership", () => {
    expect(() => buildCommunityDeletionManifest({
      userId: USER_ID,
      sessions: [session({ final_path: `${USER_ID}/other.png` })],
      listedNames: {
        "community-media-staging": [],
        "community-images": [],
        "community-videos": [],
      },
      now: NOW,
    })).toThrow(/session_contract_invalid/);
  });

  it("paginates only the exact user prefix and merges durable sessions before deletion", async () => {
    const namesByBucket = {
      "community-media-staging": [UPLOAD_ID + ".png"],
      "community-images": [UPLOAD_ID + ".png", "1700000000000_66666666-6666-4666-8666-666666666666.jpg"],
      "community-videos": [],
    } as const;
    const list = vi.fn(async function (
      this: { bucket: keyof typeof namesByBucket },
      prefix: string,
      options: { offset: number },
    ) {
      const page = namesByBucket[this.bucket].slice(options.offset, options.offset + 100);
      return { data: page.map((name) => ({ name })), error: null };
    });
    const chatList = vi.fn(async () => ({ data: [], error: null }));
    const storageFrom = vi.fn((bucket: keyof typeof namesByBucket | "chat-image") => ({
      list: bucket === "chat-image" ? chatList : list.bind({ bucket }),
    }));
    const range = vi.fn(async (from: number) => ({
      data: from === 0 ? [session()] : [],
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
    }));
    const order = vi.fn(() => ({ range }));
    // 채팅 사진 증명 조회(`listOwnChatPhotoPaths`)가 `.eq().not().range()` 를 탄다.
    // 이 갈래가 없으면 인벤토리가 조회 단계에서 죽는다 — 증명이 없다는 뜻이
    // 아니라 아예 못 물어본 것이다.
    const notFn = vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) }));
    const eq = vi.fn(() => ({ order, not: notFn }));
    const select = vi.fn(() => ({ eq }));
    const admin = {
      storage: { from: storageFrom },
      from: vi.fn(() => ({ select })),
    };

    const manifest = await inventoryCommunityDeletionMedia(admin as never, USER_ID, NOW);

    expect(storageFrom).toHaveBeenCalledTimes(4);
    expect(list).toHaveBeenCalledTimes(3);
    for (const call of list.mock.calls) expect(call[0]).toBe(USER_ID);
    expect(select).toHaveBeenCalledWith(
      "id,user_id,staging_path,final_bucket,final_path,expires_at",
    );
    expect(manifest.filter((entry) => entry.source === "session_final")).toHaveLength(1);
    expect(manifest.filter((entry) => entry.source === "legacy_prefix")).toHaveLength(1);
  });

  it("finds orphaned chat attachments through paginated couple folders and always quarantines them", async () => {
    const firstRootPage = Array.from({ length: 100 }, (_, index) => ({
      name: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      id: null,
    }));
    const chatList = vi.fn(async (prefix: string, options: { offset: number }) => {
      if (prefix === "") {
        return {
          data: options.offset === 0
            ? firstRootPage
            : options.offset === 100
              ? [{ name: COUPLE_ID, id: null }]
              : [],
          error: null,
        };
      }
      if (prefix === `${COUPLE_ID}/${USER_ID}`) {
        return {
          data: options.offset === 0
            ? [{ name: `${CHAT_FILE_ID}.jpeg`, id: CHAT_FILE_ID }]
            : [],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const communityList = vi.fn(async () => ({ data: [], error: null }));
    const storageFrom = vi.fn((bucket: string) => ({
      list: bucket === "chat-image" ? chatList : communityList,
    }));
    const range = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ range }));
    // 채팅 사진 증명 조회(`listOwnChatPhotoPaths`)가 `.eq().not().range()` 를 탄다.
    // 이 갈래가 없으면 인벤토리가 조회 단계에서 죽는다 — 증명이 없다는 뜻이
    // 아니라 아예 못 물어본 것이다.
    const notFn = vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) }));
    const eq = vi.fn(() => ({ order, not: notFn }));
    const select = vi.fn(() => ({ eq }));
    const admin = {
      storage: { from: storageFrom },
      from: vi.fn(() => ({ select })),
    };

    const manifest = await inventoryCommunityDeletionMedia(admin as never, USER_ID, NOW);

    expect(chatList).toHaveBeenCalledWith("", expect.objectContaining({ offset: 0 }));
    expect(chatList).toHaveBeenCalledWith("", expect.objectContaining({ offset: 100 }));
    expect(chatList).toHaveBeenCalledWith(
      `${COUPLE_ID}/${USER_ID}`,
      expect.objectContaining({ offset: 0 }),
    );
    expect(manifest).toContainEqual({
      bucket: "chat-image",
      path: `${COUPLE_ID}/${USER_ID}/${CHAT_FILE_ID}.jpeg`,
      source: "quarantine",
      not_before: "2026-07-17T00:00:00.000Z",
    });
  });

  it("fails closed on malformed chat-image folders and attachment names", async () => {
    async function inventoryWithChatList(
      chatList: (prefix: string, options: { offset: number }) => Promise<{
        data: Array<{ name: string; id: string | null }>;
        error: null;
      }>,
    ) {
      const storageFrom = vi.fn((bucket: string) => ({
        list: bucket === "chat-image"
          ? chatList
          : vi.fn(async () => ({ data: [], error: null })),
      }));
      const range = vi.fn(async () => ({ data: [], error: null }));
      const order = vi.fn(() => ({ range }));
      // 채팅 사진 증명 조회(`listOwnChatPhotoPaths`)가 `.eq().not().range()` 를 탄다.
    // 이 갈래가 없으면 인벤토리가 조회 단계에서 죽는다 — 증명이 없다는 뜻이
    // 아니라 아예 못 물어본 것이다.
    const notFn = vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) }));
    const eq = vi.fn(() => ({ order, not: notFn }));
      const select = vi.fn(() => ({ eq }));
      return inventoryCommunityDeletionMedia({
        storage: { from: storageFrom },
        from: vi.fn(() => ({ select })),
      } as never, USER_ID, NOW);
    }

    await expect(inventoryWithChatList(async (prefix) => ({
      data: prefix === ""
        ? [{ name: COUPLE_ID, id: CHAT_FILE_ID }]
        : [],
      error: null,
    }))).rejects.toThrow(/chat_image_path_malformed/);

    await expect(inventoryWithChatList(async (prefix) => ({
      data: prefix === ""
        ? [{ name: COUPLE_ID, id: null }]
        : [{ name: `nested/${CHAT_FILE_ID}.png`, id: CHAT_FILE_ID }],
      error: null,
    }))).rejects.toThrow(/chat_image_path_malformed/);
  });

  it("fails closed when the chat-image couple-folder inventory exceeds its bound", async () => {
    const chatList = vi.fn(async (prefix: string, options: { offset: number; limit: number }) => {
      if (prefix !== "") return { data: [], error: null };
      return {
        data: Array.from({ length: options.limit }, (_, index) => ({
          name: `00000000-0000-4000-8000-${String(options.offset + index).padStart(12, "0")}`,
          id: null,
        })),
        error: null,
      };
    });
    const storageFrom = vi.fn((bucket: string) => ({
      list: bucket === "chat-image"
        ? chatList
        : vi.fn(async () => ({ data: [], error: null })),
    }));
    const range = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ range }));
    // 채팅 사진 증명 조회(`listOwnChatPhotoPaths`)가 `.eq().not().range()` 를 탄다.
    // 이 갈래가 없으면 인벤토리가 조회 단계에서 죽는다 — 증명이 없다는 뜻이
    // 아니라 아예 못 물어본 것이다.
    const notFn = vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) }));
    const eq = vi.fn(() => ({ order, not: notFn }));
    const select = vi.fn(() => ({ eq }));

    await expect(inventoryCommunityDeletionMedia({
      storage: { from: storageFrom },
      from: vi.fn(() => ({ select })),
    } as never, USER_ID, NOW)).rejects.toThrow(/chat_image_folder_limit_exceeded/);
    expect(chatList).toHaveBeenLastCalledWith(
      "",
      expect.objectContaining({ limit: 1, offset: 1000 }),
    );
  });

  it("fails closed when Storage returns more rows than the requested page bound", async () => {
    const chatList = vi.fn(async (prefix: string, options: { offset: number }) => ({
      data: prefix === "" && options.offset === 0
        ? Array.from({ length: 101 }, (_, index) => ({
          name: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          id: null,
        }))
        : [],
      error: null,
    }));
    const storageFrom = vi.fn((bucket: string) => ({
      list: bucket === "chat-image"
        ? chatList
        : vi.fn(async () => ({ data: [], error: null })),
    }));
    const range = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ range }));
    // 채팅 사진 증명 조회(`listOwnChatPhotoPaths`)가 `.eq().not().range()` 를 탄다.
    // 이 갈래가 없으면 인벤토리가 조회 단계에서 죽는다 — 증명이 없다는 뜻이
    // 아니라 아예 못 물어본 것이다.
    const notFn = vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) }));
    const eq = vi.fn(() => ({ order, not: notFn }));
    const select = vi.fn(() => ({ eq }));

    await expect(inventoryCommunityDeletionMedia({
      storage: { from: storageFrom },
      from: vi.fn(() => ({ select })),
    } as never, USER_ID, NOW)).rejects.toThrow(/chat_image_page_limit_exceeded/);
  });

  it("fails closed when the chat-image object inventory exceeds its bound", async () => {
    const chatList = vi.fn(async (prefix: string, options: { offset: number; limit: number }) => {
      if (prefix === "") {
        return { data: [{ name: COUPLE_ID, id: null }], error: null };
      }
      return {
        data: Array.from({ length: options.limit }, (_, index) => {
          const id = `00000000-0000-4000-8000-${String(options.offset + index).padStart(12, "0")}`;
          return { name: `${id}.png`, id };
        }),
        error: null,
      };
    });
    const storageFrom = vi.fn((bucket: string) => ({
      list: bucket === "chat-image"
        ? chatList
        : vi.fn(async () => ({ data: [], error: null })),
    }));
    const range = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ range }));
    // 채팅 사진 증명 조회(`listOwnChatPhotoPaths`)가 `.eq().not().range()` 를 탄다.
    // 이 갈래가 없으면 인벤토리가 조회 단계에서 죽는다 — 증명이 없다는 뜻이
    // 아니라 아예 못 물어본 것이다.
    const notFn = vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) }));
    const eq = vi.fn(() => ({ order, not: notFn }));
    const select = vi.fn(() => ({ eq }));

    await expect(inventoryCommunityDeletionMedia({
      storage: { from: storageFrom },
      from: vi.fn(() => ({ select })),
    } as never, USER_ID, NOW)).rejects.toThrow(/chat_image_object_limit_exceeded/);
    expect(chatList).toHaveBeenLastCalledWith(
      `${COUPLE_ID}/${USER_ID}`,
      expect.objectContaining({ limit: 1, offset: 10000 }),
    );
  });
});
