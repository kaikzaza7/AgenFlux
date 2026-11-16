// ---------------------------------------------------------------------------
// Mapa do escritório em grade de tiles (16 px) e navegação.
//
// Tudo aqui é lógica pura (sem DOM), para poder ser testada no Node: a planta, os
// obstáculos, o A* e os destinos associados a cada estado real de um agente.
// ---------------------------------------------------------------------------

export const TILE = 16;
export const COLS = 46;
export const ROWS = 26;
export interface Cell { x: number; y: number }
export type Floor = "work" | "meeting" | "approval" | "common" | "door";
export interface Prop { kind: string; x: number; y: number; w: number; h: number; solid: boolean; variant?: number }

const key = (x: number, y: number) => y * COLS + x;
const walls = new Set<number>();
const floors = new Map<number, Floor>();
export const PROPS: Prop[] = [];

function rect(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y); }
function wall(x0: number, y0: number, x1: number, y1: number) { rect(x0, y0, x1, y1, (x, y) => walls.add(key(x, y))); }
function door(x0: number, y0: number, x1: number, y1: number) { rect(x0, y0, x1, y1, (x, y) => { walls.delete(key(x, y)); floors.set(key(x, y), "door"); }); }
function prop(kind: string, x: number, y: number, w = 1, h = 1, solid = true, variant?: number) { PROPS.push({ kind, x, y, w, h, solid, variant }); }

// --- Salas -----------------------------------------------------------------
rect(1, 2, 29, 14, (x, y) => floors.set(key(x, y), "work"));       // estações de trabalho
rect(31, 2, 44, 10, (x, y) => floors.set(key(x, y), "meeting"));   // sala de reuniões
rect(31, 12, 44, 24, (x, y) => floors.set(key(x, y), "approval")); // sala de aprovações
rect(1, 16, 29, 24, (x, y) => floors.set(key(x, y), "common"));    // área comum

// --- Paredes (a linha 1 é a "face" da parede superior, estilo RPG 16-bit) ---
wall(0, 0, COLS - 1, 1); wall(0, ROWS - 1, COLS - 1, ROWS - 1); wall(0, 0, 0, ROWS - 1); wall(COLS - 1, 0, COLS - 1, ROWS - 1);
wall(30, 2, 30, ROWS - 2);   // divisória vertical
wall(1, 15, 29, 15);         // estações | área comum
wall(31, 11, 44, 11);        // reuniões | aprovações
// --- Portas ----------------------------------------------------------------
door(30, 5, 30, 6);    // estações ↔ reuniões
door(30, 13, 30, 14);  // estações ↔ aprovações
door(30, 19, 30, 20);  // área comum ↔ aprovações
door(7, 15, 8, 15); door(21, 15, 22, 15); // estações ↔ área comum
door(37, 11, 38, 11);  // reuniões ↔ aprovações

// --- Estações de trabalho: 8 mesas (2 fileiras de 4) ------------------------
export const DESKS: { desk: Cell; seat: Cell }[] = [];
for (const row of [4, 10]) for (const x of [3, 10, 17, 24]) { DESKS.push({ desk: { x, y: row }, seat: { x: x + 1, y: row + 1 } }); prop("desk", x, row, 3, 1, true, DESKS.length - 1); }

// --- Mobiliário --------------------------------------------------------------
prop("plant", 1, 2); prop("plant", 29, 2); prop("plant", 1, 14); prop("server", 28, 13, 2, 2); prop("shelf", 14, 2, 2, 1); prop("window", 5, 0, 3, 2, false); prop("window", 19, 0, 3, 2, false);
prop("printer", 22, 2, 2, 1);
// Sala de reuniões
prop("table", 35, 5, 6, 3); prop("whiteboard", 36, 0, 4, 2, false); prop("plant", 31, 2); prop("plant", 44, 2); prop("screen", 43, 5, 1, 3);
// Sala de aprovações
prop("approval-desk", 36, 15, 4, 2); prop("plant", 44, 12); prop("plant", 31, 24); prop("cabinet", 42, 12, 2, 1); prop("rug", 34, 18, 8, 3, false); prop("sign", 33, 12, 2, 1);
// Área comum
prop("sofa", 3, 22, 4, 2); prop("coffee", 12, 16, 3, 1); prop("cooler", 16, 16); prop("round-table", 20, 20, 2, 2); prop("plant", 1, 24); prop("plant", 29, 24); prop("plant", 29, 16);
prop("rug", 2, 19, 6, 3, false); prop("vending", 26, 16, 2, 1); prop("round-table", 11, 21, 2, 2); prop("window", 13, 25, 3, 1, false);

const solid = new Set<number>(walls);
for (const p of PROPS) if (p.solid) rect(p.x, p.y, p.x + p.w - 1, p.y + p.h - 1, (x, y) => solid.add(key(x, y)));

export const isWall = (x: number, y: number) => walls.has(key(x, y));
export const floorAt = (x: number, y: number) => floors.get(key(x, y));
export function walkable(x: number, y: number) { return x >= 0 && y >= 0 && x < COLS && y < ROWS && !solid.has(key(x, y)) && floors.has(key(x, y)); }

