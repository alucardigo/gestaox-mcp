import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeMemory } from "./domain.mjs";

export class OperationalMemory {
  constructor(root) {
    this.root = root;
    this.file = join(root, "memory.jsonl");
  }
  async record({ ticketId, kind, note }) {
    await mkdir(this.root, { recursive: true });
    const entry = {
      at: new Date().toISOString(),
      ticketId: String(ticketId || ""),
      kind: String(kind || "note"),
      note: sanitizeMemory(note)
    };
    await appendFile(this.file, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }
  async recent(limit = 20) {
    try {
      const lines = (await readFile(this.file, "utf8")).trim().split(/\r?\n/).filter(Boolean);
      return lines.slice(-Math.max(1, Math.min(limit, 100))).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
}
