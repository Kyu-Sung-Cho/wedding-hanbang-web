// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  communityMediaSignatureMatches,
  isValidCommunityMediaSize,
  normalizeCommunityMimeType,
} from "../uploadPolicy";

function ascii(value: string) {
  return Array.from(value, (character) => character.charCodeAt(0));
}

describe("community media signatures", () => {
  it("requires the complete PNG and GIF signatures", () => {
    expect(communityMediaSignatureMatches(
      "image/png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    )).toBe(false);
    expect(communityMediaSignatureMatches(
      "image/png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )).toBe(true);
    expect(communityMediaSignatureMatches("image/gif", new Uint8Array(ascii("GIF89a"))))
      .toBe(true);
    expect(communityMediaSignatureMatches("image/gif", new Uint8Array(ascii("GIF00a"))))
      .toBe(false);
  });

  it("keeps video disabled and caps every accepted client upload at six MiB", () => {
    expect(normalizeCommunityMimeType("video/mp4")).toBeNull();
    expect(normalizeCommunityMimeType("video/quicktime")).toBeNull();
    expect(normalizeCommunityMimeType("video/webm")).toBeNull();
    expect(isValidCommunityMediaSize("image/gif", 6 * 1024 * 1024)).toBe(true);
    expect(isValidCommunityMediaSize("image/gif", 6 * 1024 * 1024 + 1)).toBe(false);
  });

  it("requires RIFF and WEBP markers at their exact offsets", () => {
    const valid = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);
    const forged = new Uint8Array([...ascii("RIFFWEBP"), 0, 0, 0, 0]);
    expect(communityMediaSignatureMatches("image/webp", valid)).toBe(true);
    expect(communityMediaSignatureMatches("image/webp", forged)).toBe(false);
  });
});
