// SEC-02: checks passwords off the main thread, so a burst of sign-ins does not slow everyone else's pages.
const { parentPort } = require("node:worker_threads");
const bcrypt = require("bcryptjs");
parentPort.on("message", ({ id, password, hash }) => {
  let ok = false;
  try { ok = bcrypt.compareSync(password, hash); } catch { ok = false; }
  parentPort.postMessage({ id, ok });
});
