import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { INITIAL_AGENTS, type Agent, type Activity, type Approval, type Task } from "../src/lib/types.ts";
import { TEAM_AGENTS } from "../src/lib/team.ts";
import { redactValue } from "./redact.ts";

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));");
    if (!this.all<Agent>("agent").length) INITIAL_AGENTS.forEach(a => this.put("agent", a));
  }
  put<T extends { id: string }>(kind: string, value: T) {
    this.db.prepare("INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value").run(kind, value.id, JSON.stringify(redactValue(value)));
  }
  all<T>(kind: string): T[] {
    return this.db.prepare("SELECT value FROM records WHERE kind=? ORDER BY rowid").all(kind).map(row => JSON.parse(String(row.value)) as T);
  }
  get agents() { return this.all<Agent>("agent"); }
  get tasks() { return this.all<Task>("task").reverse(); }
  get approvals() { return this.all<Approval>("approval").reverse(); }
  get events() { return this.all<Activity>("event").reverse(); }
  addEvent(event: Activity) {
    this.put("event", event);
    this.db.prepare("DELETE FROM records WHERE kind='event' AND rowid NOT IN (SELECT rowid FROM records WHERE kind='event' ORDER BY rowid DESC LIMIT 600) AND id NOT IN (SELECT json_extract(value,'$.sourceEventId') FROM records WHERE kind='communication')").run();
  }
  close() { this.db.close(); }
  async migrateTeam(backupPath?: string) {
    if (this.all<{id:string}>("migration").some(m => m.id === "team-v2")) return;
    if (backupPath) await backup(this.db, backupPath);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const agent of this.agents) if (INITIAL_AGENTS.some(a => a.id === agent.id)) this.put("agent", { ...agent, archived: true });
      for (const agent of TEAM_AGENTS) if (!this.agents.some(a => a.id === agent.id)) this.put("agent", agent);
      this.put("migration", { id: "team-v2", at: new Date().toISOString() });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
