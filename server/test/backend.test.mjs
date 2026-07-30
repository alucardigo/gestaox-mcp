import test from "node:test";
import assert from "node:assert/strict";
import { createBackend } from "../src/backend.mjs";

test("backend mock lista e assume com idempotência", async () => {
  const backend = await createBackend({ GESTAOX_BACKEND: "mock" });
  const tickets = await backend.list();
  assert.equal(tickets.length, 1);

  const input = { loginResponsavel: "atendente", confirmed: true, idempotencyKey: "GX-1001:assume:1" };
  const first = await backend.assume("GX-1001", input);
  const replay = await backend.assume("GX-1001", input);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.assignee, "atendente");
});

test("backend mock resolve muda status e é idempotente", async () => {
  const backend = await createBackend({ GESTAOX_BACKEND: "mock" });
  const input = { descricao: "Resolvido em campo.", status: "Resolvido", confirmed: true, idempotencyKey: "GX-1001:resolve:1" };
  const first = await backend.resolve("GX-1001", input);
  assert.equal(first.status, "Resolvido");
  const replay = await backend.resolve("GX-1001", input);
  assert.equal(replay.replayed, true);
});

test("escrita sem confirmação é bloqueada", async () => {
  const backend = await createBackend({ GESTAOX_BACKEND: "mock" });
  await assert.rejects(
    backend.assume("GX-1001", { confirmed: false, idempotencyKey: "GX-1001:x:1" }),
    /bloqueada/
  );
});

test("backend gestaox exige GESTAOX_LOGIN", async () => {
  await assert.rejects(createBackend({ GESTAOX_BACKEND: "gestaox" }), /GESTAOX_LOGIN/);
});

test("backend inválido é rejeitado", async () => {
  await assert.rejects(createBackend({ GESTAOX_BACKEND: "sqs" }), /inválido/);
});
