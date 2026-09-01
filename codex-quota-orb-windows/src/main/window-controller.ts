import {BrowserWindow, screen} from "electron";
import path from "node:path";
import {
  CLOSE_MS,
  OPEN_MS,
  PREPARE_FALLBACK_MS,
  TRANSITION_FALLBACK_BUFFER_MS,
} from "../shared/animation";
import {
  ORB_SIZE,
  PANEL_SIZE,
  type ExpansionDirection,
  type OrbPoint,
  type WindowMode,
  type WindowPreparedStage,
  type WindowTransition,
} from "../shared/types";
import {SettingsStore} from "./settings";
import {type MotionCommand, WindowMotionCoordinator} from "./window-motion";
import {type GlobalMouseHook, OutsideClickMonitor} from "./outside-click-monitor";
import {
  clampOrbCenter,
  chooseExpansionDirection,
  collapsedBoundsForCenter,
  expandedBoundsForCenter,
  type Bounds,
} from "./window-placement";

type DragState = {
  pointerX: number;
  pointerY: number;
  bounds: Bounds;
};

export class OrbWindowController {
  private window: BrowserWindow | null = null;
  private orbCenter: OrbPoint = {x: 0, y: 0};
  private drag: DragState | null = null;
  private pendingShow = false;
  private direction: ExpansionDirection = "down";
  private originX = 0;
  private originY = 0;
  private expandedBounds: Bounds | null = null;
  private prepareTimer: NodeJS.Timeout | null = null;
  private transitionTimer: NodeJS.Timeout | null = null;
  private readonly motion = new WindowMotionCoordinator();
  private readonly outsideClickMonitor: OutsideClickMonitor;

  constructor(
    private readonly settings: SettingsStore,
    globalMouseHook: GlobalMouseHook | null = null,
  ) {
    this.outsideClickMonitor = new OutsideClickMonitor(
      globalMouseHook,
      () => this.window?.getBounds() ?? null,
      (point) => process.platform === "win32" ? screen.screenToDipPoint(point) : point,
      () => this.collapse(),
    );
  }

  async create(): Promise<BrowserWindow> {
    const stored = this.settings.get();
    const primary = screen.getPrimaryDisplay().workArea;
    const initial = stored.orbCenter ?? {
      x: primary.x + primary.width - ORB_SIZE / 2 - 12,
      y: primary.y + ORB_SIZE / 2 + 12,
    };
    const display = screen.getDisplayNearestPoint(initial).workArea;
    this.orbCenter = clampOrbCenter(initial, display, ORB_SIZE);
    const collapsedBounds = collapsedBoundsForCenter(this.orbCenter, ORB_SIZE);
    this.direction = chooseExpansionDirection(this.orbCenter, display, ORB_SIZE);
    this.expandedBounds = expandedBoundsForCenter(
      this.orbCenter,
      this.direction,
      display,
      ORB_SIZE,
    );
    this.originX = collapsedBounds.x - this.expandedBounds.x;
    this.originY = collapsedBounds.y - this.expandedBounds.y;

    // Resizing and moving a transparent native window while the renderer also
    // changes layout can expose an intermediate compositor frame on Windows.
    // Keep the host at panel size and restrict its native shape to the orb at rest.
    const bounds = process.platform === "win32" ? this.expandedBounds : collapsedBounds;

    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window = window;
    this.applyWindowShape(false);
    window.setAlwaysOnTop(true, "floating");
    window.setSkipTaskbar(true);
    window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window.on("blur", () => {
      if (
        this.motion.phase === "opening-prep" ||
        this.motion.phase === "opening" ||
        this.motion.phase === "expanded"
      ) this.collapse();
    });
    window.on("closed", () => {
      this.outsideClickMonitor.stop();
      this.clearTimers();
      this.window = null;
    });
    window.webContents.on("did-finish-load", () => {
      this.publishMode();
      if (this.pendingShow) {
        this.pendingShow = false;
        window.showInactive();
      }
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      await window.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
    }

    screen.on("display-metrics-changed", () => void this.recoverToVisibleArea());
    screen.on("display-removed", () => void this.recoverToVisibleArea());
    return window;
  }

  get browserWindow(): BrowserWindow | null {
    return this.window;
  }

  get isOpen(): boolean {
    return this.motion.phase !== "collapsed";
  }

  get isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }

  shutdown(): void {
    this.outsideClickMonitor.stop();
    this.clearTimers();
  }

