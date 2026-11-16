"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, DESKS, LOUNGE_SPOTS, ROWS, TILE, createWalker, destination, placeFor, setTarget, step, type Walker } from "@/lib/pixel/map";
import { SPRITE_H, drawBubble, drawEnvelope, drawMonitorGlow, drawSprite, renderStatic, type Bubble } from "@/lib/pixel/sprites";
import { latestTask, STATUS_LABEL, type Agent, type Communication, type Status, type Task } from "@/lib/types";
import { uniqueCommunications } from "@/lib/communications";

// ---------------------------------------------------------------------------
// Escritório RPG em Canvas 2D.
//
// Por que Canvas 2D e não Phaser/PixiJS: são no máximo 8 personagens em um mapa
// de 46×26 tiles. Canvas puro resolve com zero dependências (Phaser pesa ~1 MB),
// não exige WebGL e roda bem em computadores modestos.
//
// Regra de ouro: posição e animação derivam do STATUS REAL da tarefa de cada
// agente (vindo do backend). O único movimento decorativo é o passeio de agentes
// ociosos pela área comum — e ele nunca é mostrado como trabalho.
// ---------------------------------------------------------------------------

const W = COLS * TILE, H = ROWS * TILE;
interface Actor { walker: Walker; status: Status; index: number; sprite: number; wanderAt: number; arrivedAt: number; mailUntil: number }
interface Flight { from: string; to: string; start: number }
const FRAME_MS = 50; // 20 quadros/s enquanto há movimento

