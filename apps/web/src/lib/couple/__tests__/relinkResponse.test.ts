import { describe, expect, it } from "vitest";

import { shouldReloadAfterFreshSpaceResponse } from "../relinkResponse";

describe("replacement-couple response reconciliation", () => {
  it.each([null, 200, 201, 204, 500, 503])(
    "reloads for an ambiguous or potentially committed response (%s)",
    (status) => {
      expect(shouldReloadAfterFreshSpaceResponse(status)).toBe(true);
    }
  );

  it.each([400, 401, 403, 409, 422])(
    "preserves an actionable deterministic client error (%s)",
    (status) => {
      expect(shouldReloadAfterFreshSpaceResponse(status)).toBe(false);
    }
  );
});
