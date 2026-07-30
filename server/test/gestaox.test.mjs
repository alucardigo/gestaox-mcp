import test from "node:test";
import assert from "node:assert/strict";
import { extractToken } from "../src/gestaox.mjs";
import { normalizeTicket, normalizeList } from "../src/normalize.mjs";

test("extractToken reconhece nomes prováveis de campo", () => {
  assert.equal(extractToken({ TOKEN: "REAL_confirmado_1234" }), "REAL_confirmado_1234");
  assert.equal(extractToken({ Token: "abcdefgh12345678" }), "abcdefgh12345678");
  assert.equal(extractToken({ codigo: "zzzzzzzzzzzz" }), "zzzzzzzzzzzz");
  assert.equal(extractToken({ dados: { Chave: "aninhado123456789" } }), "aninhado123456789");
  assert.equal(extractToken({ nada: "x" }), "");
  assert.equal(extractToken(null), "");
});

test("normalizeTicket mapeia apelidos e preserva _raw", () => {
  const raw = { Codigo: "MIP000009028", Descricao: "CTE não anexa nota", Status: "EM ESPERA", Solicitante: "Luis" };
  const t = normalizeTicket(raw);
  assert.equal(t.id, "MIP000009028");
  assert.equal(t.description, "CTE não anexa nota");
  assert.equal(t.status, "EM ESPERA");
  assert.equal(t.requester, "Luis");
  assert.equal(t._raw.Codigo, "MIP000009028");
});

test("normalizeList desembrulha envelope {d:[...]}", () => {
  const list = normalizeList({ d: [{ Codigo: "A1" }, { Codigo: "A2" }] });
  assert.equal(list.length, 2);
  assert.equal(list[1].id, "A2");
});

test("normalizeTicket usa fallbackId quando não há código", () => {
  const t = normalizeTicket({ Descricao: "sem código" }, "GX-X");
  assert.equal(t.id, "GX-X");
});
