// Server paging for long lists: blocks of rows, safe offsets, no overlap between blocks.
import "./env";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb } from "./helpers";
import { ctxFor } from "../lib/ctx-helper";
import { CHUNK, offsetOf, toChunk, blockSql } from "../lib/paging";
import { listJobs } from "../lib/services/jobs";
import { auditLog } from "../lib/services/admin";
import { closePool } from "../lib/db";

after(async () => { await closePool(); });

test("paging helpers: only whole positive block numbers move the offset", () => {
  assert.equal(offsetOf({}), 0);
  assert.equal(offsetOf({ older: "2" }), 2 * CHUNK);
  for (const bad of ["-1", "1.5", "abc", "1; DROP TABLE x", "999999"]) assert.equal(offsetOf({ older: bad }), 0, bad);
  assert.equal(blockSql(600), `LIMIT ${CHUNK + 1} OFFSET 600`);
  const r = toChunk(Array.from({ length: CHUNK + 1 }, (_, i) => i), 0);
  assert.equal(r.length, CHUNK); assert.equal(r.more, true);
  assert.equal(toChunk([1, 2], CHUNK).more, false);
});

test("lists come back in blocks: the next block starts after the first, with no overlap", async () => {
  await resetTestDb(true, true);
  const ctx = await ctxFor("admin", "HQ");
  const all = await auditLog(ctx, {}, 50000);
  const first = await auditLog(ctx, {}, 10, 0), second = await auditLog(ctx, {}, 10, 10);
  assert.deepEqual([...first, ...second].map((r) => r.id), all.slice(0, 20).map((r) => r.id));
  const jobs = await listJobs(await ctxFor("yousef", "YAS"));
  assert.equal(jobs.offset, 0); assert.equal(jobs.more, false);
  assert.equal((await listJobs(await ctxFor("yousef", "YAS"), "", "", CHUNK)).length, 0, "a block past the end is empty");
});
