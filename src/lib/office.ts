export interface Point { x: number; y: number }
export interface Obstacle { x: number; y: number; w: number; h: number }

export const DESKS = Array.from({ length: 8 }, (_, index) => ({
  x: 100 + (index % 4) * 130,
  y: index < 4 ? 80 : 280,
}));
export const WALLS: Obstacle[] = [
  { x: 568, y: 17, w: 5, h: 128 },
  { x: 568, y: 196, w: 5, h: 169 },
  { x: 568, y: 416, w: 5, h: 10 },
  { x: 17, y: 218, w: 553, h: 5 },
  { x: 623, y: 17, w: 5, h: 128 },
  { x: 623, y: 196, w: 5, h: 27 },
  { x: 623, y: 218, w: 220, h: 5 },
];
export const APPROVAL_TABLE = { x: 673, y: 93, w: 90, h: 64 };
export const CAFE = { x: 637, y: 277, w: 157, h: 45 };
export const BENCH = { x: 652, y: 362, w: 107, h: 29 };
export const PLANTS = [{ x: 819, y: 45 }, { x: 811, y: 392 }];
export const deskBounds = (point: Point): Obstacle => ({ x: point.x - 54, y: point.y, w: 108, h: 55 });
export const chairBounds = (point: Point): Obstacle => ({ x: point.x - 23, y: point.y + 60, w: 46, h: 38 });

const step = 5;
const radius = 14;
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const neighbors = [[step, 0], [-step, 0], [0, step], [0, -step]];

export function walkable(point: Point, deskCount = DESKS.length) {
  return canWalk(point, obstacles(deskCount));
}
function obstacles(deskCount: number) {
  const desks = DESKS.slice(0, deskCount);
  return [...WALLS, ...desks.map(deskBounds), ...desks.map(chairBounds), APPROVAL_TABLE, CAFE, BENCH,
    ...PLANTS.map(p => ({ x: p.x - 15, y: p.y - 15, w: 30, h: 30 }))];
}
function canWalk({ x, y }: Point, furniture: Obstacle[]) {
  return x >= 35 && x <= 825 && y >= 35 && y <= 410 &&
    !furniture.some(o => x > o.x - radius && x < o.x + o.w + radius && y > o.y - radius && y < o.y + o.h + radius);
}
export function destination(index: number, status: string): Point {
  const desk = DESKS[index];
  if (status === "running") return { x: desk.x + 40, y: desk.y + 80 };
  if (status === "approval") return { x: index < 4 ? 645 : 790, y: [85, 115, 155, 195][index % 4] };
  return { x: 605 + (index % 4) * 55, y: index < 4 ? 345 : 410 };
}
export function canPatrol(status: string) {
  return ["idle", "completed", "interrupted", "cancelled"].includes(status);
}
export function patrolTarget(index: number, atStation: boolean) {
  return destination(index, atStation ? "idle" : "running");
}

export function route(start: Point, end: Point, deskCount = DESKS.length): Point[] {
  const furniture = obstacles(deskCount);
  const key = (p: Point) => p.y * 1000 + p.x;
  if (!canWalk(start, furniture) || !canWalk(end, furniture) || samePoint(start, end)) return [];
  const queue: Point[] = [start];
  const previous = new Map<number, Point | null>([[key(start), null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (samePoint(current, end)) {
      const path: Point[] = [];
      for (let at: Point | null = current; at && !samePoint(at, start); at = previous.get(key(at)) ?? null) path.push(at);
      return path.reverse();
    }
    for (const [dx, dy] of neighbors) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (previous.has(key(next)) || !canWalk(next, furniture)) continue;
      previous.set(key(next), current);
      queue.push(next);
    }
  }
  return [];
}

export interface Walker { point: Point; anchor: Point; path: Point[] }
export function setWalkingTarget(walker: Walker, target: Point, deskCount: number) {
  const path = route(walker.anchor, target, deskCount);
  // A status can change mid-step. Return to the last grid point instead of cutting across a corner.
  walker.path = samePoint(walker.point, walker.anchor) ? path : [walker.anchor, ...path];
}
export function walkStep(walker: Walker, distance: number) {
  while (walker.path.length && distance > 0) {
    const target = walker.path[0];
    const dx = target.x - walker.point.x, dy = target.y - walker.point.y;
    const remaining = Math.hypot(dx, dy);
    if (remaining <= distance) {
      walker.point = walker.anchor = target;
      walker.path.shift();
      distance -= remaining;
    } else {
      walker.point = { x: walker.point.x + dx / remaining * distance, y: walker.point.y + dy / remaining * distance };
      break;
    }
  }
}