  show(): void {
    if (!this.window) return;
    if (this.window.webContents.isLoading()) {
      this.pendingShow = true;
      return;
    }
    this.publishMode();
    this.window.showInactive();
  }

  hide(): void {
    if (!this.window) return;
    this.outsideClickMonitor.stop();
    this.clearTimers();
    this.execute(this.motion.reset());
    this.window.hide();
  }

  toggle(): void {
    if (this.motion.isAnimating || !this.window) return;
    if (this.motion.phase === "expanded") this.collapse();
    else if (this.motion.phase === "collapsed") this.expand();
  }

  expand(): void {
    if (!this.window || this.motion.phase !== "collapsed") return;
    const workArea = screen.getDisplayNearestPoint(this.orbCenter).workArea;
    this.direction = chooseExpansionDirection(this.orbCenter, workArea, ORB_SIZE);
    const from = collapsedBoundsForCenter(this.orbCenter, ORB_SIZE);
    this.expandedBounds = expandedBoundsForCenter(
      this.orbCenter,
      this.direction,
      workArea,
      ORB_SIZE,
    );
    this.originX = from.x - this.expandedBounds.x;
    this.originY = from.y - this.expandedBounds.y;
    this.applyWindowShape(true);
    this.window.show();
    this.window.focus();
    this.execute(this.motion.beginOpening());
    this.outsideClickMonitor.start();
    this.armPrepareFallback("surface");
  }

  collapse(immediate = false): void {
    if (!this.window) return;
    if (immediate) {
      this.outsideClickMonitor.stop();
      this.clearTimers();
      this.execute(this.motion.reset());
      return;
    }
    const phaseBeforeClosing = this.motion.phase;
    const commands = this.motion.beginClosing();
    if (
      phaseBeforeClosing === "opening-prep" ||
      phaseBeforeClosing === "opening" ||
      commands.length > 0
    ) this.outsideClickMonitor.stop();
    if (commands.length === 0) return;
    this.execute(commands);
    this.armTransitionFallback("closing", CLOSE_MS);
  }

  handleRendererPrepared(stage: WindowPreparedStage): void {
    if (stage === "collapsed-surface") {
      const commands = this.motion.collapsedSurfacePrepared();
      if (commands.length === 0) return;
      this.clearPrepareTimer();
      this.execute(commands);
      return;
    }

    if (stage === "surface") {
      const commands = this.motion.surfacePrepared();
      if (commands.length === 0) return;
      this.clearPrepareTimer();
      this.execute(commands);
      this.armPrepareFallback("expanded-bounds");
      return;
    }

    const commands = this.motion.expandedBoundsPrepared();
    if (commands.length === 0) return;
    this.clearPrepareTimer();
    this.execute(commands);
    this.armTransitionFallback("opening", OPEN_MS);
  }

  handleTransitionComplete(transition: WindowTransition): void {
    const commands = transition === "opening"
      ? this.motion.openingComplete()
      : this.motion.closingComplete();
    if (commands.length === 0) return;
    this.clearTransitionTimer();
    this.execute(commands);
    if (transition === "opening" && this.motion.phase === "closing") {
      this.outsideClickMonitor.stop();
      this.armTransitionFallback("closing", CLOSE_MS);
      return;
    }
    if (transition === "closing") {
      this.armPrepareFallback("collapsed-surface");
    }
  }

  beginDrag(pointerX: number, pointerY: number): void {
    if (!this.window || this.motion.phase !== "collapsed") return;
    this.drag = {pointerX, pointerY, bounds: this.window.getBounds()};
  }

  dragTo(pointerX: number, pointerY: number): void {
    if (!this.window || !this.drag || this.motion.phase !== "collapsed") return;
    this.window.setPosition(
      Math.round(this.drag.bounds.x + pointerX - this.drag.pointerX),
      Math.round(this.drag.bounds.y + pointerY - this.drag.pointerY),
      false,
    );
  }

