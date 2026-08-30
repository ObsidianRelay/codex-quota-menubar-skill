import {emptySnapshot, type DailyUsage, type QuotaSnapshot} from "../shared/types";

const FIVE_HOUR_MINUTES = 300;
const WEEK_MINUTES = 10_080;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const unwrapPayload = (response: unknown): JsonObject => {
  if (!isObject(response)) return {};
  return isObject(response.result) ? response.result : response;
};

const resetValueToIso = (value: unknown): string | null => {
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }
  const numeric = asNumber(value);
  if (numeric === null) return null;
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const collectRateLimitCandidates = (payload: JsonObject): JsonObject[] => {
  const candidates: JsonObject[] = [];
  if (isObject(payload.rateLimits)) candidates.push(payload.rateLimits);
  if (isObject(payload.rateLimitsByLimitId)) {
    for (const value of Object.values(payload.rateLimitsByLimitId)) {
      if (isObject(value)) candidates.push(value);
    }
  }
  if (isObject(payload.primary) || isObject(payload.secondary)) candidates.push(payload);
  return candidates;
};

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const parseDailyUsage = (payload: unknown, now: Date): DailyUsage[] => {
  const unwrapped = unwrapPayload(payload);
  if (!Array.isArray(unwrapped.dailyUsageBuckets)) return [];

  const targetMonth = monthKey(now);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const totals = new Map<string, number>();

  for (const item of unwrapped.dailyUsageBuckets) {
    if (!isObject(item) || typeof item.startDate !== "string") continue;
    const dateKey = item.startDate.slice(0, 10);
    if (!dateKey.startsWith(`${targetMonth}-`)) continue;
    const day = Number(dateKey.slice(8, 10));
    const tokens = asNumber(item.tokens);
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth || tokens === null) continue;
    totals.set(dateKey, (totals.get(dateKey) ?? 0) + Math.max(0, Math.round(tokens)));
  }

  return Array.from({length: daysInMonth}, (_, index) => {
    const date = `${targetMonth}-${String(index + 1).padStart(2, "0")}`;
    return {date, tokens: totals.get(date) ?? 0};
  });
};

export const parseQuotaResponses = (
  rateResponse: unknown,
  usageResponse: unknown,
  now = new Date(),
): QuotaSnapshot => {
  const ratePayload = unwrapPayload(rateResponse);
  const snapshot = emptySnapshot("没有找到真实的 7d 额度");
  snapshot.checkedAt = now.toISOString();

  for (const candidate of collectRateLimitCandidates(ratePayload)) {
    if (snapshot.planType === null && typeof candidate.planType === "string") {
      snapshot.planType = candidate.planType;
    }
    for (const key of ["primary", "secondary"] as const) {
      const window = candidate[key];
      if (!isObject(window)) continue;
      const duration = asNumber(window.windowDurationMins);
      const used = asNumber(window.usedPercent);
      if (duration === null || used === null) continue;
      const remaining = Math.max(0, Math.min(100, Math.round(100 - used)));

      if (duration === FIVE_HOUR_MINUTES && snapshot.remaining5h === null) {
        snapshot.remaining5h = remaining;
      }
      if (duration === WEEK_MINUTES && snapshot.remaining7d === null) {
        snapshot.remaining7d = remaining;
        snapshot.resetAt7d = resetValueToIso(window.resetsAt);
        snapshot.error = null;
      }
    }
  }

  if (snapshot.remaining7d !== null) {
    const usagePayload = unwrapPayload(usageResponse);
    if (Array.isArray(usagePayload.dailyUsageBuckets)) {
      snapshot.dailyUsage = parseDailyUsage(usagePayload, now);
      snapshot.monthlyTokens = snapshot.dailyUsage.reduce((sum, item) => sum + item.tokens, 0);
    }
  }
  return snapshot;
};

export const usageSummary = (dailyUsage: DailyUsage[]) => {
  const activeDays = dailyUsage.filter((item) => item.tokens > 0);
  const total = dailyUsage.reduce((sum, item) => sum + item.tokens, 0);
  return {
    total,
    average: activeDays.length === 0 ? 0 : Math.round(total / activeDays.length),
    peak: activeDays.reduce((highest, item) => Math.max(highest, item.tokens), 0),
  };
};