export function Office({ agents, tasks, selected, onSelect, communications = [], speed = 4, dwell = 4 }: {
  agents: Agent[]; tasks: Task[]; selected: string; onSelect: (id: string) => void; communications?: Communication[]; speed?: number; dwell?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const actors = useRef(new Map<string, Actor>());
  const flights = useRef<Flight[]>([]);
  const knownDeliveries = useRef<Set<string> | undefined>(undefined);
  const live = useRef({ agents, tasks, selected, speed, dwell });
  const [label, setLabel] = useState<{ id: string; x: number; y: number } | undefined>();
  const [hover, setHover] = useState("");
  useEffect(() => { live.current = { agents, tasks, selected, speed, dwell }; });

  // Entregas reais entre agentes: cada nova mensagem "entregue" vira um envelope
  // voando do remetente ao destinatário. As já existentes ao abrir a tela não animam.
  useEffect(() => {
    const delivered = uniqueCommunications(communications).filter(c => c.state === "delivered");
    const known = knownDeliveries.current;
    if (known) for (const message of delivered) if (!known.has(message.id) && message.from !== message.to) {
      flights.current.push({ from: message.from, to: message.to, start: performance.now() });
      const sender = actors.current.get(message.from); if (sender) sender.mailUntil = performance.now() + 1800;
    }
    knownDeliveries.current = new Set(delivered.map(c => c.id));
  }, [communications]);

  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const ctx = element.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    const background = renderStatic();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, lastDraw = 0, stopped = false, lastLabel = "";

    function sync(now: number) {
      const { agents, tasks } = live.current;
      const roster = agents.slice(0, 8);
      for (const id of actors.current.keys()) if (!roster.some(agent => agent.id === id)) actors.current.delete(id);
      roster.forEach((agent, index) => {
        const status = (latestTask(tasks, agent.id)?.status ?? "idle") as Status;
        let actor = actors.current.get(agent.id);
        if (!actor) {
          // Primeira aparição: já no lugar correspondente ao estado atual, sem "teletransporte" visível depois.
          actor = { walker: createWalker(destination(index, status)), status, index, sprite: agent.sprite ?? index, wanderAt: now + 1500 + index * 700, arrivedAt: 0, mailUntil: 0 };
          if (placeFor(status) === "desk") actor.walker.dir = "up";
          actors.current.set(agent.id, actor); return;
        }
        actor.sprite = agent.sprite ?? index;
        if (actor.status === status && actor.index === index) return;
        actor.status = status; actor.index = index;
        const target = destination(index, status);
        if (reduced.matches) { actor.walker = createWalker(target); actor.arrivedAt = now; }
        else setTarget(actor.walker, target);
        actor.wanderAt = now + live.current.dwell * 1000;
      });
    }

    function tick(now: number) {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      if (document.hidden) { last = now; return; }
      const elapsed = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
      sync(now);
      let moving = flights.current.length > 0;
      for (const actor of actors.current.values()) {
        const place = placeFor(actor.status);
        // Passeio decorativo, apenas para quem está ocioso na área comum.
        if (!reduced.matches && place === "lounge" && !actor.walker.path.length && now >= actor.wanderAt) {
          setTarget(actor.walker, LOUNGE_SPOTS[Math.floor(Math.random() * LOUNGE_SPOTS.length)]);
          actor.wanderAt = now + (live.current.dwell + Math.random() * live.current.dwell) * 1000 + 2500;
        }
        const was = actor.walker.path.length > 0;
        step(actor.walker, elapsed * live.current.speed);
        if (was && !actor.walker.path.length) { actor.arrivedAt = now; actor.walker.dir = place === "desk" || place === "approval" ? "up" : "down"; }
        if (actor.walker.path.length) moving = true;
      }
      // Sem movimento, 4 quadros/s bastam para os balões e o brilho dos monitores.
      if (now - lastDraw < (moving ? FRAME_MS : 250)) return;
      lastDraw = now;
      const beat = Math.floor(now / 250);
      ctx.drawImage(background, 0, 0);
      const list = [...actors.current.entries()].sort((a, b) => a[1].walker.y - b[1].walker.y);
      for (const [, actor] of list) if (actor.status === "running" && !actor.walker.path.length) { const desk = DESKS[actor.index % 8].desk; drawMonitorGlow(ctx, desk.x, desk.y, beat); }
      for (const [id, actor] of list) {
        const { walker } = actor; const walking = walker.path.length > 0;
        const x = walker.x * TILE, y = walker.y * TILE - (SPRITE_H - TILE) - 2;
        const working = actor.status === "running" && !walking;
        if (id === live.current.selected || id === hoverRef.current) { ctx.fillStyle = id === live.current.selected ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.5)"; ctx.fillRect(Math.round(x) + 1, Math.round(walker.y * TILE) + 13, 14, 2); ctx.fillRect(Math.round(x) + 3, Math.round(walker.y * TILE) + 15, 10, 1); }
        // Caminhada: 4 quadros. Trabalho: balanço discreto. Ocioso: respiração lenta.
        const frameIndex = walking ? Math.floor(now / 130) % 4 : 0;
        const bob = walking ? 0 : working ? beat % 2 : Math.floor(now / 900 + actor.index) % 2 === 0 ? 0 : -1;
        drawSprite(ctx, actor.sprite, walker.dir, frameIndex, x, y + bob);
        let bubble: Bubble | undefined;
        if (now < actor.mailUntil) bubble = "mail";
        else if (actor.status === "failed") bubble = "alert";
        else if (actor.status === "approval") bubble = "approval";
        else if (actor.status === "running" && !walking) bubble = "work";
        else if (actor.status === "waiting" && !walking) bubble = "wait";
        else if (actor.status === "queued" && !walking) bubble = "queued";
        else if (actor.status === "completed" && now - actor.arrivedAt < 4000 && !walking) bubble = "done";
        if (bubble) drawBubble(ctx, bubble, x, y, beat);
      }
      flights.current = flights.current.filter(flight => {
        const from = actors.current.get(flight.from), to = actors.current.get(flight.to); const t = (now - flight.start) / 1400;
        if (!from || !to || t >= 1) return false;
        const ease = t * t * (3 - 2 * t);
        drawEnvelope(ctx, (from.walker.x + (to.walker.x - from.walker.x) * ease) * TILE + 3, (from.walker.y + (to.walker.y - from.walker.y) * ease) * TILE - 10 - Math.sin(t * Math.PI) * 18);
        return true;
      });
      // Etiqueta com o nome (HTML sobreposto, para ficar nítida em qualquer escala).
      const focus = hoverRef.current || live.current.selected; const actor = actors.current.get(focus);
      const next = actor ? `${focus}:${Math.round(actor.walker.x * 8)}:${Math.round(actor.walker.y * 8)}` : "";
      if (next !== lastLabel) { lastLabel = next; setLabel(actor ? { id: focus, x: (actor.walker.x + 0.5) / COLS * 100, y: (actor.walker.y * TILE - 22) / H * 100 } : undefined); }
    }
    frame = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, []);

  const hoverRef = useRef(""); useEffect(() => { hoverRef.current = hover; }, [hover]);
  function pick(event: React.MouseEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    // object-fit: contain — converte o clique para coordenadas do mapa.
    const scale = Math.min(box.width / W, box.height / H);
    const px = (event.clientX - box.left - (box.width - W * scale) / 2) / scale / TILE, py = (event.clientY - box.top - (box.height - H * scale) / 2) / scale / TILE;
    let best = "", distance = 1.4;
    for (const [id, actor] of actors.current) { const d = Math.hypot(actor.walker.x + 0.5 - px, actor.walker.y - 0.1 - py); if (d < distance) { distance = d; best = id; } }
    return best;
  }
  const named = label && agents.find(agent => agent.id === label.id);
  const namedStatus = named ? (latestTask(tasks, named.id)?.status ?? "idle") as Status : "idle";
  return <div className="office-canvas-wrap">
    <canvas ref={canvas} width={W} height={H} className="office-canvas" role="img"
      aria-label={`Escritório em pixel art com ${agents.length} agentes. ${agents.slice(0, 8).map(agent => `${agent.name}: ${STATUS_LABEL[(latestTask(tasks, agent.id)?.status ?? "idle") as Status]}`).join("; ")}.`}
      style={{ cursor: hover ? "pointer" : "default" }}
      onMouseMove={event => { const id = pick(event); if (id !== hover) setHover(id); }} onMouseLeave={() => setHover("")}
      onClick={event => { const id = pick(event); if (id) onSelect(id); }} />
    {named && label && <span className="office-nametag" style={{ left: `${label.x}%`, top: `${label.y}%` }}>{named.name}<small>{STATUS_LABEL[namedStatus]}</small></span>}
  </div>;
}
