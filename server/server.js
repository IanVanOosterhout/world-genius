import http from "node:http";
import crypto from "node:crypto";
import { pool, migrate } from "./db.js";
import {
  cleanName, validPlayerId, validCrewCode, validRound, validQuery, CREW_ALPHABET,
} from "./validate.js";

const PORT = process.env.PORT || 3000;
const BOARD_LIMIT = 100;
const BODY_MAX = 4096;

/* The game is served from GitHub Pages and opened from a file during development, so the API is
   reachable cross-origin by design. It holds no credentials and no cookies: every request
   carries its own player id, so there is no session for another site to ride on, and the
   allowlist is about keeping the surface named rather than defending a secret. */
const ORIGINS = new Set([
  "https://ianvanoosterhout.github.io",
  "http://localhost:8731",
  "http://127.0.0.1:8731",
]);

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function send(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(out);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on("data", (c) => {
      n += c.length;
      // A body this size is already far past anything the game sends; stop reading rather than
      // buffer whatever arrives.
      if (n > BODY_MAX) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("body is not JSON")); }
    });
    req.on("error", reject);
  });
}

/* A fixed-window counter per client, held in memory. It exists to stop a loop hammering the
   database, not to defend a score: a restart clears it and a second instance would keep its own.
   Both are fine for what it is protecting. */
const hits = new Map();
const RATE = { window: 60_000, max: 60 };
function rateLimited(key) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now - e.start > RATE.window) { hits.set(key, { start: now, n: 1 }); return false; }
  e.n++;
  return e.n > RATE.max;
}
setInterval(() => {
  const cut = Date.now() - RATE.window;
  for (const [k, e] of hits) if (e.start < cut) hits.delete(k);
}, RATE.window).unref();

function clientKey(req) {
  // Railway terminates TLS in front of the app, so the caller's address is in the forwarded
  // header; the socket address is the proxy's.
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" && fwd.split(",")[0].trim()) || req.socket.remoteAddress || "?";
}

async function upsertPlayer(client, id, name) {
  await client.query(
    `INSERT INTO players (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, seen_at = now()`,
    [id, name]
  );
}

/* Best round per player per setup. The round counter still climbs on a worse round, so the board
   can show how many rounds a score came out of. */