  async endDrag(moved: boolean): Promise<void> {
    if (!this.window || !this.drag || this.motion.phase !== "collapsed") return;
    this.drag = null;
    if (!moved) return;
    const bounds = this.window.getBounds();
    const center = process.platform === "win32"
      ? {
          x: bounds.x + this.originX + ORB_SIZE / 2,
          y: bounds.y + this.originY + ORB_SIZE / 2,
        }
      : {x: bounds.x + ORB_SIZE / 2, y: bounds.y + ORB_SIZE / 2};
    const workArea = screen.getDisplayNearestPoint(center).workArea;
    const nearest = clampOrbCenter(center, workArea, ORB_SIZE);
    const edgeDistances = [
      {edge: "left", value: nearest.x - workArea.x},
      {edge: "right", value: workArea.x + workArea.width - nearest.x},
      {edge: "top", value: nearest.y - workArea.y},
      {edge: "bottom", value: workArea.y + workArea.height - nearest.y},
    ].sort((a, b) => a.value - b.value);
    const inset = ORB_SIZE / 2 + 12;
    if (edgeDistances[0].edge === "left") nearest.x = workArea.x + inset;
    if (edgeDistances[0].edge === "right") nearest.x = workArea.x + workArea.width - inset;
    if (edgeDistances[0].edge === "top") nearest.y = workArea.y + inset;
    if (edgeDistances[0].edge === "bottom") nearest.y = workArea.y + workArea.height - inset;
    this.orbCenter = nearest;
    this.placeCollapsedWindow(workArea);
    await this.settings.update({orbCenter: nearest});
  }

  private execute(commands: MotionCommand[]): void {
    for (const command of commands) {
      if (command === "publish-mode") this.publishMode();
      if (command === "set-expanded-bounds" && this.expandedBounds) {
        this.window?.setBounds(this.expandedBounds, false);
      }
      if (command === "set-collapsed-bounds") {
        if (process.platform === "win32") this.applyWindowShape(false);
        else this.window?.setBounds(collapsedBoundsForCenter(this.orbCenter, ORB_SIZE), false);
      }
    }
  }

  private placeCollapsedWindow(workArea: Bounds): void {
    if (!this.window) return;
    const collapsed = collapsedBoundsForCenter(this.orbCenter, ORB_SIZE);
    if (process.platform !== "win32") {
      this.window.setBounds(collapsed, false);
      this.publishMode();
      return;
    }

    this.direction = chooseExpansionDirection(this.orbCenter, workArea, ORB_SIZE);
    this.expandedBounds = expandedBoundsForCenter(
      this.orbCenter,
      this.direction,
      workArea,
      ORB_SIZE,
    );
    this.originX = collapsed.x - this.expandedBounds.x;
    this.originY = collapsed.y - this.expandedBounds.y;
    this.window.setBounds(this.expandedBounds, false);
    this.applyWindowShape(false);
    this.publishMode();
  }

  private applyWindowShape(expanded: boolean): void {
    if (!this.window || process.platform !== "win32") return;
    this.window.setShape(expanded
      ? [{x: 0, y: 0, width: PANEL_SIZE.width, height: PANEL_SIZE.height}]
      : [{
          x: Math.round(this.originX),
          y: Math.round(this.originY),
          width: ORB_SIZE,
          height: ORB_SIZE,
        }]);
  }

  private publishMode(): void {
    const mode: WindowMode = {
      phase: this.motion.phase,
      direction: this.direction,
      originX: this.originX,
      originY: this.originY,
    };
    this.window?.webContents.send("window:mode", mode);
  }

  private armPrepareFallback(stage: WindowPreparedStage): void {
    this.clearPrepareTimer();
    this.prepareTimer = setTimeout(
      () => this.handleRendererPrepared(stage),
      PREPARE_FALLBACK_MS,
    );
  }

  private armTransitionFallback(transition: WindowTransition, duration: number): void {
    this.clearTransitionTimer();
    this.transitionTimer = setTimeout(
      () => this.handleTransitionComplete(transition),
      duration + TRANSITION_FALLBACK_BUFFER_MS,
    );
  }

  private clearPrepareTimer(): void {
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    this.prepareTimer = null;
  }

  private clearTransitionTimer(): void {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
  }

  private clearTimers(): void {
    this.clearPrepareTimer();
    this.clearTransitionTimer();
  }

  private async recoverToVisibleArea(): Promise<void> {
    if (!this.window || this.motion.phase !== "collapsed") return;
    const workArea = screen.getDisplayNearestPoint(this.orbCenter).workArea;
    const recovered = clampOrbCenter(this.orbCenter, workArea, ORB_SIZE);
    this.orbCenter = recovered;
    this.placeCollapsedWindow(workArea);
    await this.settings.update({orbCenter: recovered});
  }
}
