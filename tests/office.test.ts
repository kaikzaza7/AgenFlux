import test from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_SPOTS, COLS, DESKS, LOUNGE_SPOTS, MEETING_SPOTS, ROWS, createWalker, destination, findPath, isWall, placeFor, setTarget, step, walkable } from "../src/lib/pixel/map.ts";

test("mapa: todos os destinos são acessíveis e não ficam sobre paredes ou móveis", () => {
  const spots = [...DESKS.map(d => d.seat), ...MEETING_SPOTS, ...APPROVAL_SPOTS, ...LOUNGE_SPOTS];
  assert.equal(DESKS.length, 8, "oito estações de trabalho");
  for (const spot of spots) assert.ok(walkable(spot.x, spot.y), `destino bloqueado: ${spot.x},${spot.y}`);
  for (const spot of spots) assert.ok(spot === LOUNGE_SPOTS[0] || findPath(LOUNGE_SPOTS[0], spot).length > 0, `sem rota até ${spot.x},${spot.y}`);
  for (const desk of DESKS) assert.equal(walkable(desk.desk.x, desk.desk.y), false, "mesa é obstáculo");
});

test("A*: caminhos válidos, contínuos, sem atravessar paredes, passando pelas portas", () => {
  for (const [from, to] of [[DESKS[0].seat, APPROVAL_SPOTS[7]], [LOUNGE_SPOTS[3], MEETING_SPOTS[0]], [DESKS[7].seat, LOUNGE_SPOTS[0]], [MEETING_SPOTS[5], APPROVAL_SPOTS[0]]]) {
    const path = findPath(from, to);
    assert.ok(path.length > 0); assert.deepEqual(path.at(-1), to);
    let previous = from;
    for (const cell of path) {
      assert.equal(Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y), 1, "passos de um tile, sem diagonais");
      assert.ok(walkable(cell.x, cell.y) && !isWall(cell.x, cell.y), "nunca pisa em parede ou móvel");
      previous = cell;
    }
  }
  // Estações → reuniões só é possível atravessando a porta da divisória (coluna 30).
  const crossing = findPath(DESKS[3].seat, MEETING_SPOTS[3]).filter(c => c.x === 30);
  assert.ok(crossing.length === 1 && [5, 6].includes(crossing[0].y), "atravessa pela porta");
  assert.deepEqual(findPath({ x: 0, y: 0 }, DESKS[0].seat), [], "origem em parede não gera rota");
  const started = performance.now(); for (let i = 0; i < 200; i++) findPath(LOUNGE_SPOTS[i % 16], APPROVAL_SPOTS[i % 8]);
  assert.ok(performance.now() - started < 1500, "200 rotas em menos de 1,5 s (leve para computadores modestos)");
  assert.ok(COLS * ROWS < 2000);
});

test("estados reais definem o destino do personagem", () => {
  assert.equal(placeFor("running"), "desk"); assert.equal(placeFor("queued"), "desk"); assert.equal(placeFor("failed"), "desk");
  assert.equal(placeFor("approval"), "approval"); assert.equal(placeFor("waiting"), "meeting");
  for (const status of ["idle", "completed", "cancelled", "interrupted"]) assert.equal(placeFor(status), "lounge");
  assert.deepEqual(destination(2, "running"), DESKS[2].seat); assert.deepEqual(destination(2, "approval"), APPROVAL_SPOTS[2]);
  assert.equal(new Set(Array.from({ length: 8 }, (_, i) => JSON.stringify(destination(i, "idle")))).size, 8, "cada agente tem o seu lugar na área comum");
});

test("movimento fluido com direção correta; mudança de destino no meio do passo não corta caminho", () => {
  const walker = createWalker(LOUNGE_SPOTS[0]);
  setTarget(walker, DESKS[0].seat);
  const directions = new Set<string>(); let steps = 0;
  while (walker.path.length && steps++ < 2000) {
    const before = { x: walker.x, y: walker.y };
    step(walker, 0.3); directions.add(walker.dir);
    assert.ok(Math.abs(walker.x - before.x) + Math.abs(walker.y - before.y) <= 0.3001, "sem saltos");
    assert.ok(walkable(Math.round(walker.x), Math.round(walker.y)));
    if (steps === 7) { setTarget(walker, APPROVAL_SPOTS[0]); assert.ok(walker.path.length > 0); }
  }
  assert.deepEqual(walker.cell, APPROVAL_SPOTS[0]);
  assert.ok(directions.size >= 2, "usa mais de uma direção de animação");
  assert.equal(walker.moving, true); step(walker, 0.3); assert.equal(walker.moving, false, "para ao chegar");
});
