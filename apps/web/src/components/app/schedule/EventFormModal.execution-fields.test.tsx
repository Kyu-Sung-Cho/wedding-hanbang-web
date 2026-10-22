// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EventFormModal from "./EventFormModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER_ID = "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2";
const PARTNER_ID = "4ed560aa-52e6-47d2-9595-612d0bfe2c7b";

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

describe("EventFormModal execution fields", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("maps a partner-facing option to the immutable partner profile UUID", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <EventFormModal
          isOpen
          mode="add"
          event={null}
          defaultDate="2027-05-01"
          assigneeContext={{
            viewer: { id: VIEWER_ID, name: "지은" },
            partner: { id: PARTNER_ID, name: "수현" },
          }}
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>(
      'input[name="schedule-title"]',
    );
    const time = container.querySelector<HTMLInputElement>(
      'input[name="schedule-time"]',
    );
    const assignee = container.querySelector<HTMLSelectElement>(
      'select[name="schedule-assignee"]',
    );
    const criteria = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="schedule-completion-criteria"]',
    );
    const status = container.querySelector<HTMLSelectElement>(
      'select[name="schedule-status"]',
    );
    if (!title || !time || !assignee || !criteria || !status) {
      throw new Error("execution field not rendered");
    }

    expect(assignee.textContent).toContain("지은 (나)");
    expect(assignee.textContent).toContain("수현 (파트너)");
    expect(assignee.textContent).toContain("함께");

    await act(async () => {
      setValue(title, "드레스 최종 확인");
      setValue(time, "14:30");
      setValue(assignee, `member:${PARTNER_ID}`);
      setValue(criteria, "수선 결과를 확인하고 인수하기");
      setValue(status, "completed");
    });
    expect(container.textContent).toContain(
      "누가 주로 챙길 일정인지 함께 표시해 둘 수 있어요",
    );
    await act(async () => {
      findButton(container, "추가").click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "드레스 최종 확인",
      time: "14:30",
      status: "completed",
      completionCriteria: "수선 결과를 확인하고 인수하기",
      assignee: {
        kind: "member",
        profileId: PARTNER_ID,
      },
    }));
    expect(JSON.stringify(onSave.mock.calls[0]?.[0]?.assignee)).not.toContain(
      "수현",
    );
  });

  it("supports solo planning and requires a short role for an external assignee", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <EventFormModal
          isOpen
          mode="add"
          event={null}
          defaultDate="2027-05-01"
          assigneeContext={{
            viewer: { id: VIEWER_ID, name: "지은" },
          }}
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>(
      'input[name="schedule-title"]',
    );
    const assignee = container.querySelector<HTMLSelectElement>(
      'select[name="schedule-assignee"]',
    );
    if (!title || !assignee) throw new Error("form field not rendered");

    expect(assignee.textContent).not.toContain("파트너)");
    expect(assignee.textContent).not.toContain("함께");

    await act(async () => {
      setValue(title, "사회자 최종 확인");
      setValue(assignee, "external");
    });
    await act(async () => {
      findButton(container, "추가").click();
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "외부 담당",
    );

    const externalLabel = container.querySelector<HTMLInputElement>(
      'input[name="schedule-external-assignee"]',
    );
    if (!externalLabel) throw new Error("external assignee input not rendered");

    await act(async () => {
      setValue(externalLabel, "웨딩 플래너");
      findButton(container, "추가").click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      assignee: {
        kind: "external",
        label: "웨딩 플래너",
      },
    }));
  });

  it("preserves an existing member UUID when the old partner is no longer connected", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const disconnectedId = "c9e1b4a0-d744-4f2a-9911-4ff716a60c69";

    await act(async () => {
      root.render(
        <EventFormModal
          isOpen
          mode="edit"
          event={{
            id: "evt-existing",
            date: "2027-05-01",
            title: "기존 일정",
            assignee: { kind: "member", profileId: disconnectedId },
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          }}
          defaultDate={null}
          assigneeContext={{
            viewer: { id: VIEWER_ID, name: "지은" },
          }}
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
    });

    const assignee = container.querySelector<HTMLSelectElement>(
      'select[name="schedule-assignee"]',
    );
    if (!assignee) throw new Error("assignee field not rendered");
    expect(assignee.selectedOptions[0]?.textContent).toContain(
      "연결이 끊긴 기존 담당자",
    );

    await act(async () => {
      findButton(container, "수정").click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      assignee: {
        kind: "member",
        profileId: disconnectedId,
      },
    }));
  });

  it("does not expose an internal persistence error in the user-facing form", async () => {
    const onSave = vi.fn().mockRejectedValue(
      new Error("PostgREST internal relation wedding_journeys failed"),
    );

    await act(async () => {
      root.render(
        <EventFormModal
          isOpen
          mode="add"
          event={null}
          defaultDate="2027-05-01"
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>(
      'input[name="schedule-title"]',
    );
    if (!title) throw new Error("title field not rendered");
    await act(async () => setValue(title, "일정 저장 오류 확인"));
    await act(async () => {
      findButton(container, "추가").click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "잠시 후 다시 시도",
    );
    expect(container.textContent).not.toContain("PostgREST");
    expect(container.textContent).not.toContain("wedding_journeys");
  });

  it("requires a second explicit action before requesting cancellation", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <EventFormModal
          isOpen
          mode="edit"
          event={{
            id: "evt-delete",
            date: "2027-05-01",
            title: "삭제 전 확인 일정",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          }}
          defaultDate={null}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onCancel={onCancel}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => findButton(container, "일정 취소").click());
    expect(onCancel).not.toHaveBeenCalled();
    // 확인 단계가 열렸는지는 확인 버튼 글자로 본다. 한 사람이 확인하면 바로 취소되므로
    // 요청을 보낸다는 말은 어디에도 없다.
    expect(container.textContent).toContain("일정 취소하기");
    expect(container.textContent).not.toContain("요청 보내기");
    expect(container.textContent).not.toContain("삭제");

    await act(async () => {
      findButton(container, "일정 취소하기").click();
      await Promise.resolve();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
