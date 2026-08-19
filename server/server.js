import http from "node:http";
import crypto from "node:crypto";
import { pool, migrate } from "./db.js";
import {
  cleanName, validPlayerId, validChallengeId, validQuestions,
  validRound, validQuery, validSetup, validResult,
} from "./validate.js";

const PORT = process.env.PORT || 3000;
const BOARD_LIMIT = 100;
const BODY_MAX = 8192;   // a 20-question challenge carries its whole question set

/* The game is served from GitHub Pages and from a local server during development, so the API is
   reachable cross-origin by design. It holds no credentials and no cookies: every request
   carries its own player id, so there is no session for another site to ride on. */
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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on("data", (c) => {
      n += c.length;
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
const RATE = { window: 60_000, max: 90 };
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
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" && fwd.split(",")[0].trim()) || req.socket.remoteAddress || "?";
}

/* Claiming a name.

   The name is how a friend finds you, so it has to point at one player, but identity is still the
   id: renaming yourself keeps your scores and your challenges. A name already held by someone
   else comes back as a conflict for the player to resolve, not silently suffixed, because a name
   they did not choose is a name their friends cannot guess. */
async function claimName(id, name) {
  const taken = await pool.query("SELECT id FROM players WHERE lower(name) = lower($1)", [name]);
  if (taken.rowCount && taken.rows[0].id !== id) return { ok: false, error: "name taken" };
  await pool.query(
    `INSERT INTO players (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, seen_at = now()`,
    [id, name]
  );
  return { ok: true, name };
}

async function recordScore(b) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = await claimName(b.playerId, cleanName(b.name));
    // A score still counts when the name is contested; it lands under whatever name the player
    // already holds, and the client is told to sort the name out.
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
    return { best: rows[0], nameTaken: !claim.ok };
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
  if (q.scope === "friends") {
    params.push(q.playerId);
    // Your own row belongs on your friends board: a board you are not on is not a comparison.
    where += ` AND (s.player_id = $${params.length}
                    OR s.player_id IN (SELECT friend_id FROM friends WHERE player_id = $${params.length}))`;
  }
  params.push(BOARD_LIMIT);
  const { rows } = await pool.query(
    `SELECT p.name, s.player_id, s.score, s.streak, s.rounds
       FROM scores s JOIN players p ON p.id = s.player_id
      WHERE ${where}
      ORDER BY s.score DESC, s.streak DESC, s.at ASC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r, i) => ({
    rank: i + 1, name: r.name, score: r.score, streak: r.streak, rounds: r.rounds,
    you: q.playerId ? r.player_id === q.playerId : false,
  }));
}

/* Asking to be friends. Nothing appears on either board until the other person accepts, except
   in the one case where they had already asked you: two people who each asked for the same thing
   have already agreed, so that resolves immediately rather than leaving both waiting. */
async function requestFriend(playerId, myName, friendName) {
  const claim = await claimName(playerId, myName);
  const found = await pool.query("SELECT id, name FROM players WHERE lower(name) = lower($1)", [friendName]);
  if (!found.rowCount) return { error: "no such player", status: 404 };
  const friend = found.rows[0];
  if (friend.id === playerId) return { error: "that is you", status: 400 };

  const already = await pool.query(
    "SELECT 1 FROM friends WHERE player_id = $1 AND friend_id = $2", [playerId, friend.id]);
  if (already.rowCount) return { state: "friends", friend: { name: friend.name }, nameTaken: !claim.ok };

  const theirs = await pool.query(
    "SELECT 1 FROM friend_requests WHERE from_id = $1 AND to_id = $2", [friend.id, playerId]);
  if (theirs.rowCount) {
    await acceptFriend(playerId, friend.id);
    return { state: "friends", friend: { name: friend.name }, nameTaken: !claim.ok };
  }

  await pool.query(
    `INSERT INTO friend_requests (from_id, to_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [playerId, friend.id]);
  return { state: "requested", friend: { name: friend.name }, nameTaken: !claim.ok };
}

/* Accepting writes both directions at once, so neither side has to add the other back. */
async function acceptFriend(playerId, fromId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const req = await client.query(
      "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2 RETURNING from_id",
      [fromId, playerId]);
    if (!req.rowCount) { await client.query("ROLLBACK"); return { error: "no such request", status: 404 }; }
    await client.query(
      `INSERT INTO friends (player_id, friend_id) VALUES ($1,$2), ($2,$1) ON CONFLICT DO NOTHING`,
      [playerId, fromId]);
    // A request the other way round is now redundant.
    await client.query(
      "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2", [playerId, fromId]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function declineFriend(playerId, fromId) {
  const r = await pool.query(
    "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2", [fromId, playerId]);
  return r.rowCount ? { ok: true } : { error: "no such request", status: 404 };
}

/* Everything the friends panel shows: who you are friends with, who is waiting on you, and who
   you are waiting on. */
async function listFriends(playerId) {
  const [mine, incoming, outgoing] = await Promise.all([
    pool.query(`SELECT p.id, p.name FROM friends f JOIN players p ON p.id = f.friend_id
                 WHERE f.player_id = $1 ORDER BY lower(p.name)`, [playerId]),
    pool.query(`SELECT p.id, p.name FROM friend_requests r JOIN players p ON p.id = r.from_id
                 WHERE r.to_id = $1 ORDER BY r.created_at`, [playerId]),
    pool.query(`SELECT p.id, p.name FROM friend_requests r JOIN players p ON p.id = r.to_id
                 WHERE r.from_id = $1 ORDER BY r.created_at`, [playerId]),
  ]);
  const map = (q) => q.rows.map((r) => ({ id: r.id, name: r.name }));
  return { friends: map(mine), incoming: map(incoming), outgoing: map(outgoing) };
}

/* Creating a challenge records the challenger's round at the same time, because a challenge with
   nothing to beat is not a challenge. The question set travels with it so the opponent meets the
   identical round, clue for clue. */
async function createChallenge(b) {
  const found = await pool.query("SELECT id FROM players WHERE lower(name) = lower($1)", [b.toName]);
  if (!found.rowCount) return { error: "no such player", status: 404 };
  const toId = found.rows[0].id;
  if (toId === b.playerId) return { error: "that is you", status: 400 };
  const id = crypto.randomBytes(12).toString("hex");
  await pool.query(
    `INSERT INTO challenges (id, from_id, to_id, mode, len, reg, questions, from_score, from_streak)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, b.playerId, toId, b.mode, b.len, b.reg, JSON.stringify(b.questions), b.score, b.streak]
  );
  return { id };
}

async function answerChallenge(playerId, id, score, streak) {
  const { rows } = await pool.query("SELECT * FROM challenges WHERE id = $1", [id]);
  if (!rows.length) return { error: "no such challenge", status: 404 };
  const c = rows[0];
  if (c.to_id !== playerId) return { error: "not your challenge", status: 403 };
  if (c.played_at) return { error: "already played", status: 409 };
  if (score > c.len || streak > c.len) return { error: "bad score", status: 400 };
  await pool.query(
    "UPDATE challenges SET to_score = $2, to_streak = $3, played_at = now() WHERE id = $1",
    [id, score, streak]
  );
  return { ok: true };
}

/* Everything the challenges screen needs in one call: rounds waiting to be played, and finished
   ones from either side so both players see the head to head. */
async function listChallenges(playerId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.mode, c.len, c.reg, c.questions, c.from_id, c.to_id,
            c.from_score, c.from_streak, c.to_score, c.to_streak, c.played_at, c.created_at,
            pf.name AS from_name, pt.name AS to_name
       FROM challenges c
       JOIN players pf ON pf.id = c.from_id
       JOIN players pt ON pt.id = c.to_id
      WHERE c.from_id = $1 OR c.to_id = $1
      ORDER BY c.created_at DESC
      LIMIT 50`, [playerId]);

  const waiting = [], done = [], sent = [];
  for (const c of rows) {
    const mine = c.from_id === playerId;
    const row = {
      id: c.id, mode: c.mode, len: c.len, reg: c.reg,
      from: c.from_name, to: c.to_name,
      yourScore: mine ? c.from_score : c.to_score,
      theirScore: mine ? c.to_score : c.from_score,
      yourStreak: mine ? c.from_streak : c.to_streak,
      theirStreak: mine ? c.to_streak : c.from_streak,
      opponent: mine ? c.to_name : c.from_name,
      youStarted: mine,
    };
    if (c.played_at) done.push(row);
    else if (mine) sent.push(row);
    else waiting.push(Object.assign({ questions: c.questions, theirScore: c.from_score }, row));
  }
  return { waiting, sent, done };
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

    if (path === "/v1/name" && req.method === "POST") {
      const b = await readBody(req);
      if (!validPlayerId(b.playerId)) return send(res, 400, { error: "bad playerId" });
      const name = cleanName(b.name);
      if (!name) return send(res, 400, { error: "bad name" });
      const r = await claimName(b.playerId, name);
      return send(res, r.ok ? 200 : 409, r.ok ? { ok: true, name } : { error: "name taken" });
    }

    if (path === "/v1/board" && req.method === "GET") {
      const q = {
        scope: url.searchParams.get("scope") || "world",
        mode: url.searchParams.get("mode"),
        len: url.searchParams.get("len"),
        reg: url.searchParams.get("reg") || "all",
        playerId: url.searchParams.get("playerId") || "",
      };
      const bad = validQuery(q);
      if (bad) return send(res, 400, { error: "bad " + bad });
      return send(res, 200, { rows: await readBoard(q) });
    }

    if (path === "/v1/score" && req.method === "POST") {
      const b = await readBody(req);
      const bad = validRound(b);
      if (bad) return send(res, 400, { error: "bad " + bad });
      const r = await recordScore(b);
      return send(res, 200, { ok: true, best: r.best, nameTaken: r.nameTaken });
    }

    if (path === "/v1/friends" && req.method === "GET") {
      const playerId = url.searchParams.get("playerId") || "";
      if (!validPlayerId(playerId)) return send(res, 400, { error: "bad playerId" });
      return send(res, 200, await listFriends(playerId));
    }

    if (path === "/v1/friends" && req.method === "POST") {
      const b = await readBody(req);
      if (!validPlayerId(b.playerId)) return send(res, 400, { error: "bad playerId" });
      const myName = cleanName(b.name), friendName = cleanName(b.friend);
      if (!myName) return send(res, 400, { error: "bad name" });
      if (!friendName) return send(res, 400, { error: "bad friend" });
      const r = await requestFriend(b.playerId, myName, friendName);
      if (r.error) return send(res, r.status, { error: r.error });
      return send(res, 200, Object.assign({ ok: true, state: r.state, friend: r.friend },
        await listFriends(b.playerId)));
    }

    if ((path === "/v1/friends/accept" || path === "/v1/friends/decline") && req.method === "POST") {
      const b = await readBody(req);
      if (!validPlayerId(b.playerId)) return send(res, 400, { error: "bad playerId" });
      if (!validPlayerId(b.fromId)) return send(res, 400, { error: "bad fromId" });
      const r = path.endsWith("accept")
        ? await acceptFriend(b.playerId, b.fromId)
        : await declineFriend(b.playerId, b.fromId);
      if (r.error) return send(res, r.status, { error: r.error });
      return send(res, 200, Object.assign({ ok: true }, await listFriends(b.playerId)));
    }

    if (path === "/v1/challenge" && req.method === "POST") {
      const b = await readBody(req);
      if (!validPlayerId(b.playerId)) return send(res, 400, { error: "bad playerId" });
      const myName = cleanName(b.name), toName = cleanName(b.toName);
      if (!myName) return send(res, 400, { error: "bad name" });
      if (!toName) return send(res, 400, { error: "bad toName" });
      const setup = validSetup(b);
      if (setup) return send(res, 400, { error: "bad " + setup });
      const qs = validQuestions(b.questions, b.len);
      if (qs) return send(res, 400, { error: "bad " + qs });
      const result = validResult(b, b.len);
      if (result) return send(res, 400, { error: "bad " + result });
      await claimName(b.playerId, myName);
      const r = await createChallenge(Object.assign({}, b, { toName }));
      if (r.error) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, id: r.id });
    }

    if (path === "/v1/challenges" && req.method === "GET") {
      const playerId = url.searchParams.get("playerId") || "";
      if (!validPlayerId(playerId)) return send(res, 400, { error: "bad playerId" });
      return send(res, 200, await listChallenges(playerId));
    }

    if (path === "/v1/challenge/result" && req.method === "POST") {
      const b = await readBody(req);
      if (!validPlayerId(b.playerId)) return send(res, 400, { error: "bad playerId" });
      if (!validChallengeId(b.id)) return send(res, 400, { error: "bad id" });
      if (!Number.isInteger(b.score) || b.score < 0) return send(res, 400, { error: "bad score" });
      if (!Number.isInteger(b.streak) || b.streak < 0) return send(res, 400, { error: "bad streak" });
      const r = await answerChallenge(b.playerId, b.id, b.score, b.streak);
      if (r.error) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "no such endpoint" });
  } catch (e) {
    const msg = e && e.message ? e.message : "error";
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
