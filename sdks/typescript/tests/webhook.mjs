import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  paycrestWebhook,
  parsePaycrestWebhook,
} from "../dist/webhook-middleware.js";

const SECRET = "test-secret";

function signBody(body) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeReq({ body, headers = {} }) {
  const ee = new EventEmitter();
  Object.assign(ee, {
    headers,
    header(name) {
      return headers[name.toLowerCase()] ?? headers[name];
    },
  });
  // Defer emission so listeners attach first.
  setImmediate(() => {
    ee.emit("data", Buffer.from(body));
    ee.emit("end");
  });
  return ee;
}

function makeRes() {
  return {
    statusCode: 200,
    _headers: {},
    _body: undefined,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    end(body) { this._body = body; },
  };
}

async function runMiddleware(mw, req, res) {
  return new Promise((resolve) => {
    mw(req, res, (err) => resolve(err));
  });
}

// --- happy path ------------------------------------------------------
{
  const mw = paycrestWebhook({ secret: SECRET });
  const body = JSON.stringify({ event: "order.settled", data: { id: "ord-1", status: "settled" } });
  const req = makeReq({ body, headers: { "x-paycrest-signature": signBody(body) } });
  const res = makeRes();

  let handlerRan = false;
  await new Promise((resolve, reject) => {
    mw(req, res, (err) => {
      if (err) return reject(err);
      handlerRan = true;
      resolve();
    });
  });

  assert.equal(handlerRan, true, "next() must fire on happy path");
  assert.equal(req.paycrestEvent.event, "order.settled");
  assert.equal(req.paycrestEvent.data.id, "ord-1");
}

// --- missing signature → 401 ----------------------------------------
{
  const mw = paycrestWebhook({ secret: SECRET });
  const body = JSON.stringify({ event: "x" });
  const req = makeReq({ body, headers: {} });
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
}

// --- invalid signature → 401 ----------------------------------------
{
  const mw = paycrestWebhook({ secret: SECRET });
  const body = JSON.stringify({ event: "x" });
  const req = makeReq({ body, headers: { "x-paycrest-signature": "deadbeef" } });
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
}

// --- invalid JSON body → 400 ----------------------------------------
{
  const mw = paycrestWebhook({ secret: SECRET });
  const body = "{ not json";
  const req = makeReq({ body, headers: { "x-paycrest-signature": signBody(body) } });
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(res.statusCode, 400);
  assert.equal(nextCalled, false);
}

// --- parsePaycrestWebhook helper -----------------------------------
{
  const body = JSON.stringify({ event: "order.pending", data: { id: "ord-2" } });
  const event = parsePaycrestWebhook(body, signBody(body), SECRET);
  assert.equal(event.data.id, "ord-2");
  assert.throws(() => parsePaycrestWebhook(body, null, SECRET), /missing signature/);
  assert.throws(() => parsePaycrestWebhook(body, "bad", SECRET), /invalid signature/);
}

console.log("typescript webhook middleware tests passed");
