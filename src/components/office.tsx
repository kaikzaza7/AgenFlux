"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APPROVAL_TABLE, BENCH, CAFE, DESKS, PLANTS, WALLS, canPatrol, destination, patrolTarget, setWalkingTarget, walkStep, type Point, type Walker } from "@/lib/office";
import { latestTask, STATUS_LABEL, type Agent, type Task, type Communication, type Status } from "@/lib/types";
import { agentInitials } from "@/lib/team";
import { uniqueCommunications } from "@/lib/communications";

type OfficeWalker = Walker & { status: Status; atStation: boolean; resumeAt: number };
type Position = Point & { walking: boolean };

export function Office({ agents, tasks, selected, onSelect, communications = [] }: {
  agents: Agent[]; tasks: Task[]; selected: string; onSelect: (id: string) => void; communications?: Communication[];
}) {
  const occupants = agents.slice(0, DESKS.length);
  const rosterKey = JSON.stringify(occupants.map(agent => [agent.id, latestTask(tasks, agent.id)?.status ?? "idle"]));
  const roster = useMemo(() => JSON.parse(rosterKey) as [string, Status][], [rosterKey]);
  const walkers = useRef(new Map<string, OfficeWalker>());
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  const knownDeliveries = useRef(new Set<string>());
  const initializedDeliveries = useRef(false);
  const [transfers, setTransfers] = useState<Communication[]>([]);
  const deliveredKey = JSON.stringify(uniqueCommunications(communications).filter(c => c.state === "delivered").map(c => c.id));
  const delivered = useMemo(() => JSON.parse(deliveredKey) as string[], [deliveredKey]);
  const communicationsRef = useRef(communications);
  useEffect(() => { communicationsRef.current = communications; }, [communications]);
  useEffect(() => {
    const fresh = delivered.filter(id => !knownDeliveries.current.has(id));
    knownDeliveries.current = new Set(delivered);
    const show = initializedDeliveries.current && !reduced && fresh.length;
    initializedDeliveries.current = true;
    if (!show) { setTransfers([]); return; }
    setTransfers(uniqueCommunications(communicationsRef.current).filter(c => fresh.includes(c.id)));
    const timer = setTimeout(() => setTransfers([]), 2200);
    return () => clearTimeout(timer);
  }, [delivered, reduced]);

  useEffect(() => {
    const active = new Set(roster.map(([id]) => id));
    const count = roster.length;
    for (const id of walkers.current.keys()) if (!active.has(id)) walkers.current.delete(id);
    roster.forEach(([id, status], index) => {
      const walker = walkers.current.get(id);
      if (walker?.status === status && !reduced) return;
      const start = walker?.point ?? destination(index, "idle");
      const next: OfficeWalker = walker ?? { point: start, anchor: start, path: [], status, atStation: false, resumeAt: 0 };
      next.status = status;
      next.atStation = false;
      next.resumeAt = performance.now() + 900 + index * 520;
      if (reduced) {
        next.point = next.anchor = destination(index, status);
        next.path = [];
      } else if (status === "running" || status === "approval" || canPatrol(status)) {
        setWalkingTarget(next, destination(index, status), DESKS.length);
      } else {
        next.path = [];
      }
      walkers.current.set(id, next);
    });
    function publish() {
      setPositions(Object.fromEntries(Array.from(walkers.current, ([id, walker]) => [
        id, { ...walker.point, walking: walker.path.length > 0 },
      ])));
    }
    publish();
    if (reduced || !count) return;
    let last = 0;
    let frame = 0;
    function tick(now: number) {
      const elapsed = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      let changed = false;
      roster.forEach(([id], index) => {
        const walker = walkers.current.get(id)!;
        if (!walker.path.length && canPatrol(walker.status) && now >= walker.resumeAt) {
          setWalkingTarget(walker, patrolTarget(index, walker.atStation), DESKS.length);
          walker.atStation = !walker.atStation;
          walker.resumeAt = now + 1200 + (index % 3) * 350;
        }
        if (!walker.path.length) return;
        walkStep(walker, elapsed * 108);
        changed = true;
        if (!walker.path.length) walker.resumeAt = now + 1150 + (index % 3) * 420;
      });
      if (changed) publish();
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [roster, reduced]);

  return <svg viewBox="0 0 860 443" className="office-svg" role="group" aria-label="Planta do escritório. Selecione um agente para acompanhar sua atividade.">
    <defs>
    <pattern id="floor-tiles" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="#8b8b8b" strokeOpacity=".1"/></pattern>
    <pattern id="floor-boards" width="80" height="22" patternUnits="userSpaceOnUse"><path d="M0 0H80M0 11H80M16 0V11m39 0v11" fill="none" stroke="#aeaeae" strokeOpacity=".13"/></pattern>
    <linearGradient id="desk-finish" x2="0" y2="1"><stop stopColor="#363636"/><stop offset="1" stopColor="#272727"/></linearGradient>
    <g id="plant"><circle r="15" fill="#191919" stroke="#5d5d5d"/><g fill="#818181"><ellipse ry="9" rx="3" transform="rotate(35)"/><ellipse ry="9" rx="3" transform="rotate(95)"/><ellipse ry="9" rx="3" transform="rotate(155)"/></g><circle r="2.5" fill="#b8b8b8"/></g>
    </defs>
    <rect x="9" y="9" width="842" height="425" rx="12" fill="#0f0f0f" stroke="#3b3b3b" strokeOpacity=".55" strokeWidth="2"/>
    <rect x="17" y="17" width="826" height="409" rx="8" fill="#181818" fillOpacity=".82"/>
    <path d="M19 19H568V424H19Z" fill="#222222" fillOpacity=".72"/>
    <path d="M19 19H568V424H19Z" fill="url(#floor-boards)"/>
    <path d="M573 19H841V424H573Z" fill="url(#floor-tiles)"/>
    <rect x="17" y="17" width="826" height="409" rx="8" fill="none" stroke="#6f6f6f" strokeOpacity=".65" strokeWidth="5"/>
    {WALLS.map(wall => <rect key={`${wall.x}:${wall.y}`} x={wall.x} y={wall.y} width={wall.w} height={wall.h} fill="#aaa" opacity=".65" />)}
    <path d="M570 145h-51a51 51 0 0 0 51 51M570 416h-51a51 51 0 0 1 51-51M625 145h51a51 51 0 0 1-51 51" stroke="#888888" strokeOpacity=".75" fill="none"/>
    <path d="M53 17H163m36 0h110m36 0h110m-402 409H163m36 0h110m36 0h110m388-366v92m0 106v90" stroke="#a0a0a0" strokeWidth="3" strokeLinecap="round"/>
    <text className="area" x="36" y="46">Estações de trabalho A</text><text className="area" x="36" y="250">Estações de trabalho B</text><text className="area" x="648" y="46">Sala de aprovações</text><text className="area" x="596" y="251">Café e área comum</text>
    <rect x="658" y="77" width="120" height="96" rx="23" fill="#1d1d1d" stroke="#434343" strokeDasharray="4 4"/>
    <rect x={APPROVAL_TABLE.x} y={APPROVAL_TABLE.y} width={APPROVAL_TABLE.w} height={APPROVAL_TABLE.h} rx="26" fill="url(#desk-finish)" stroke="#797979"/>
    <rect x="688" y="110" width="32" height="29" rx="4" fill="#191919" stroke="#9e9e9e"/><path d="M696 119h15m-15 6h11m-11 6h13" stroke="#cbcbcb" strokeLinecap="round"/>
    <rect x={CAFE.x} y={CAFE.y} width={CAFE.w} height={CAFE.h} rx="6" fill="url(#desk-finish)" stroke="#5f5f5f"/>
    <rect x="657" y="287" width="22" height="24" rx="4" fill="#1a1a1a" stroke="#848484"/><circle cx="668" cy="300" r="4" fill="#aaaaaa"/>
    <path d="M745 288h32v22h-32z" fill="#212121" stroke="#848484"/><path d="M753 296h16" stroke="#b7b7b7"/>
    <rect x={BENCH.x} y={BENCH.y} width={BENCH.w} height={BENCH.h} rx="14" fill="#2f2f2f" stroke="#797979"/><path d="M671 374h69" stroke="#989898" strokeOpacity=".5"/>
    {PLANTS.map(plant => <use key={plant.x} href="#plant" x={plant.x} y={plant.y} />)}
    {DESKS.map(({ x, y }, index) => {
      return <g key={index} transform={`translate(${x} ${y})`} data-station={index + 1} aria-hidden="true">
        <text className="desk-number" x="-51" y="-8">Estação {String(index + 1).padStart(2, "0")}</text>
        <rect x="-54" width="108" height="55" rx="8" fill="url(#desk-finish)" stroke="#7d7d7d"/>
        <rect x="-26" y="8" width="52" height="20" rx="4" fill="#131313" stroke="#969696"/>
        <path d="M-19 15H8m-27 6H0m-5 12H5m-5-5v5" stroke="#aeaeae" strokeLinecap="round"/>
        <rect x="-19" y="39" width="38" height="7" rx="2" fill="#777"/>
        <rect x="27" y="38" width="7" height="10" rx="3.5" fill="#aaa"/>
        <g className="office-chair" transform="translate(0 77)">
          <rect x="-23" y="-13" width="46" height="28" rx="8" fill="#191919" stroke="#666"/>
          <rect x="-17" y="-17" width="34" height="33" rx="9" fill="#323232" stroke="#919191"/>
          <path d="M-17 11q0 9 8 9H9q8 0 8-9" fill="#262626" stroke="#919191"/>
        </g>
      </g>;
    })}
    {transfers.map(message => {
      const from = positions[message.from], to = positions[message.to];
      return from && to ? <line key={message.id} className="real-transfer" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#fff" strokeOpacity=".65" strokeWidth="2" strokeDasharray="4 8">
        <title>{message.from} → {message.to}; evento {message.sourceEventId}</title>
      </line> : null;
    })}
    {occupants.map((agent, index) => {
      const task = latestTask(tasks, agent.id);
      const status = task?.status ?? "idle";
      const point = positions[agent.id] ?? { ...destination(index, "idle"), walking: false };
      return <g key={agent.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
        data-agent={agent.id} data-status={status} data-walking={point.walking} aria-pressed={selected === agent.id}
        aria-label={`${agent.name}: ${STATUS_LABEL[status]}`} className="office-agent"
        onClick={() => onSelect(agent.id)} onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(agent.id); }
        }}>
        <title>{agent.name} · {STATUS_LABEL[status]} · {task?.title ?? "Sem tarefa"}</title>
        <circle className="agent-ring" r="17" fill="none" stroke="#fff" strokeWidth="1.5"/>
        <g className="agent-steps" aria-hidden="true"><ellipse cx="-4" cy="12" rx="3" ry="4" fill="#bdbdbd"/><ellipse cx="4" cy="12" rx="3" ry="4" fill="#bdbdbd"/></g>
        <g className="agent-body">
          <circle r="12" fill={status === "running" || status === "approval" ? "#eee" : "#555"} stroke="#171717" strokeWidth="1.5"/>
          <text textAnchor="middle" y="3" fontSize="9" fontWeight="750" fill={status === "running" || status === "approval" ? "#171717" : "#fff"}>{agentInitials(agent)}</text>
        </g>
      </g>;
    })}
  </svg>;
}
