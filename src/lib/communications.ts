import type { Communication } from "./types.ts";

// Keep old SQLite evidence intact while rendering one delivery per original
// completion event and recipient task. Different correction cycles remain.
export function uniqueCommunications(messages: Communication[]): Communication[] {
  const seen = new Set<string>();
  return [...messages].reverse().filter(message => {
    if (message.kind !== "handoff") return true;
    const key = `${message.missionId}:${message.sourceEventId}:${message.sourceTaskId}:${message.targetTaskId}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).reverse();
}
