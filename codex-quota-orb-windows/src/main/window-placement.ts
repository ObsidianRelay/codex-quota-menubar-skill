import type {ExpansionDirection, OrbPoint} from "../shared/types";

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const ORB_SIZE = 112;
export const PANEL_SIZE = {width: 470, height: 390};
export const EDGE_MARGIN = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const clampOrbCenter = (point: OrbPoint, workArea: Bounds): OrbPoint => ({
  x: clamp(
    point.x,
    workArea.x + EDGE_MARGIN + ORB_SIZE / 2,
    workArea.x + workArea.width - EDGE_MARGIN - ORB_SIZE / 2,
  ),
  y: clamp(
    point.y,
    workArea.y + EDGE_MARGIN + ORB_SIZE / 2,
    workArea.y + workArea.height - EDGE_MARGIN - ORB_SIZE / 2,
  ),
});

export const snapOrbCenter = (point: OrbPoint, workArea: Bounds): OrbPoint => {
  const clamped = clampOrbCenter(point, workArea);
  const edges = [
    {edge: "left", distance: clamped.x - workArea.x},
    {edge: "right", distance: workArea.x + workArea.width - clamped.x},
    {edge: "top", distance: clamped.y - workArea.y},
    {edge: "bottom", distance: workArea.y + workArea.height - clamped.y},
  ].sort((a, b) => a.distance - b.distance);
  const inset = EDGE_MARGIN + ORB_SIZE / 2;
  const snapped = {...clamped};
  if (edges[0].edge === "left") snapped.x = workArea.x + inset;
  if (edges[0].edge === "right") snapped.x = workArea.x + workArea.width - inset;
  if (edges[0].edge === "top") snapped.y = workArea.y + inset;
  if (edges[0].edge === "bottom") snapped.y = workArea.y + workArea.height - inset;
  return snapped;
};

export const chooseExpansionDirection = (
  orb: OrbPoint,
  workArea: Bounds,
): ExpansionDirection => {
  const half = ORB_SIZE / 2;
  const distanceToEdges = [
    {edge: "top", distance: orb.y - half - workArea.y},
    {edge: "right", distance: workArea.x + workArea.width - orb.x - half},
    {edge: "bottom", distance: workArea.y + workArea.height - orb.y - half},
    {edge: "left", distance: orb.x - half - workArea.x},
  ].sort((a, b) => a.distance - b.distance);

  const opposite: Record<string, ExpansionDirection> = {
    top: "down",
    right: "left",
    bottom: "up",
    left: "right",
  };
  const priority = distanceToEdges.map((item) => opposite[item.edge]);
  const space: Record<ExpansionDirection, number> = {
    up: orb.y + half - workArea.y,
    down: workArea.y + workArea.height - (orb.y - half),
    left: orb.x + half - workArea.x,
    right: workArea.x + workArea.width - (orb.x - half),
  };
  const required: Record<ExpansionDirection, number> = {
    up: PANEL_SIZE.height,
    down: PANEL_SIZE.height,
    left: PANEL_SIZE.width,
    right: PANEL_SIZE.width,
  };
  return (
    priority.find((direction) => space[direction] >= required[direction]) ??
    (["up", "down", "left", "right"] as ExpansionDirection[]).sort(
      (a, b) => space[b] / required[b] - space[a] / required[a],
    )[0]
  );
};

export const collapsedBoundsForCenter = (orb: OrbPoint): Bounds => ({
  x: Math.round(orb.x - ORB_SIZE / 2),
  y: Math.round(orb.y - ORB_SIZE / 2),
  width: ORB_SIZE,
  height: ORB_SIZE,
});

export const expandedBoundsForCenter = (
  orb: OrbPoint,
  direction: ExpansionDirection,
  workArea: Bounds,
): Bounds => {
  const half = ORB_SIZE / 2;
  let x = orb.x - half;
  let y = orb.y - half;
  if (direction === "left") x = orb.x + half - PANEL_SIZE.width;
  if (direction === "up") y = orb.y + half - PANEL_SIZE.height;
  if (direction === "down") y = orb.y - half;
  if (direction === "right") x = orb.x - half;

  return {
    x: Math.round(clamp(x, workArea.x, workArea.x + workArea.width - PANEL_SIZE.width)),
    y: Math.round(clamp(y, workArea.y, workArea.y + workArea.height - PANEL_SIZE.height)),
    ...PANEL_SIZE,
  };
};

export const easeOutQuint = (value: number) => 1 - Math.pow(1 - value, 5);

export const interpolateBounds = (from: Bounds, to: Bounds, progress: number): Bounds => {
  const eased = easeOutQuint(clamp(progress, 0, 1));
  return {
    x: Math.round(from.x + (to.x - from.x) * eased),
    y: Math.round(from.y + (to.y - from.y) * eased),
    width: Math.round(from.width + (to.width - from.width) * eased),
    height: Math.round(from.height + (to.height - from.height) * eased),
  };
};
