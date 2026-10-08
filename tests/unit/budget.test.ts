import { describe, expect, it } from "vitest";
import { BudgetExceeded } from "@statusframe/core";
import { makeBudget } from "../helpers";

describe("operation budget", () => {
  it("allows the exact limit and rejects the next operation without changing usage", () => {
    const budget = makeBudget({ max_subrequests: 2 });
    budget.take({ subrequests: 2 });
    expect(() => budget.take({ subrequests: 1 })).toThrow(BudgetExceeded);
    expect(budget.usage.subrequests).toBe(2);
  });

  it("rejects an over-budget composite operation atomically", () => {
    const budget = makeBudget({ max_d1_reads: 1, max_subrequests: 0 });
    expect(() => budget.take({ d1_reads: 1, subrequests: 1 })).toThrow(BudgetExceeded);
    expect(Object.values(budget.usage)).toEqual([0, 0, 0, 0, 0]);
  });

  it("checks admission without consuming the operation", () => {
    const budget = makeBudget({ max_subrequests: 1 });
    expect(budget.can({ subrequests: 1 })).toBe(true);
    expect(budget.usage.subrequests).toBe(0);
    budget.take({ subrequests: 1 });
    expect(budget.can({ subrequests: 1 })).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity])("rejects invalid operation cost %s before consuming resources", cost => {
    const budget = makeBudget();
    expect(() => budget.take({ d1_reads: 1, subrequests: cost })).toThrow("Invalid budget cost");
    expect(Object.values(budget.usage)).toEqual([0, 0, 0, 0, 0]);
  });
});
