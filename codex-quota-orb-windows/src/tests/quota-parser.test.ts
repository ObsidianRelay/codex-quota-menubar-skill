import {describe, expect, it} from "vitest";
import {parseQuotaResponses, usageSummary} from "../main/quota-parser";

const now = new Date("2026-08-15T12:00:00+08:00");

describe("parseQuotaResponses", () => {
  it("parses five-hour and weekly windows even when weekly is secondary", () => {
    const snapshot = parseQuotaResponses(
      {
        result: {
          rateLimits: {
            planType: "plus",
            primary: {windowDurationMins: 300, usedPercent: 18},
            secondary: {windowDurationMins: 10080, usedPercent: 35, resetsAt: 1787024700},
          },
        },
      },
      {result: {dailyUsageBuckets: []}},
      now,
    );
    expect(snapshot.remaining5h).toBe(82);
    expect(snapshot.remaining7d).toBe(65);
    expect(snapshot.planType).toBe("plus");
    expect(snapshot.error).toBeNull();
    expect(snapshot.resetAt7d).not.toBeNull();
  });

  it("accepts weekly-only payloads without fabricating 5h", () => {
    const snapshot = parseQuotaResponses(
      {rateLimits: {primary: {windowDurationMins: 10080, usedPercent: 3}}},
      {},
      now,
    );
    expect(snapshot.remaining5h).toBeNull();
    expect(snapshot.remaining7d).toBe(97);
    expect(snapshot.monthlyTokens).toBeNull();
  });

  it("reads by-limit-id and swapped windows", () => {
    const snapshot = parseQuotaResponses(
      {
        rateLimitsByLimitId: {
          codex: {
            primary: {windowDurationMins: 10080, usedPercent: 12},
            secondary: {windowDurationMins: 300, usedPercent: 25},
          },
        },
      },
      {},
      now,
    );
    expect(snapshot.remaining5h).toBe(75);
    expect(snapshot.remaining7d).toBe(88);
  });

  it("rejects unrelated windows", () => {
    const snapshot = parseQuotaResponses(
      {rateLimits: {primary: {windowDurationMins: 60, usedPercent: 10}}},
      {},
      now,
    );
    expect(snapshot.remaining5h).toBeNull();
    expect(snapshot.remaining7d).toBeNull();
    expect(snapshot.error).toContain("7d");
  });

  it("aggregates only the current month", () => {
    const snapshot = parseQuotaResponses(
      {rateLimits: {primary: {windowDurationMins: 10080, usedPercent: 20}}},
      {
        dailyUsageBuckets: [
          {startDate: "2026-08-01", tokens: 10_000_000},
          {startDate: "2026-08-10", tokens: 20_000_000},
          {startDate: "2026-07-31", tokens: 99_000_000},
        ],
      },
      now,
    );
    expect(snapshot.monthlyTokens).toBe(30_000_000);
    expect(snapshot.dailyUsage).toHaveLength(31);
    expect(usageSummary(snapshot.dailyUsage)).toEqual({
      total: 30_000_000,
      average: 15_000_000,
      peak: 20_000_000,
    });
  });
});
