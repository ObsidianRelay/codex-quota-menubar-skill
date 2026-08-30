import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  Tray,
} from "electron";
import path from "node:path";
import {
  emptySnapshot,
  type OrbSizePreset,
  type QuotaSnapshot,
  type WindowPreparedStage,
  type WindowTransition,
} from "../shared/types";
import {CodexProcessMonitor, type CodexProcessState} from "./codex-process";
import {CodexQuotaReader} from "./quota-reader";
import {SettingsStore} from "./settings";
import {OrbWindowController} from "./window-controller";

app.setAppUserModelId("com.obsidianrelay.codexquotaorb");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let tray: Tray | null = null;
let controller: OrbWindowController | null = null;
let monitor: CodexProcessMonitor | null = null;
let processState: CodexProcessState = {running: false, executablePath: null};
let snapshot: QuotaSnapshot = emptySnapshot("等待 Codex 启动");
let refreshInFlight: Promise<QuotaSnapshot> | null = null;
let manualVisibility: boolean | null = null;

const reader = new CodexQuotaReader();

const iconPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "assets", "codex-logo.png")
    : path.join(app.getAppPath(), "assets", "codex-logo.png");

const publishSnapshot = (next: QuotaSnapshot) => {
  snapshot = next;
  controller?.browserWindow?.webContents.send("quota:snapshot", snapshot);
};

const refreshQuota = async (): Promise<QuotaSnapshot> => {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = reader
    .read(processState.executablePath)
    .then((next) => {
      publishSnapshot(next);
      return next;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
};

const setLoginEnabled = (enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ["--background"],
  });
};

const sizeLabels: Record<OrbSizePreset, string> = {
  small: "小（88 × 88）",
  medium: "中（112 × 112）",
  large: "大（136 × 136）",
};

const buildSizeMenu = () =>
  (Object.keys(sizeLabels) as OrbSizePreset[]).map((preset) => ({
    label: sizeLabels[preset],
    type: "radio" as const,
    checked: controller?.sizePreset === preset,
    click: () => controller?.setOrbSize(preset),
  }));

const rebuildTrayMenu = () => {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings({args: ["--background"]}).openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {label: "立即刷新", click: () => void refreshQuota()},
      {
        label: "显示/隐藏悬浮球",
        click: () => {
          if (!controller) return;
          if (controller.isVisible) {
            controller.hide();
            manualVisibility = false;
          } else {
            controller.show();
            manualVisibility = true;
          }
        },
      },
      {
        label: "开机启动",
        type: "checkbox",
        checked: openAtLogin,
        click: (item) => {
          setLoginEnabled(item.checked);
          rebuildTrayMenu();
        },
      },
      {
        label: "悬浮球尺寸",
        submenu: buildSizeMenu(),
      },
      {type: "separator"},
      {
        label: "退出",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
};

const handleProcessState = (state: CodexProcessState) => {
  const wasRunning = processState.running;
  processState = state;
  if (state.running && !wasRunning) manualVisibility = null;
  if (manualVisibility === true || (manualVisibility === null && state.running)) {
    controller?.show();
  } else if (!state.running) {
    controller?.hide();
  }
  if (state.running) void refreshQuota();
};

const registerIpc = () => {
  ipcMain.handle("quota:get", () => snapshot);
  ipcMain.handle("quota:refresh", () => refreshQuota());
  ipcMain.on("window:toggle", () => {
    if (controller && !controller.isOpen) void refreshQuota();
    void controller?.toggle();
  });
  ipcMain.on("window:size-menu", (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? controller?.browserWindow ?? undefined;
    Menu.buildFromTemplate(buildSizeMenu()).popup({window: owner});
  });
  ipcMain.on("window:prepared", (_event, stage: WindowPreparedStage) =>
    controller?.handleRendererPrepared(stage));
  ipcMain.on("window:transition-complete", (_event, transition: WindowTransition) =>
    controller?.handleTransitionComplete(transition));
  ipcMain.on("window:drag-start", (_event, x: number, y: number) => controller?.beginDrag(x, y));
  ipcMain.on("window:drag-move", (_event, x: number, y: number) => controller?.dragTo(x, y));
  ipcMain.on("window:drag-end", (_event, moved: boolean) => void controller?.endDrag(moved));
};

app.on("second-instance", () => {
  controller?.show();
});

app.on("before-quit", () => {
  monitor?.stop();
});

// 后台托盘应用：所有窗口关闭后继续运行，只有托盘“退出”才结束进程。
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  const settings = new SettingsStore(app.getPath("userData"));
  const stored = await settings.load();
  if (!stored.initialized && process.platform === "win32" && app.isPackaged) {
    setLoginEnabled(true);
    await settings.update({initialized: true});
  }

  controller = new OrbWindowController(settings, () => rebuildTrayMenu());
  registerIpc();
  await controller.create();

  const trayImage = nativeImage.createFromPath(iconPath()).resize({width: 18, height: 18});
  tray = new Tray(trayImage);
  tray.setToolTip("Codex Quota Orb");
  tray.on("click", () => {
    if (!controller) return;
    if (controller.isVisible) controller.hide();
    else controller.show();
  });
  rebuildTrayMenu();

  monitor = new CodexProcessMonitor(handleProcessState);
  monitor.start();
  powerMonitor.on("resume", () => {
    void monitor?.checkNow(true);
    if (processState.running) void refreshQuota();
  });
  setInterval(() => {
    if (processState.running || controller?.isVisible) void refreshQuota();
  }, 180_000).unref();
});