// --- Destinos por estado real ------------------------------------------------
export const MEETING_SPOTS: Cell[] = [{ x: 35, y: 4 }, { x: 37, y: 4 }, { x: 39, y: 4 }, { x: 34, y: 6 }, { x: 41, y: 6 }, { x: 35, y: 8 }, { x: 37, y: 8 }, { x: 39, y: 8 }];
export const APPROVAL_SPOTS: Cell[] = [{ x: 36, y: 17 }, { x: 38, y: 17 }, { x: 35, y: 18 }, { x: 37, y: 18 }, { x: 39, y: 18 }, { x: 36, y: 19 }, { x: 38, y: 19 }, { x: 40, y: 19 }];
export const LOUNGE_SPOTS: Cell[] = [{ x: 3, y: 21 }, { x: 7, y: 20 }, { x: 13, y: 17 }, { x: 16, y: 17 }, { x: 10, y: 19 }, { x: 19, y: 19 }, { x: 22, y: 22 }, { x: 25, y: 18 }, { x: 27, y: 17 }, { x: 14, y: 23 }, { x: 24, y: 23 }, { x: 5, y: 17 }, { x: 18, y: 23 }, { x: 9, y: 23 }, { x: 27, y: 21 }, { x: 13, y: 20 }];
export const ROOM_LABELS = [{ text: "ESTAÇÕES", x: 9, y: 2 }, { text: "REUNIÕES", x: 32, y: 2 }, { text: "APROVAÇÕES", x: 35, y: 12 }, { text: "ÁREA COMUM", x: 20, y: 16 }];

export type Place = "desk" | "meeting" | "approval" | "lounge";
// Onde um agente deve estar para cada status real da sua tarefa.
export function placeFor(status: string): Place {
  if (status === "running" || status === "queued" || status === "failed") return "desk"; // trabalhando, missão recebida, erro
  if (status === "approval") return "approval";                                            // aguardando a sua decisão
  if (status === "waiting") return "meeting";                                              // aguardando a entrega de outro agente
  return "lounge";                                                                         // ocioso, concluído, cancelado, interrompido
}
export function destination(index: number, status: string): Cell {
  const place = placeFor(status); const i = Math.abs(index) % 8;
  if (place === "desk") return DESKS[i].seat;
  if (place === "approval") return APPROVAL_SPOTS[i];
  if (place === "meeting") return MEETING_SPOTS[i];
  return LOUNGE_SPOTS[(i * 2) % LOUNGE_SPOTS.length];
}

// --- A* em grade de 4 direções ----------------------------------------------
// A grade é pequena (46×26), então uma busca custa microssegundos. Devolve o
// caminho sem a célula inicial; lista vazia se não houver rota ou já estiver lá.
export function findPath(from: Cell, to: Cell): Cell[] {
  if (!walkable(from.x, from.y) || !walkable(to.x, to.y) || (from.x === to.x && from.y === to.y)) return [];
  const open: number[] = [key(from.x, from.y)];
  const cameFrom = new Map<number, number>(); const g = new Map<number, number>([[open[0], 0]]); const f = new Map<number, number>();
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  f.set(open[0], h(from.x, from.y));
  const goal = key(to.x, to.y); const closed = new Set<number>();
  while (open.length) {
    let best = 0; for (let i = 1; i < open.length; i++) if ((f.get(open[i]) ?? Infinity) < (f.get(open[best]) ?? Infinity)) best = i;
    const current = open.splice(best, 1)[0];
    if (current === goal) {
      const path: Cell[] = [];
      for (let at: number | undefined = current; at !== undefined && at !== key(from.x, from.y); at = cameFrom.get(at)) path.push({ x: at % COLS, y: Math.floor(at / COLS) });
      return path.reverse();
    }
    closed.add(current);
    const cx = current % COLS, cy = Math.floor(current / COLS);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx, ny = cy + dy, next = key(nx, ny);
      if (!walkable(nx, ny) || closed.has(next)) continue;
      const cost = (g.get(current) ?? 0) + 1;
      if (cost >= (g.get(next) ?? Infinity)) continue;
      cameFrom.set(next, current); g.set(next, cost); f.set(next, cost + h(nx, ny));
      if (!open.includes(next)) open.push(next);
    }
  }
  return [];
}

// --- Caminhante ---------------------------------------------------------------
export type Direction = "down" | "up" | "left" | "right";
export interface Walker { x: number; y: number; cell: Cell; path: Cell[]; dir: Direction; moving: boolean }
export const createWalker = (cell: Cell): Walker => ({ x: cell.x, y: cell.y, cell: { ...cell }, path: [], dir: "down", moving: false });
export function setTarget(walker: Walker, target: Cell) {
  const path = findPath(walker.cell, target);
  // Se estiver no meio de um passo, termina-o antes: nunca corta cantos nem atravessa paredes.
  walker.path = walker.x === walker.cell.x && walker.y === walker.cell.y ? path : [{ ...walker.cell }, ...path];
}
// Avança `distance` tiles ao longo do caminho, atualizando direção e posição.
export function step(walker: Walker, distance: number) {
  walker.moving = walker.path.length > 0;
  while (walker.path.length && distance > 0) {
    const next = walker.path[0]; const dx = next.x - walker.x, dy = next.y - walker.y; const remaining = Math.abs(dx) + Math.abs(dy);
    if (remaining > 0.0001) walker.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    if (remaining <= distance) { walker.x = next.x; walker.y = next.y; walker.cell = { ...next }; walker.path.shift(); distance -= remaining; }
    else { walker.x += Math.sign(dx) * distance; walker.y += Math.sign(dy) * distance; distance = 0; }
  }
}
