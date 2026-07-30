import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP anuncia ferramentas e executa leitura real no backend mock", async () => {
  const entrypoint = fileURLToPath(new URL("../src/index.mjs", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    env: { ...process.env, GESTAOX_BACKEND: "mock" }
  });
  const client = new Client({ name: "gestaox-test", version: "0.2.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    for (const expected of [
      "gestaox_list_tickets",
      "gestaox_get_ticket",
      "gestaox_get_history",
      "gestaox_analyze_ticket",
      "gestaox_create_ticket",
      "gestaox_assume_ticket",
      "gestaox_comment_ticket",
      "gestaox_resolve_ticket",
      "gestaox_transfer_ticket"
    ]) {
      assert.ok(names.includes(expected), `faltou a tool ${expected}`);
    }

    const health = await client.callTool({ name: "gestaox_health_check", arguments: {} });
    assert.equal(health.structuredContent.backend, "mock");

    const analysis = await client.callTool({
      name: "gestaox_analyze_ticket",
      arguments: { ticketId: "GX-1001" }
    });
    assert.equal(analysis.structuredContent.ticket.id, "GX-1001");
    assert.ok(analysis.structuredContent.analysis);
  } finally {
    await client.close();
  }
});
