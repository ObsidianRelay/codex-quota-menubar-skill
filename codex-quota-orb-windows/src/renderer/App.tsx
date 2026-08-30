import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {
  emptySnapshot,
  PANEL_SIZE,
  type QuotaSnapshot,
  type WindowMode,
} from "../shared/types";

const formatPercent = (value: number | null) => (value === null ? "—" : `${value}%`);

const formatTokens = (value: number | null) => {
  if (value === null) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
};

const formatCheckedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", {hour12: false});
};

const formatResetCountdown = (value: string | null, now: number) => {
  if (!value) return "重置时间未知";
  const milliseconds = new Date(value).getTime() - now;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "即将重置";
  const totalHours = Math.floor(milliseconds / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `距离重置还有 ${days} 天 ${hours} 小时`;
};

const usageSummary = (snapshot: QuotaSnapshot) => {
  const usedDays = snapshot.dailyUsage.filter((item) => item.tokens > 0);
  const total = snapshot.dailyUsage.reduce((sum, item) => sum + item.tokens, 0);
  return {
    average: usedDays.length ? Math.round(total / usedDays.length) : 0,
    peak: usedDays.reduce((highest, item) => Math.max(highest, item.tokens), 0),
  };
};

type DragInfo = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

export function App() {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot>(() => emptySnapshot("正在读取"));
  const [mode, setMode] = useState<WindowMode>({
    phase: "collapsed",
    direction: "down",
    originX: 0,
    originY: 0,
    orbSizePreset: "medium",
    orbSize: 112,
  });
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<DragInfo | null>(null);

  useEffect(() => {
    void window.codexQuotaOrb.getSnapshot().then(setSnapshot);
    const unsubscribeSnapshot = window.codexQuotaOrb.onSnapshot(setSnapshot);
    const unsubscribeMode = window.codexQuotaOrb.onWindowMode(setMode);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsubscribeSnapshot();
      unsubscribeMode();
      window.clearInterval(timer);
    };
  }, []);

  useLayoutEffect(() => {
    if (mode.phase !== "opening-prep") return;
    let cancelled = false;
    let boundsNotified = false;
    const surfaceFrame = window.requestAnimationFrame(() => {
      if (!cancelled) window.codexQuotaOrb.notifyWindowPrepared("surface");
    });
    const notifyExpandedBounds = () => {
      if (
        boundsNotified ||
        window.innerWidth < PANEL_SIZE.width - 1 ||
        window.innerHeight < PANEL_SIZE.height - 1
      ) return;
      boundsNotified = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!cancelled) window.codexQuotaOrb.notifyWindowPrepared("expanded-bounds");
        });
      });
    };
    window.addEventListener("resize", notifyExpandedBounds);
    notifyExpandedBounds();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(surfaceFrame);
      window.removeEventListener("resize", notifyExpandedBounds);
    };
  }, [mode.phase]);

  const usage = useMemo(() => usageSummary(snapshot), [snapshot]);
  const maximumDaily = Math.max(1, ...snapshot.dailyUsage.map((item) => item.tokens));
  const weekly = snapshot.remaining7d;
  const panelVisible = mode.phase === "opening" || mode.phase === "expanded";
  const liquidHeight = weekly === null ? 0 : panelVisible ? 8 : weekly;
  const activeSegments = weekly === null ? 0 : Math.round((weekly / 100) * 14);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (mode.phase !== "collapsed" || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false,
    };
    window.codexQuotaOrb.beginDrag(event.screenX, event.screenY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.screenX - drag.current.startX,
      event.screenY - drag.current.startY,
    );
    if (distance > 4) drag.current.moved = true;
    if (drag.current.moved) window.codexQuotaOrb.dragTo(event.screenX, event.screenY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const moved = drag.current.moved;
    drag.current = null;
    window.codexQuotaOrb.endDrag(moved);
    if (!moved) window.codexQuotaOrb.toggleWindow();
  };

  const handlePointerCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    window.codexQuotaOrb.endDrag(false);
  };

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "width") return;
    if (mode.phase === "opening") {
      window.codexQuotaOrb.notifyWindowTransitionComplete("opening");
    }
    if (mode.phase === "closing") {
      window.codexQuotaOrb.notifyWindowTransitionComplete("closing");
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (mode.phase !== "collapsed") return;
    event.preventDefault();
    window.codexQuotaOrb.showOrbSizeMenu();
  };

  return (
    <main
      className={`orb-shell phase-${mode.phase} size-${mode.orbSizePreset} direction-${mode.direction}`}
      style={{
        "--liquid-height": `${liquidHeight}%`,
        "--orb-size": `${mode.orbSize}px`,
        "--orb-scale": mode.orbSize / 112,
        "--origin-x": `${mode.originX}px`,
        "--origin-y": `${mode.originY}px`,
      } as React.CSSProperties}
      title={snapshot.error ?? "Codex Quota Orb"}
    >
      <section
        className="orb-surface"
        onTransitionEnd={handleTransitionEnd}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {weekly !== null && (
          <div className="liquid" aria-hidden="true">
            <svg className="liquid-wave wave-back" viewBox="0 0 1000 40" preserveAspectRatio="none">
              <path d="M-100 19 C70 16 185 23 340 19 S610 16 760 20 S980 22 1100 18 V44 H-100 Z" />
            </svg>
            <svg className="liquid-wave wave-front" viewBox="0 0 1000 40" preserveAspectRatio="none">
              <path d="M-100 20 C80 23 205 16 360 20 S635 24 790 19 S985 17 1100 22 V44 H-100 Z" />
            </svg>
          </div>
        )}

        <div className="glass-highlight" aria-hidden="true" />

        <div className="orb-data" aria-label={`5h ${formatPercent(snapshot.remaining5h)}，7d ${formatPercent(weekly)}`}>
          <div className="quota-line quota-line-five">
            <span>5h</span>
            <strong>{formatPercent(snapshot.remaining5h)}</strong>
          </div>
          <div className="quota-line quota-line-week">
            <span>7d</span>
            <strong>{formatPercent(weekly)}</strong>
          </div>
        </div>

        <div className="panel-content">
          <header className="panel-header">
            <div className="brand">
              <img src="./codex-logo.png" alt="" />
              <span>Codex 额度</span>
            </div>
            <div className="plan">订阅：{snapshot.planType ?? "—"}</div>
          </header>

          <section className="weekly-section">
            <div className="section-row">
              <span className="section-label">7 天窗口</span>
              <strong className="weekly-percent">{formatPercent(weekly)} 剩余</strong>
            </div>
            <div className="segments" aria-label={`7d 剩余 ${formatPercent(weekly)}`}>
              {Array.from({length: 14}, (_, index) => (
                <span key={index} className={index < activeSegments ? "active" : ""} />
              ))}
            </div>
            <div className="quota-meta">
              <span>↻ {formatResetCountdown(snapshot.resetAt7d, now)}</span>
              <span>● 检查于 {formatCheckedAt(snapshot.checkedAt)}</span>
            </div>
          </section>

          <div className="divider" />

          <section className="token-section">
            <div className="section-row token-heading">
              <span className="section-label">本月 Token 使用量</span>
              <span className="monthly">MONTHLY</span>
            </div>
            <div className="token-total">
              {formatTokens(snapshot.monthlyTokens)} <small>tokens</small>
            </div>
            <div className="chart" aria-label="本月每日 Token 使用量">
              {snapshot.dailyUsage.length === 0
                ? Array.from({length: 31}, (_, index) => <span key={index} className="empty-bar" />)
                : snapshot.dailyUsage.map((item) => (
                    <span
                      key={item.date}
                      className="usage-bar"
                      style={{height: `${Math.max(3, (item.tokens / maximumDaily) * 100)}%`}}
                      title={`${item.date}: ${formatTokens(item.tokens)}`}
                    />
                  ))}
            </div>
            <div className="axis">
              <span>1 日</span><span>5 日</span><span>10 日</span><span>15 日</span><span>20 日</span><span>25 日</span><span>30 日</span>
            </div>
            <div className="token-footer">
              <span>单日峰值 {formatTokens(usage.peak)} · 日均 {formatTokens(usage.average)}</span>
              <span>本月</span>
            </div>
          </section>

          {snapshot.error && <div className="read-error">{snapshot.error}</div>}
        </div>
      </section>
    </main>
  );
}
