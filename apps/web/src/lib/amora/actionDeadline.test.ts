// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmoraActionDeadlineError, createAmoraActionDeadline } from "./actionDeadline";

afterEach(() => vi.useRealTimers());
describe("an action operation cannot outlive its deadline", () => {
  it("refuses a late operation even before a delayed timer callback has executed", async () => {
    vi.useFakeTimers();
    const deadline = createAmoraActionDeadline();
    const operation = vi.fn(() => "late value");
    vi.setSystemTime(Date.now() + 15_000);
    try {
      await expect(deadline.run(operation)).rejects.toBeInstanceOf(AmoraActionDeadlineError);
      expect(operation).not.toHaveBeenCalled();
    } finally { deadline.dispose(); }
  });
  it("settles a non-cooperative pending operation when its owner aborts and removes its timer", async () => {
    vi.useFakeTimers();
    const owner = new AbortController(); const deadline = createAmoraActionDeadline(undefined, owner.signal);
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => { resolve = done; });
    const operation = deadline.run(() => pending);
    const rejected = expect(operation).rejects.toBeInstanceOf(AmoraActionDeadlineError);
    owner.abort(); await rejected;
    deadline.dispose(); expect(vi.getTimerCount()).toBe(0);
    resolve("late receipt");
    await expect(deadline.run(() => "new request")).rejects.toBeInstanceOf(AmoraActionDeadlineError);
  });
  it("does not leave a timer or reusable execution scope after normal completion", async () => {
    vi.useFakeTimers(); const deadline = createAmoraActionDeadline();
    expect(await deadline.run(() => "headers")).toBe("headers");
    expect(await deadline.run(() => Promise.resolve("body"))).toBe("body");
    deadline.dispose(); expect(vi.getTimerCount()).toBe(0);
    const operation = vi.fn();
    await expect(deadline.run(operation)).rejects.toBeInstanceOf(AmoraActionDeadlineError);
    expect(operation).not.toHaveBeenCalled();
  });
});
