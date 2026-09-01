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

export const ORB_SIZE = 88;
export const PANEL_SIZE = {width: 470, height: 390} as const;

export type WindowMotionPhase =
  | "collapsed"
  | "opening-prep"
  | "opening"
  | "expanded"
  | "closing"
  | "closing-ready";

export type WindowPreparedStage = "surface" | "expanded-bounds" | "collapsed-surface";
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
};

export type LoginSettings = {
  openAtLogin: boolean;
};

export type RendererApi = {
  getSnapshot: () => Promise<QuotaSnapshot>;
  refresh: () => Promise<QuotaSnapshot>;
  toggleWindow: () => void;
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
