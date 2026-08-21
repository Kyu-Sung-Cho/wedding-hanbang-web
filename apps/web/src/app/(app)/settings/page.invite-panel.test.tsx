// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings" }

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile } from "@/types/database.types";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({
  default: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CODE = "WH-A3F91B2C7D40";
const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "30000000-0000-4000-8000-000000000001";

const AWAITING_COUPLE: Couple = {
  id: "20000000-0000-4000-8000-000000000001",
  invite_code: CODE,
  bride_id: BRIDE_ID,
  groom_id: null,
  membership_sealed_at: null,
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

const LINKED_COUPLE: Couple = {
  ...AWAITING_COUPLE,
  groom_id: GROOM_ID,
  membership_sealed_at: "2026-08-19T00:00:00.000Z",
};

const PARTNER: Pick<Profile, "id" | "name" | "role" | "couple_id"> = {
  id: GROOM_ID,
  name: "민서",
  role: "groom",
  couple_id: AWAITING_COUPLE.id,
};

describe("settings invite panel visibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: Pick<
    ReturnType<typeof useAuthStore.getState>,
    "couple" | "partner" | "isDemo" | "journey" | "profile"
  >;

  beforeEach(() => {
    const state = useAuthStore.getState();
    originalState = {
      couple: state.couple,
      partner: state.partner,
      isDemo: state.isDemo,
      journey: state.journey,
      profile: state.profile,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(originalState);
    document.body.replaceChildren();
  });

  it("shows a scannable invite while the partner has not joined yet", async () => {
    // isDemo 경로를 쓰는 이유: 권한 API를 타지 않고도 `awaiting_partner`를
    // 정본(resolveCoupleConnectionState)으로 통과시키는 유일한 로컬 경로다.
    useAuthStore.setState({
      couple: AWAITING_COUPLE,
      partner: null,
      isDemo: true,
    });

    await act(async () => {
      root.render(<SettingsPage />);
    });

    expect(container.textContent).toContain("초대 코드");
    expect(container.textContent).toContain(CODE);
    const buttonLabels = [...container.querySelectorAll("button")].map(
      (button) => button.textContent ?? "",
    );
    expect(buttonLabels).toContain("코드 복사");
    expect(buttonLabels).toContain("링크 복사");
    expect(buttonLabels).toContain("코드 재발급");
  });

  it("removes the invite panel entirely once both people are connected", async () => {
    useAuthStore.setState({
      couple: LINKED_COUPLE,
      partner: PARTNER as Profile,
      isDemo: true,
    });

    await act(async () => {
      root.render(<SettingsPage />);
    });

    // 연결된 뒤에는 /api/couple/code가 inviteCode: null을 준다. 화면에도 코드,
    // 복사 버튼, QR이 남아 있으면 안 된다 — 빈 QR이나 "null"은 더 나쁘다.
    expect(container.textContent).not.toContain(CODE);
    expect(container.textContent).not.toContain("초대 코드");
    expect(container.textContent).not.toContain("null");
    const buttonLabels = [...container.querySelectorAll("button")].map(
      (button) => button.textContent ?? "",
    );
    expect(buttonLabels).not.toContain("코드 복사");
    expect(buttonLabels).not.toContain("링크 복사");
    expect(container.textContent).toContain("연동 완료");
  });
});
