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

export type OrbSizePreset = "small" | "medium" | "large";

export const ORB_SIZE_BY_PRESET: Record<OrbSizePreset, number> = {
  small: 88,
  medium: 112,
  large: 136,
};

export const DEFAULT_ORB_SIZE_PRESET: OrbSizePreset = "medium";
export const PANEL_SIZE = {width: 470, height: 390} as const;

export type WindowMotionPhase =
  | "collapsed"
  | "opening-prep"
  | "opening"
  | "expanded"
  | "closing";

export type WindowPreparedStage = "surface" | "expanded-bounds";
export type WindowTransition = "opening" | "closing";

export type OrbPoint = {
  x: number;
  y: number;
};

export type WindowMode = {
  phase: WindowMotionPhase;
  direction: ExpansionDirection;
  originX: number;
  originY: number;
  orbSizePreset: OrbSizePreset;
  orbSize: number;
};

export type LoginSettings = {
  openAtLogin: boolean;
};

export type RendererApi = {
  getSnapshot: () => Promise<QuotaSnapshot>;
  refresh: () => Promise<QuotaSnapshot>;
  toggleWindow: () => void;
  showOrbSizeMenu: () => void;
  notifyWindowPrepared: (stage: WindowPreparedStage) => void;
  notifyWindowTransitionComplete: (transition: WindowTransition) => void;
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