async function recordScore(b) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertPlayer(client, b.playerId, cleanName(b.name));
    const { rows } = await client.query(
      `INSERT INTO scores (player_id, mode, len, reg, score, streak, rounds, at)
       VALUES ($1,$2,$3,$4,$5,$6,1,now())
       ON CONFLICT (player_id, mode, len, reg) DO UPDATE SET
         rounds = scores.rounds + 1,
         score  = GREATEST(scores.score, EXCLUDED.score),
         streak = CASE WHEN EXCLUDED.score > scores.score THEN EXCLUDED.streak
                       ELSE GREATEST(scores.streak, EXCLUDED.streak) END,
         at     = CASE WHEN EXCLUDED.score > scores.score THEN now() ELSE scores.at END
       RETURNING score, streak, rounds`,
      [b.playerId, b.mode, b.len, b.reg, b.score, b.streak]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* Ordering matches the local board exactly: score, then the streak behind it, then who got there
   first, so the same round ranks the same way whichever board it is read from. */
async function readBoard(q) {
  const len = Number(q.len);
  const params = [q.mode, len, q.reg];
  let where = "s.mode = $1 AND s.len = $2 AND s.reg = $3";
  if (q.scope === "crew") {
    params.push(q.crew.toUpperCase());
    where += ` AND s.player_id IN (SELECT player_id FROM crew_members WHERE crew_code = $${params.length})`;
  }
  params.push(BOARD_LIMIT);
  const { rows } = await pool.query(
    `SELECT p.name, s.player_id, s.score, s.streak, s.rounds, s.at
       FROM scores s JOIN players p ON p.id = s.player_id
      WHERE ${where}
      ORDER BY s.score DESC, s.streak DESC, s.at ASC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    score: r.score,
    streak: r.streak,
    rounds: r.rounds,
    you: q.playerId ? r.player_id === q.playerId : false,
  }));
}

function newCrewCode() {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (const b of bytes) out += CREW_ALPHABET[b % CREW_ALPHABET.length];
  return out;
}

async function createCrew(playerId, name) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertPlayer(client, playerId, name);
    // 32^6 codes, so a clash is remote, but retrying costs nothing and never returning someone
    // else's crew matters.
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const t = newCrewCode();
      const r = await client.query(
        `INSERT INTO crews (code, created_by) VALUES ($1,$2)
         ON CONFLICT (code) DO NOTHING RETURNING code`, [t, playerId]);
      if (r.rowCount) code = t;
    }
    if (!code) throw new Error("could not allocate a crew code");
    await client.query(
      `INSERT INTO crew_members (crew_code, player_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`, [code, playerId]);
    await client.query("COMMIT");
    return code;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function joinCrew(playerId, name, code) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT code FROM crews WHERE code = $1", [code]);
    if (!found.rowCount) { await client.query("ROLLBACK"); return null; }
    await upsertPlayer(client, playerId, name);
    await client.query(
      `INSERT INTO crew_members (crew_code, player_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`, [code, playerId]);
    const n = await client.query("SELECT count(*)::int AS n FROM crew_members WHERE crew_code = $1", [code]);
    await client.query("COMMIT");
    return { code, members: n.rows[0].n };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch { return send(res, 400, { error: "bad url" }); }
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (path === "/health") {
      let db = "up";
      try { await pool.query("SELECT 1"); } catch { db = "down"; }
      return send(res, db === "up" ? 200 : 503, { ok: db === "up", db });
    }

    if (rateLimited(clientKey(req))) return send(res, 429, { error: "slow down" });

    if (path === "/v1/board" && req.method === "GET") {
      const q = {
        scope: url.searchParams.get("scope") || "world",
        mode: url.searchParams.get("mode"),
        len: url.searchParams.get("len"),
        reg: url.searchParams.get("reg") || "all",
        crew: (url.searchParams.get("crew") || "").toUpperCase(),
        playerId: url.searchParams.get("playerId") || "",
      };
      const bad = validQuery(q);
      if (bad) return send(res, 400, { error: "bad " + bad });
      return send(res, 200, { rows: await readBoard(q) });
    }

    if (path === "/v1/score" && req.method === "POST") {
      const body = await readBody(req);
      const bad = validRound(body);
      if (bad) return send(res, 400, { error: "bad " + bad });
      return send(res, 200, { ok: true, best: await recordScore(body) });
    }

    if (path === "/v1/crew" && req.method === "POST") {
      const body = await readBody(req);
      if (!validPlayerId(body.playerId)) return send(res, 400, { error: "bad playerId" });
      const name = cleanName(body.name);
      if (!name) return send(res, 400, { error: "bad name" });
      return send(res, 200, { code: await createCrew(body.playerId, name) });
    }

    if (path === "/v1/crew/join" && req.method === "POST") {
      const body = await readBody(req);
      if (!validPlayerId(body.playerId)) return send(res, 400, { error: "bad playerId" });
      const name = cleanName(body.name);
      if (!name) return send(res, 400, { error: "bad name" });
      const code = String(body.code || "").toUpperCase();
      if (!validCrewCode(code)) return send(res, 400, { error: "bad code" });
      const joined = await joinCrew(body.playerId, name, code);
      if (!joined) return send(res, 404, { error: "no such crew" });
      return send(res, 200, joined);
    }

    return send(res, 404, { error: "no such endpoint" });
  } catch (e) {
    const msg = e && e.message ? e.message : "error";
    // A malformed or oversized body is the caller's problem; anything else is ours and the
    // detail stays in the logs.
    if (msg === "body too large" || msg === "body is not JSON") return send(res, 400, { error: msg });
    console.error(req.method, path, msg);
    return send(res, 500, { error: "server error" });
  }
});

migrate()
  .then(() => server.listen(PORT, () => console.log("world-genius api on :" + PORT)))
  .catch((e) => { console.error("migrate failed:", e.message); process.exit(1); });

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
