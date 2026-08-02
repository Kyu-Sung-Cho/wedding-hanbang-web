import { describe, expect, it } from "vitest";
import {
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PrivateNextResponse,
} from "./privateResponse";

describe("PrivateNextResponse", () => {
  it("forces private no-store even when a caller supplies a public cache policy", async () => {
    const response = PrivateNextResponse.json(
      { private: true },
      {
        status: 202,
        headers: { "Cache-Control": "public, s-maxage=3600" },
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe(
      PRIVATE_NO_STORE_CACHE_CONTROL,
    );
    await expect(response.json()).resolves.toEqual({ private: true });
  });
});
