import { test } from "node:test";
import assert from "node:assert/strict";
import { handleLogin } from "../src/routes/login.js";

test("valid credentials return 200 with a session token", () => {
  const result = handleLogin({ email: "ada@example.com", password: "analytical-engine" });

  assert.equal(result.status, 200);
  assert.match(result.body.token, /^[\w-]+\.[\w-]+$/);
  assert.deepEqual(result.body.user, {
    id: "u_1",
    email: "ada@example.com",
    name: "Ada Lovelace",
  });
});

test("email lookup is case-insensitive", () => {
  const result = handleLogin({ email: "  Grace@Example.com ", password: "cobol-forever" });
  assert.equal(result.status, 200);
});

test("wrong password returns 401", () => {
  const result = handleLogin({ email: "ada@example.com", password: "wrong" });
  assert.equal(result.status, 401);
});

test("unknown user returns 401", () => {
  const result = handleLogin({ email: "nobody@example.com", password: "whatever" });
  assert.equal(result.status, 401);
});

test("missing fields return 400", () => {
  assert.equal(handleLogin({ email: "ada@example.com" }).status, 400);
  assert.equal(handleLogin(undefined).status, 400);
});
