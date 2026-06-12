import type { ExtensionCost } from "./types";

export interface RuntimeBudget {
  maxSubrequests: number;
  maxD1Reads: number;
  maxD1Writes: number;
  maxNotifications: number;
  maxDueJobs: number;
}

export interface BudgetUsage {
  subrequests: number;
  d1Reads: number;
  d1Writes: number;
  notifications: number;
  dueJobs: number;
}

export interface BudgetDecision {
  allowed: boolean;
  reason?: string;
}

export function createBudgetTracker(budget: RuntimeBudget) {
  const usage: BudgetUsage = {
    subrequests: 0,
    d1Reads: 0,
    d1Writes: 0,
    notifications: 0,
    dueJobs: 0
  };

  return {
    usage,
    canRun(cost: ExtensionCost): BudgetDecision {
      if (usage.dueJobs + 1 > budget.maxDueJobs) return { allowed: false, reason: "max_due_jobs_per_tick" };
      if (usage.subrequests + (cost.subrequestsPerRun ?? 0) > budget.maxSubrequests) {
        return { allowed: false, reason: "max_subrequests_per_tick" };
      }
      if (usage.d1Reads + (cost.d1ReadsPerRun ?? 0) > budget.maxD1Reads) {
        return { allowed: false, reason: "max_d1_queries_per_tick" };
      }
      if (usage.d1Writes + (cost.d1WritesPerRun ?? 0) > budget.maxD1Writes) {
        return { allowed: false, reason: "max_d1_writes_per_tick" };
      }
      if (usage.notifications + (cost.notificationsPerRun ?? 0) > budget.maxNotifications) {
        return { allowed: false, reason: "max_notifications_per_tick" };
      }
      return { allowed: true };
    },
    record(cost: ExtensionCost): void {
      usage.dueJobs += 1;
      usage.subrequests += cost.subrequestsPerRun ?? 0;
      usage.d1Reads += cost.d1ReadsPerRun ?? 0;
      usage.d1Writes += cost.d1WritesPerRun ?? 0;
      usage.notifications += cost.notificationsPerRun ?? 0;
    },
    canNotify(): BudgetDecision {
      if (usage.notifications + 1 > budget.maxNotifications) {
        return { allowed: false, reason: "max_notifications_per_tick" };
      }
      return { allowed: true };
    },
    recordNotification(): void {
      usage.notifications += 1;
    }
  };
}
