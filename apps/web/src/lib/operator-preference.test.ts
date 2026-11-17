import { afterEach, describe, expect, it, vi } from "vitest";

import { OPERATOR_STORAGE_KEY, loadOperator, saveOperator } from "./operator-preference";

afterEach(() => vi.unstubAllGlobals());

describe("operator preference", () => {
  it("round-trips the operator through localStorage", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
    });
    expect(loadOperator()).toBe("");
    saveOperator("  EP ");
    expect(store[OPERATOR_STORAGE_KEY]).toBe("EP");
    expect(loadOperator()).toBe("EP");
  });

  it("never throws when storage is blocked or there is no window", () => {
    expect(loadOperator()).toBe("");
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(loadOperator()).toBe("");
    expect(() => saveOperator("EP")).not.toThrow();
  });
});
