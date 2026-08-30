import {BrowserWindow, screen} from "electron";
import path from "node:path";
import type {ExpansionDirection, OrbPoint, WindowMode} from "../shared/types";
import {SettingsStore} from "./settings";
import {CLOSE_MS, OPEN_RESIZE_MS, OPEN_SETTLE_MS} from "../shared/animation";
import {
  clampOrbCenter,
  chooseExpansionDirection,
  collapsedBoundsForCenter,
  expandedBoundsForCenter,
  interpolateBounds,
  ORB_SIZE,
  type Bounds,
} from "./window-placement";

type DragState = {
  pointerX: number;
  pointerY: number;
  bounds: Bounds;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class OrbWindowController {
  private window: BrowserWindow | null = null;
  private orbCenter: OrbPoint = {x: 0, y: 0};
  private open = false;
  private animating = false;
  private drag: DragState | null = null;
  private pendingShow = false;

  constructor(private readonly settings: SettingsStore) {}

  async create(): Promise<BrowserWindow> {
    const stored = this.settings.get();
    const primary = screen.getPrimaryDisplay().workArea;
    const initial = stored.orbCenter ?? {
      x: primary.x + primary.width - ORB_SIZE / 2 - 12,
      y: primary.y + ORB_SIZE / 2 + 12,
    };
    const display = screen.getDisplayNearestPoint(initial).workArea;
    this.orbCenter = clampOrbCenter(initial, display);
    const bounds = collapsedBoundsForCenter(this.orbCenter);

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
      },
    });
    this.window = window;
    window.setAlwaysOnTop(true, "floating");
    window.setSkipTaskbar(true);
    window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window.on("blur", () => {
      if (this.open && !this.animating) void this.collapse();
    });
    window.on("closed", () => {
      this.window = null;
    });
    window.webContents.on("did-finish-load", () => {
      this.sendMode({isOpen: false, direction: "down"});
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
    return this.open;
  }

  get isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }

  show(): void {
    if (!this.window) return;
    if (this.window.webContents.isLoading()) {
      this.pendingShow = true;
      return;
    }
    this.window.showInactive();
  }

  hide(): void {
    if (!this.window) return;
    this.open = false;
    this.animating = false;
    this.sendMode({isOpen: false, direction: "down"});
    this.window.setBounds(collapsedBoundsForCenter(this.orbCenter), false);
    this.window.hide();
  }

  async toggle(): Promise<void> {
    if (this.animating || !this.window) return;
    if (this.open) await this.collapse();
    else await this.expand();
  }

  async expand(): Promise<void> {
    if (!this.window || this.open || this.animating) return;
    this.animating = true;
    this.open = true;
    const workArea = screen.getDisplayNearestPoint(this.orbCenter).workArea;
    const direction = chooseExpansionDirection(this.orbCenter, workArea);
    const from = collapsedBoundsForCenter(this.orbCenter);
    const to = expandedBoundsForCenter(this.orbCenter, direction, workArea);
    this.sendMode({isOpen: true, direction});
    this.window.show();
    this.window.focus();
    await this.animateBounds(from, to, OPEN_RESIZE_MS);
    await wait(OPEN_SETTLE_MS);
    this.animating = false;
  }

  async collapse(immediate = false): Promise<void> {
    if (!this.window || (!this.open && !immediate)) return;
    this.animating = true;
    this.open = false;
    this.sendMode({isOpen: false, direction: "down"});
    const to = collapsedBoundsForCenter(this.orbCenter);
    if (immediate) this.window.setBounds(to, false);
    else await this.animateBounds(this.window.getBounds(), to, CLOSE_MS);
    this.animating = false;
  }

  beginDrag(pointerX: number, pointerY: number): void {
    if (!this.window || this.open || this.animating) return;
    this.drag = {pointerX, pointerY, bounds: this.window.getBounds()};
  }

  dragTo(pointerX: number, pointerY: number): void {
    if (!this.window || !this.drag || this.open) return;
    this.window.setPosition(
      Math.round(this.drag.bounds.x + pointerX - this.drag.pointerX),
      Math.round(this.drag.bounds.y + pointerY - this.drag.pointerY),
      false,
    );
  }

  async endDrag(moved: boolean): Promise<void> {
    if (!this.window || !this.drag || this.open) return;
    this.drag = null;
    if (!moved) return;
    const bounds = this.window.getBounds();
    const center = {x: bounds.x + ORB_SIZE / 2, y: bounds.y + ORB_SIZE / 2};
    const workArea = screen.getDisplayNearestPoint(center).workArea;
    const nearest = clampOrbCenter(center, workArea);
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
    const target = collapsedBoundsForCenter(nearest);
    await this.animateBounds(bounds, target, 180);
    this.orbCenter = nearest;
    await this.settings.update({orbCenter: nearest});
  }

  private sendMode(mode: WindowMode): void {
    this.window?.webContents.send("window:mode", mode);
  }

  private async animateBounds(from: Bounds, to: Bounds, duration: number): Promise<void> {
    if (!this.window) return;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (!this.window || this.window.isDestroyed()) {
          resolve();
          return;
        }
        const progress = Math.min(1, (performance.now() - start) / duration);
        this.window.setBounds(interpolateBounds(from, to, progress), false);
        if (progress >= 1) resolve();
        else setTimeout(tick, 16);
      };
      tick();
    });
  }

  private async recoverToVisibleArea(): Promise<void> {
    if (!this.window || this.open || this.animating) return;
    const workArea = screen.getDisplayNearestPoint(this.orbCenter).workArea;
    const recovered = clampOrbCenter(this.orbCenter, workArea);
    this.orbCenter = recovered;
    this.window.setBounds(collapsedBoundsForCenter(recovered), false);
    await this.settings.update({orbCenter: recovered});
  }
}
