export type DailyUsage = {
  date: string;
  tokens: number;
};

export type QuotaSnapshot = {
  remaining5h: number | null;
  remaining7d: number | null;
  resetAt7d: string | null;
  checkedAt: string;
  planType: string | null;
  monthlyTokens: number | null;
  dailyUsage: DailyUsage[];
  error: string | null;
};

export type ExpansionDirection = "up" | "down" | "left" | "right";

export type OrbPoint = {
  x: number;
  y: number;
};

export type WindowMode = {
  isOpen: boolean;
  direction: ExpansionDirection;
};

export type LoginSettings = {
  openAtLogin: boolean;
};

export type RendererApi = {
  getSnapshot: () => Promise<QuotaSnapshot>;
  refresh: () => Promise<QuotaSnapshot>;
  toggleWindow: () => void;
  beginDrag: (screenX: number, screenY: number) => void;
  dragTo: (screenX: number, screenY: number) => void;
  endDrag: (moved: boolean) => void;
  onSnapshot: (listener: (snapshot: QuotaSnapshot) => void) => () => void;
  onWindowMode: (listener: (mode: WindowMode) => void) => () => void;
};

export const emptySnapshot = (message: string | null = null): QuotaSnapshot => ({
  remaining5h: null,
  remaining7d: null,
  resetAt7d: null,
  checkedAt: new Date().toISOString(),
  planType: null,
  monthlyTokens: null,
  dailyUsage: [],
  error: message,
});
