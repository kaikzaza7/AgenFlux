import { COLS, ROWS, TILE, PROPS, ROOM_LABELS, floorAt, isWall, type Direction, type Prop } from "./map.ts";

// ---------------------------------------------------------------------------
// Arte pixel ORIGINAL do AgenFlux, desenhada por código (retângulos de 1 px).
// Não há imagens externas: nenhum sprite de terceiros é usado, então não existe
// pendência de licença. Veja docs/ASSETS.md para a pesquisa de pacotes CC0 e como
// trocar esta arte por um pacote externo, se desejar.
// Estética: RPG 16-bit visto de cima, mas com mobília de escritório de tecnologia.
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
const px = (ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

// ------------------------------------------------------------- personagens
export interface Look { skin: string; hair: string; style: number; shirt: string; pants: string; accessory?: "glasses" | "headset" | "cap" | "tie" | "badge" | "scarf" }
// 12 aparências, mesma escala (16×20). Os 8 primeiros acompanham a equipe padrão.
export const LOOKS: Look[] = [
  { skin: "#e8b796", hair: "#3a2b25", style: 0, shirt: "#2f3a5c", pants: "#23263a", accessory: "tie" },      // Orquestrador
  { skin: "#c98d6b", hair: "#1c1a1f", style: 1, shirt: "#4d8fd6", pants: "#39415a", accessory: "glasses" },  // Analista
  { skin: "#f0c8a8", hair: "#7b4a2d", style: 2, shirt: "#8f7be0", pants: "#3b3552" },                         // Planejador
  { skin: "#a8734f", hair: "#22181a", style: 3, shirt: "#3fae9a", pants: "#2c3a44", accessory: "headset" },  // Desenvolvedor
  { skin: "#eac0a0", hair: "#c9a24b", style: 4, shirt: "#e0a04e", pants: "#4a3d33" },                         // Revisor
  { skin: "#8a5a3c", hair: "#16161a", style: 0, shirt: "#c94f5f", pants: "#2a2a33", accessory: "cap" },      // Segurança
  { skin: "#f2d0b4", hair: "#a8432f", style: 5, shirt: "#8fbf5a", pants: "#3e4a36", accessory: "scarf" },    // Documentador
  { skin: "#d9a57f", hair: "#4a4f66", style: 1, shirt: "#6fc3e0", pants: "#33465a", accessory: "badge" },    // Testador
  { skin: "#e8b796", hair: "#5b3a8c", style: 2, shirt: "#d6d6d6", pants: "#444444" },
  { skin: "#b07a55", hair: "#2a2a2a", style: 4, shirt: "#e07b9a", pants: "#3a3040", accessory: "glasses" },
  { skin: "#f0c8a8", hair: "#1f3b4d", style: 3, shirt: "#f2d16b", pants: "#4b4636" },
  { skin: "#9c6846", hair: "#e6e6e6", style: 5, shirt: "#7a8aa0", pants: "#2e3440", accessory: "headset" },
];
const OUTLINE = "#15151c";
const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

// Desenha um quadro do personagem no canto (0,0) de uma célula 16×20.
// frame: 0 e 2 = parado; 1 e 3 = passos alternados.
function drawCharacter(ctx: Ctx, look: Look, dir: Direction, frame: number) {
  const side = dir === "left" || dir === "right";
  const stepA = frame === 1, stepB = frame === 3;
  // sombra
  px(ctx, "rgba(0,0,0,.28)", 4, 18, 8, 2); px(ctx, "rgba(0,0,0,.28)", 3, 19, 10, 1);
  // pernas e sapatos
  if (side) {
    px(ctx, OUTLINE, 5, 14, 6, 5);
    px(ctx, look.pants, 6, 14, 2, stepA ? 3 : 4); px(ctx, look.pants, 8, 14, 2, stepB ? 3 : 4);
    px(ctx, "#1a1a1f", stepA ? 5 : 6, stepA ? 17 : 18, 3, 1); px(ctx, "#1a1a1f", stepB ? 9 : 8, stepB ? 17 : 18, 3, 1);
  } else {
    px(ctx, OUTLINE, 4, 14, 8, 5);
    px(ctx, look.pants, 5, 14, 3, stepA ? 3 : 4); px(ctx, look.pants, 8, 14, 3, stepB ? 3 : 4);
    px(ctx, "#1a1a1f", 5, stepA ? 17 : 18, 3, 1); px(ctx, "#1a1a1f", 8, stepB ? 17 : 18, 3, 1);
  }
  // tronco
  const dark = shade(look.shirt, -38);
  if (side) {
    px(ctx, OUTLINE, 4, 9, 8, 6); px(ctx, look.shirt, 5, 10, 6, 5); px(ctx, dark, 5, 14, 6, 1);
    const swing = stepA ? -1 : stepB ? 1 : 0;
    px(ctx, dark, 7 + swing, 11, 2, 3); px(ctx, look.skin, 7 + swing, 14, 2, 1);
  } else {
    px(ctx, OUTLINE, 2, 9, 12, 7); px(ctx, look.shirt, 4, 10, 8, 5); px(ctx, dark, 4, 14, 8, 1);
    px(ctx, look.shirt, 3, 10, 1, stepA ? 3 : 4); px(ctx, look.shirt, 12, 10, 1, stepB ? 3 : 4);
    px(ctx, look.skin, 3, stepA ? 13 : 14, 1, 1); px(ctx, look.skin, 12, stepB ? 13 : 14, 1, 1);
    if (dir === "down") {
      if (look.accessory === "tie") { px(ctx, "#e8e8e8", 7, 10, 2, 2); px(ctx, "#d14b4b", 7, 11, 2, 3); }
      if (look.accessory === "badge") { px(ctx, "#f4f4f4", 9, 11, 2, 2); px(ctx, "#3a6ad6", 9, 11, 2, 1); }
      if (look.accessory === "scarf") px(ctx, "#e9d36a", 5, 10, 6, 1);
    }
  }
  // cabeça
  px(ctx, OUTLINE, 4, 1, 8, 10); px(ctx, OUTLINE, 3, 2, 10, 8);
  px(ctx, look.skin, 4, 3, 8, 7); px(ctx, shade(look.skin, -22), 4, 9, 8, 1);
  // cabelo (6 estilos)
  const hair = look.hair, hairDark = shade(look.hair, -25);
  if (dir === "up") { px(ctx, hair, 4, 2, 8, 7); px(ctx, hairDark, 4, 8, 8, 1); if (look.style === 2 || look.style === 5) px(ctx, hair, 4, 9, 8, 2); }
  else {
    px(ctx, hair, 4, 2, 8, 2);
    if (look.style === 0) { px(ctx, hair, 4, 4, 1, 2); px(ctx, hair, 11, 4, 1, 2); }                          // curto
    if (look.style === 1) { px(ctx, hair, 4, 4, 3, 1); px(ctx, hair, 11, 4, 1, 1); }                          // franja lateral
    if (look.style === 2) { px(ctx, hair, 4, 4, 1, 5); px(ctx, hair, 11, 4, 1, 5); px(ctx, hair, 6, 1, 4, 1); } // coque
    if (look.style === 3) { px(ctx, hair, 5, 1, 1, 1); px(ctx, hair, 8, 1, 1, 1); px(ctx, hair, 10, 1, 1, 1); px(ctx, hair, 4, 4, 2, 1); } // espetado
    if (look.style === 4) { px(ctx, hair, 4, 4, 8, 1); px(ctx, hairDark, 4, 4, 8, 1); }                       // franja reta
    if (look.style === 5) { px(ctx, hair, 4, 4, 1, 6); px(ctx, hair, 11, 4, 1, 6); px(ctx, hair, 5, 4, 2, 1); } // longo
    if (side) px(ctx, hair, 4, 4, 2, 4);
    // rosto
    if (dir === "down") { px(ctx, "#1d1d24", 6, 6, 1, 2); px(ctx, "#1d1d24", 9, 6, 1, 2); px(ctx, shade(look.skin, -40), 7, 9, 2, 1); }
    else px(ctx, "#1d1d24", 9, 6, 1, 2);
    if (look.accessory === "glasses") { if (dir === "down") { px(ctx, "#e9f2ff", 5, 6, 3, 2); px(ctx, "#e9f2ff", 8, 6, 3, 2); px(ctx, "#1d1d24", 6, 6, 1, 2); px(ctx, "#1d1d24", 9, 6, 1, 2); px(ctx, "#40485c", 5, 5, 6, 1); } else { px(ctx, "#e9f2ff", 8, 6, 3, 2); px(ctx, "#1d1d24", 9, 6, 1, 2); } }
  }
  if (look.accessory === "headset") { px(ctx, "#d8d8de", 4, 1, 8, 1); px(ctx, "#d8d8de", 3, 4, 1, 3); px(ctx, "#d8d8de", 12, 4, 1, 3); if (dir !== "up") px(ctx, "#8ef0c8", 11, 8, 2, 1); }
  if (look.accessory === "cap") { px(ctx, "#20242e", 4, 1, 8, 3); if (dir === "down") px(ctx, "#20242e", 3, 4, 10, 1); else if (side) px(ctx, "#20242e", 9, 4, 4, 1); px(ctx, "#f2d16b", 7, 2, 2, 1); }
}

const SHEET_DIRS: Direction[] = ["down", "up", "right", "left"];
export const SPRITE_W = 16, SPRITE_H = 20;
const sheets = new Map<number, HTMLCanvasElement>();
// Folha 4 direções × 4 quadros, gerada uma única vez por aparência.
export function spriteSheet(index: number): HTMLCanvasElement {
  const id = Math.abs(index) % LOOKS.length;
  let sheet = sheets.get(id);
  if (!sheet) {
    sheet = document.createElement("canvas"); sheet.width = SPRITE_W * 4; sheet.height = SPRITE_H * 4;
    const ctx = sheet.getContext("2d")!;
    SHEET_DIRS.forEach((dir, row) => { for (let frame = 0; frame < 4; frame++) {
      ctx.save(); ctx.translate(frame * SPRITE_W, row * SPRITE_H);
      if (dir === "left") { ctx.translate(SPRITE_W, 0); ctx.scale(-1, 1); drawCharacter(ctx, LOOKS[id], "right", frame); } else drawCharacter(ctx, LOOKS[id], dir, frame);
      ctx.restore();
    } });
    sheets.set(id, sheet);
  }
  return sheet;
}
export function drawSprite(ctx: Ctx, index: number, dir: Direction, frame: number, x: number, y: number) {
  ctx.drawImage(spriteSheet(index), (frame % 4) * SPRITE_W, SHEET_DIRS.indexOf(dir) * SPRITE_H, SPRITE_W, SPRITE_H, Math.round(x), Math.round(y), SPRITE_W, SPRITE_H);
}

// ------------------------------------------------------------ balões de status
export type Bubble = "alert" | "approval" | "mail" | "wait" | "work" | "done" | "queued";
export function drawBubble(ctx: Ctx, kind: Bubble, x: number, y: number, tick: number) {
  const bob = tick % 2; const bx = Math.round(x) + 3, by = Math.round(y) - 11 - bob;
  px(ctx, OUTLINE, bx - 1, by, 12, 10); px(ctx, OUTLINE, bx, by - 1, 10, 12); px(ctx, "#fafafa", bx, by, 10, 10); px(ctx, OUTLINE, bx + 3, by + 11, 3, 1); px(ctx, "#fafafa", bx + 4, by + 10, 1, 1);
  if (kind === "alert") { px(ctx, "#d63b3b", bx + 4, by + 1, 2, 5); px(ctx, "#d63b3b", bx + 4, by + 7, 2, 2); }
  if (kind === "approval") { px(ctx, "#c98a12", bx + 3, by + 1, 4, 1); px(ctx, "#c98a12", bx + 6, by + 2, 1, 2); px(ctx, "#c98a12", bx + 4, by + 4, 2, 2); px(ctx, "#c98a12", bx + 4, by + 7, 2, 2); }
  if (kind === "mail") { px(ctx, "#3a6ad6", bx + 1, by + 2, 8, 6); px(ctx, "#fafafa", bx + 2, by + 3, 6, 4); px(ctx, "#3a6ad6", bx + 2, by + 3, 1, 1); px(ctx, "#3a6ad6", bx + 3, by + 4, 1, 1); px(ctx, "#3a6ad6", bx + 4, by + 5, 2, 1); px(ctx, "#3a6ad6", bx + 6, by + 4, 1, 1); px(ctx, "#3a6ad6", bx + 7, by + 3, 1, 1); }
  if (kind === "wait" || kind === "queued") for (let i = 0; i < 3; i++) px(ctx, (tick + i) % 3 === 0 ? "#30303a" : "#a0a0aa", bx + 1 + i * 3, by + 4, 2, 2);
  if (kind === "work") { px(ctx, "#30303a", bx + 2, by + 2, 6, 1); px(ctx, "#30303a", bx + 2, by + 4, tick % 4 + 2, 1); px(ctx, "#2f9e6e", bx + 2, by + 6, (tick + 2) % 5 + 1, 1); }
  if (kind === "done") { px(ctx, "#2f9e6e", bx + 2, by + 5, 1, 1); px(ctx, "#2f9e6e", bx + 3, by + 6, 1, 1); px(ctx, "#2f9e6e", bx + 4, by + 7, 1, 1); px(ctx, "#2f9e6e", bx + 5, by + 6, 1, 1); px(ctx, "#2f9e6e", bx + 6, by + 5, 1, 1); px(ctx, "#2f9e6e", bx + 7, by + 4, 1, 1); px(ctx, "#2f9e6e", bx + 8, by + 3, 1, 1); }
}
export function drawEnvelope(ctx: Ctx, x: number, y: number) {
  const ex = Math.round(x), ey = Math.round(y);
  px(ctx, OUTLINE, ex - 1, ey - 1, 11, 8); px(ctx, "#fff7d6", ex, ey, 9, 6); px(ctx, "#c9a23a", ex, ey, 1, 1); px(ctx, "#c9a23a", ex + 1, ey + 1, 1, 1); px(ctx, "#c9a23a", ex + 2, ey + 2, 1, 1); px(ctx, "#c9a23a", ex + 3, ey + 3, 3, 1); px(ctx, "#c9a23a", ex + 6, ey + 2, 1, 1); px(ctx, "#c9a23a", ex + 7, ey + 1, 1, 1); px(ctx, "#c9a23a", ex + 8, ey, 1, 1);
}

// ------------------------------------------------------------------ cenário
const FLOOR: Record<string, [string, string]> = { work: ["#c9ced6", "#bcc2cc"], meeting: ["#5f6f9c", "#566592"], approval: ["#8d6f52", "#846749"], common: ["#c7a877", "#bd9e6d"], door: ["#a9adb5", "#9da1a9"] };

function drawFloor(ctx: Ctx, x: number, y: number) {
  const kind = floorAt(x, y); if (!kind) return;
  const [a, b] = FLOOR[kind]; const X = x * TILE, Y = y * TILE;
  if (kind === "work" || kind === "door") { // piso quadriculado
    px(ctx, (x + y) % 2 ? a : b, X, Y, TILE, TILE); px(ctx, "rgba(255,255,255,.14)", X, Y, TILE, 1); px(ctx, "rgba(0,0,0,.07)", X, Y + TILE - 1, TILE, 1);
  } else if (kind === "common") { // madeira
    px(ctx, y % 2 ? a : b, X, Y, TILE, TILE); px(ctx, "rgba(0,0,0,.12)", X, Y + TILE - 1, TILE, 1); px(ctx, "rgba(0,0,0,.1)", X + ((x * 7 + y * 5) % 12) + 2, Y, 1, TILE - 1);
  } else { // carpete
    px(ctx, a, X, Y, TILE, TILE); px(ctx, b, X + ((x + y) % 2 ? 2 : 9), Y + 3, 2, 1); px(ctx, b, X + ((x * 3 + y) % 9) + 3, Y + 10, 2, 1); px(ctx, b, X + 12, Y + ((x + y * 2) % 9) + 3, 1, 2);
  }
}
function drawWall(ctx: Ctx, x: number, y: number) {
  const X = x * TILE, Y = y * TILE; const below = y + 1 < ROWS && !isWall(x, y + 1);
  if (below) { // face frontal da parede
    px(ctx, "#e6e1d6", X, Y, TILE, TILE); px(ctx, "#d6d0c2", X, Y + 11, TILE, 3); px(ctx, "#8a8578", X, Y + 14, TILE, 2); px(ctx, "#f4f0e6", X, Y, TILE, 1);
  } else { px(ctx, "#3d4252", X, Y, TILE, TILE); px(ctx, "#4b5165", X, Y, TILE, 2); px(ctx, "#343846", X + TILE - 1, Y, 1, TILE); }
}

function drawProp(ctx: Ctx, p: Prop) {
  const X = p.x * TILE, Y = p.y * TILE, W = p.w * TILE, H = p.h * TILE;
  switch (p.kind) {
    case "desk": {
      px(ctx, "rgba(0,0,0,.18)", X + 1, Y + 14, W - 2, 3);
      px(ctx, OUTLINE, X, Y + 2, W, 13); px(ctx, "#d9b88a", X + 1, Y + 3, W - 2, 8); px(ctx, "#b8956a", X + 1, Y + 11, W - 2, 3); px(ctx, "#f0d5ab", X + 1, Y + 3, W - 2, 1);
      // monitor, teclado, caneca
      px(ctx, OUTLINE, X + 16, Y - 5, 16, 11); px(ctx, "#1c2230", X + 17, Y - 4, 14, 9); px(ctx, "#2b3a55", X + 18, Y - 3, 12, 7); px(ctx, OUTLINE, X + 22, Y + 6, 4, 2); px(ctx, "#5a6072", X + 20, Y + 8, 8, 1);
      px(ctx, "#3a3f4d", X + 18, Y + 9, 12, 1); px(ctx, "#f4f4f4", X + 36, Y + 5, 3, 3); px(ctx, "#c94f5f", X + 36, Y + 5, 3, 1); px(ctx, "#f4f4f4", X + 5, Y + 5, 6, 4); px(ctx, "#c8c8c8", X + 6, Y + 6, 4, 1);
      // cadeira
      px(ctx, OUTLINE, X + 19, Y + 17, 10, 11); px(ctx, "#4a5068", X + 20, Y + 18, 8, 6); px(ctx, "#5c6380", X + 20, Y + 18, 8, 2); px(ctx, "#2c3040", X + 21, Y + 25, 6, 2);
      break;
    }
    case "plant": px(ctx, "rgba(0,0,0,.2)", X + 3, Y + 13, 10, 3); px(ctx, OUTLINE, X + 4, Y + 8, 8, 7); px(ctx, "#b5673f", X + 5, Y + 9, 6, 5); px(ctx, "#d18358", X + 5, Y + 9, 6, 1); px(ctx, OUTLINE, X + 2, Y - 3, 12, 12); px(ctx, "#3f9b57", X + 3, Y - 2, 10, 10); px(ctx, "#5cc277", X + 4, Y - 1, 4, 3); px(ctx, "#2f7a43", X + 8, Y + 4, 4, 3); px(ctx, "#5cc277", X + 9, Y, 2, 2); break;
    case "server": px(ctx, OUTLINE, X + 2, Y - 6, W - 4, H + 4); px(ctx, "#2a2f3d", X + 3, Y - 5, W - 6, H + 2); for (let i = 0; i < 5; i++) { px(ctx, "#3a4154", X + 5, Y - 3 + i * 6, W - 10, 4); px(ctx, i % 2 ? "#5cf08a" : "#f0c85c", X + 7, Y - 2 + i * 6, 2, 2); px(ctx, "#6aa8ff", X + 11, Y - 2 + i * 6, 2, 2); } break;
    case "shelf": px(ctx, OUTLINE, X, Y - 6, W, 20); px(ctx, "#7a5a3c", X + 1, Y - 5, W - 2, 18); for (let r = 0; r < 2; r++) { px(ctx, "#4d3824", X + 2, Y - 3 + r * 9, W - 4, 7); ["#c94f5f", "#4d8fd6", "#e0a04e", "#8fbf5a", "#8f7be0", "#e6e6e6", "#3fae9a"].forEach((c, i) => px(ctx, c, X + 3 + i * 4, Y - 2 + r * 9 + (i % 2), 3, 6 - (i % 2))); } break;
    case "printer": px(ctx, OUTLINE, X + 3, Y + 1, W - 6, 13); px(ctx, "#dcdfe6", X + 4, Y + 2, W - 8, 11); px(ctx, "#f8f8f8", X + 8, Y, W - 16, 4); px(ctx, "#2a2f3d", X + 6, Y + 8, W - 12, 2); px(ctx, "#5cf08a", X + W - 8, Y + 4, 2, 2); break;
    case "window": px(ctx, OUTLINE, X + 2, Y + 4, W - 4, 20 > H ? H - 4 : 20); px(ctx, "#8fd0f0", X + 3, Y + 5, W - 6, (20 > H ? H - 4 : 20) - 2); px(ctx, "#c8ecff", X + 5, Y + 6, 6, 3); px(ctx, "#eef3f8", X + W / 2 - 1, Y + 5, 2, (20 > H ? H - 4 : 20) - 2); break;
    case "whiteboard": px(ctx, OUTLINE, X + 2, Y + 5, W - 4, 22); px(ctx, "#fbfbf7", X + 3, Y + 6, W - 6, 20); px(ctx, "#3a6ad6", X + 7, Y + 10, 20, 1); px(ctx, "#d63b3b", X + 7, Y + 14, 30, 1); px(ctx, "#2f9e6e", X + 7, Y + 18, 14, 1); px(ctx, "#30303a", X + 42, Y + 9, 12, 9); px(ctx, "#fbfbf7", X + 43, Y + 10, 10, 7); px(ctx, "#8a8578", X + 2, Y + 27, W - 4, 2); break;
    case "table": px(ctx, "rgba(0,0,0,.2)", X + 3, Y + H - 3, W - 6, 5); px(ctx, OUTLINE, X + 2, Y + 3, W - 4, H - 6); px(ctx, "#6b4a33", X + 3, Y + 4, W - 6, H - 12); px(ctx, "#8a6344", X + 3, Y + 4, W - 6, 2); px(ctx, "#4d3524", X + 3, Y + H - 8, W - 6, 4); px(ctx, "#f4f4f4", X + 20, Y + 14, 8, 6); px(ctx, "#2b3a55", X + 50, Y + 12, 14, 9); px(ctx, "#6aa8ff", X + 52, Y + 14, 10, 5); break;
    case "screen": px(ctx, OUTLINE, X + 9, Y + 2, 6, H - 4); px(ctx, "#1c2230", X + 10, Y + 3, 4, H - 6); px(ctx, "#6aa8ff", X + 11, Y + 6, 2, H - 14); break;
    case "approval-desk": px(ctx, "rgba(0,0,0,.2)", X + 2, Y + H - 2, W - 4, 4); px(ctx, OUTLINE, X, Y + 2, W, H - 4); px(ctx, "#5a3d2b", X + 1, Y + 3, W - 2, H - 12); px(ctx, "#7a553c", X + 1, Y + 3, W - 2, 2); px(ctx, "#3f2a1d", X + 1, Y + H - 9, W - 2, 6); px(ctx, "#f4f4f4", X + 8, Y + 7, 12, 9); px(ctx, "#c8c8c8", X + 10, Y + 9, 8, 1); px(ctx, "#c8c8c8", X + 10, Y + 12, 6, 1); px(ctx, OUTLINE, X + 38, Y + 5, 10, 11); px(ctx, "#c94f5f", X + 39, Y + 6, 8, 4); px(ctx, "#7a553c", X + 41, Y + 10, 4, 5); px(ctx, "#f2d16b", X + 26, Y + 8, 6, 6); break;
    case "cabinet": px(ctx, OUTLINE, X, Y - 4, W, 18); px(ctx, "#8d93a3", X + 1, Y - 3, W - 2, 16); px(ctx, "#6f7586", X + 1, Y + 4, W - 2, 1); px(ctx, "#30303a", X + 7, Y, 4, 1); px(ctx, "#30303a", X + 22, Y, 4, 1); px(ctx, "#30303a", X + 7, Y + 8, 4, 1); px(ctx, "#30303a", X + 22, Y + 8, 4, 1); break;
    case "sign": px(ctx, OUTLINE, X + 2, Y + 1, W - 4, 11); px(ctx, "#f2d16b", X + 3, Y + 2, W - 6, 9); px(ctx, "#30303a", X + 6, Y + 4, W - 12, 1); px(ctx, "#30303a", X + 6, Y + 7, W - 16, 1); break;
    case "rug": px(ctx, "rgba(20,20,40,.22)", X + 2, Y + 2, W - 4, H - 4); px(ctx, "rgba(255,255,255,.2)", X + 4, Y + 4, W - 8, 1); px(ctx, "rgba(255,255,255,.2)", X + 4, Y + H - 5, W - 8, 1); px(ctx, "rgba(255,255,255,.2)", X + 4, Y + 4, 1, H - 8); px(ctx, "rgba(255,255,255,.2)", X + W - 5, Y + 4, 1, H - 8); break;
    case "sofa": px(ctx, "rgba(0,0,0,.2)", X + 2, Y + H - 2, W - 4, 4); px(ctx, OUTLINE, X, Y, W, H - 2); px(ctx, "#3f6fb0", X + 1, Y + 1, W - 2, 10); px(ctx, "#5687c9", X + 1, Y + 1, W - 2, 2); px(ctx, "#335a91", X + 5, Y + 11, W - 10, H - 16); px(ctx, "#3f6fb0", X + 1, Y + 9, 5, H - 13); px(ctx, "#3f6fb0", X + W - 6, Y + 9, 5, H - 13); px(ctx, "#2b4c7a", X + W / 2, Y + 12, 1, H - 18); px(ctx, "#f2d16b", X + 8, Y + 12, 7, 6); break;
    case "coffee": px(ctx, OUTLINE, X, Y - 2, W, 16); px(ctx, "#ece7dc", X + 1, Y - 1, W - 2, 6); px(ctx, "#a69d8b", X + 1, Y + 5, W - 2, 8); px(ctx, OUTLINE, X + 5, Y - 9, 12, 11); px(ctx, "#2a2f3d", X + 6, Y - 8, 10, 9); px(ctx, "#d63b3b", X + 8, Y - 6, 2, 2); px(ctx, "#f4f4f4", X + 10, Y - 2, 3, 3); px(ctx, "#f4f4f4", X + 26, Y, 3, 3); px(ctx, "#f4f4f4", X + 31, Y, 3, 3); px(ctx, "#7a553c", X + 36, Y - 3, 6, 6); break;
    case "cooler": px(ctx, OUTLINE, X + 3, Y - 8, 10, 23); px(ctx, "#8fd0f0", X + 4, Y - 7, 8, 8); px(ctx, "#c8ecff", X + 5, Y - 6, 2, 4); px(ctx, "#e6e9ef", X + 4, Y + 1, 8, 13); px(ctx, "#3a6ad6", X + 6, Y + 4, 2, 2); px(ctx, "#d63b3b", X + 9, Y + 4, 2, 2); break;
    case "vending": px(ctx, OUTLINE, X + 2, Y - 10, W - 4, 25); px(ctx, "#c94f5f", X + 3, Y - 9, W - 6, 23); px(ctx, "#1c2230", X + 5, Y - 7, 14, 14); ["#f2d16b", "#8fbf5a", "#6fc3e0"].forEach((c, i) => { px(ctx, c, X + 6 + i * 4, Y - 6, 3, 4); px(ctx, c, X + 6 + i * 4, Y, 3, 4); }); px(ctx, "#2a2f3d", X + 21, Y - 6, 5, 8); px(ctx, "#1c2230", X + 6, Y + 9, 14, 3); break;
    case "round-table": px(ctx, "rgba(0,0,0,.2)", X + 5, Y + H - 6, W - 10, 5); px(ctx, OUTLINE, X + 6, Y + 3, W - 12, H - 10); px(ctx, OUTLINE, X + 3, Y + 6, W - 6, H - 16); px(ctx, "#ece7dc", X + 7, Y + 4, W - 14, H - 12); px(ctx, "#ece7dc", X + 4, Y + 7, W - 8, H - 18); px(ctx, "#f4f4f4", X + 12, Y + 9, 4, 4); px(ctx, "#7a553c", X + 13, Y + 10, 2, 2); px(ctx, "#8fbf5a", X + 18, Y + 12, 4, 3); break;
  }
}

// Camada estática (piso, paredes, móveis, rótulos): desenhada uma única vez.
export function renderStatic(): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = COLS * TILE; canvas.height = ROWS * TILE;
  const ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
  px(ctx, "#1b1d26", 0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { if (isWall(x, y)) drawWall(ctx, x, y); else drawFloor(ctx, x, y); }
  // sombra projetada pelas paredes sobre o piso
  for (let y = 1; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!isWall(x, y) && isWall(x, y - 1) && floorAt(x, y)) px(ctx, "rgba(0,0,0,.16)", x * TILE, y * TILE, TILE, 3);
  for (const p of PROPS.filter(p => p.kind === "rug")) drawProp(ctx, p);
  for (const p of [...PROPS].filter(p => p.kind !== "rug").sort((a, b) => a.y + a.h - (b.y + b.h))) drawProp(ctx, p);
  ctx.font = "bold 7px ui-monospace, Menlo, Consolas, monospace"; ctx.textBaseline = "top";
  for (const label of ROOM_LABELS) {
    const w = Math.ceil(ctx.measureText(label.text).width) + 6;
    px(ctx, "rgba(21,21,28,.72)", label.x * TILE, label.y * TILE + 2, w, 10); ctx.fillStyle = "#f4f0e6"; ctx.fillText(label.text, label.x * TILE + 3, label.y * TILE + 4);
  }
  return canvas;
}
// Brilho do monitor de uma estação em uso (único elemento animado do cenário).
export function drawMonitorGlow(ctx: Ctx, deskX: number, deskY: number, tick: number) {
  const X = deskX * TILE, Y = deskY * TILE;
  px(ctx, "#9fd4ff", X + 18, Y - 3, 12, 7);
  for (let i = 0; i < 3; i++) px(ctx, "#2b3a55", X + 19, Y - 2 + i * 2, 3 + ((tick + i * 3) % 7), 1);
}
