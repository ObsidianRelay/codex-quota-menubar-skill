import type {UiohookMouseEvent} from "uiohook-napi";

export type ScreenPoint = {x: number; y: number};
export type ScreenBounds = ScreenPoint & {width: number; height: number};

export type GlobalMouseHook = {
  on: (event: "mousedown", listener: (event: UiohookMouseEvent) => void) => unknown;
  off: (event: "mousedown", listener: (event: UiohookMouseEvent) => void) => unknown;
  start: () => void;
  stop: () => void;
};

export const pointIsInsideBounds = (point: ScreenPoint, bounds: ScreenBounds): boolean =>
  point.x >= bounds.x &&
  point.x < bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y < bounds.y + bounds.height;

export const loadWindowsGlobalMouseHook = async (): Promise<GlobalMouseHook | null> => {
  if (process.platform !== "win32") return null;
  try {
    const {uIOhook} = await import("uiohook-napi");
    return uIOhook;
  } catch (error) {
    console.warn("Global outside-click monitoring is unavailable:", error);
    return null;
  }
};

export class OutsideClickMonitor {
  private active = false;
  private outsideClickQueued = false;

  constructor(
    private readonly hook: GlobalMouseHook | null,
    private readonly getBounds: () => ScreenBounds | null,
    private readonly toDipPoint: (point: ScreenPoint) => ScreenPoint,
    private readonly onOutsideClick: () => void,
  ) {}

  private readonly handleMouseDown = (event: UiohookMouseEvent): void => {
    if (!this.active || this.outsideClickQueued) return;
    const bounds = this.getBounds();
    if (!bounds) return;
    const point = this.toDipPoint({x: event.x, y: event.y});
    if (pointIsInsideBounds(point, bounds)) return;

    this.outsideClickQueued = true;
    setImmediate(() => {
      if (!this.active) return;
      this.outsideClickQueued = false;
      this.onOutsideClick();
    });
  };

  start(): void {
    if (!this.hook || this.active) return;
    this.outsideClickQueued = false;
    this.hook.on("mousedown", this.handleMouseDown);
    try {
      this.hook.start();
      this.active = true;
    } catch (error) {
      this.hook.off("mousedown", this.handleMouseDown);
      console.warn("Unable to start global outside-click monitoring:", error);
    }
  }

  stop(): void {
    if (!this.hook || !this.active) return;
    this.active = false;
    this.outsideClickQueued = false;
    this.hook.off("mousedown", this.handleMouseDown);
    try {
      this.hook.stop();
    } catch (error) {
      console.warn("Unable to stop global outside-click monitoring:", error);
    }
  }
}
