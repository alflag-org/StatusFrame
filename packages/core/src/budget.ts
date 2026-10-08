import type { BudgetConfig } from "./types";
export type Resource = "d1_reads" | "d1_writes" | "subrequests" | "notifications" | "due_jobs";
export type Usage = Record<Resource, number>;
export class BudgetExceeded extends Error {
  constructor(readonly resource: Resource) { super(`Budget exhausted: ${resource}`); }
}
export class Budget {
  readonly usage: Usage = { d1_reads: 0, d1_writes: 0, subrequests: 0, notifications: 0, due_jobs: 0 };
  constructor(readonly limits: BudgetConfig) {}
  can(cost: Partial<Usage>): boolean {
    return Object.entries(cost).every(([key, amount]) => this.usage[key as Resource] + amount <= this.limits[`max_${key}` as keyof BudgetConfig]);
  }
  take(cost: Partial<Usage>): void {
    for (const [key, amount] of Object.entries(cost)) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error("Invalid budget cost");
      if (this.usage[key as Resource] + amount > this.limits[`max_${key}` as keyof BudgetConfig]) throw new BudgetExceeded(key as Resource);
    }
    for (const [key, amount] of Object.entries(cost)) this.usage[key as Resource] += amount;
  }
}
