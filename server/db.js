import pg from "pg";

/* Railway hands the connection string in DATABASE_URL. Its Postgres presents a certificate the
   public CA set does not cover, and the connection is inside Railway's private network anyway,
   so verification is turned off rather than left to fail. */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (e) => console.error("pool error:", e.message));

/* Schema is created on boot rather than by a migration tool: there is one table set, it is small,
   and every statement here is idempotent, so a redeploy is a no-op. */
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crews (
      code        TEXT PRIMARY KEY,
      created_by  TEXT REFERENCES players(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crew_members (
      crew_code   TEXT NOT NULL REFERENCES crews(code) ON DELETE CASCADE,
      player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (crew_code, player_id)
    );

    -- One row per player per setup, holding their best round of it. Same shape the browser keeps
    -- locally, so the two boards cannot disagree about what a personal best means.
    CREATE TABLE IF NOT EXISTS scores (
      player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      mode        TEXT NOT NULL,
      len         INTEGER NOT NULL,
      reg         TEXT NOT NULL,
      score       INTEGER NOT NULL,
      streak      INTEGER NOT NULL DEFAULT 0,
      rounds      INTEGER NOT NULL DEFAULT 1,
      at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, mode, len, reg)
    );

    -- Every board query filters on the setup and orders within it.
    CREATE INDEX IF NOT EXISTS scores_board_idx
      ON scores (mode, len, reg, score DESC, streak DESC, at ASC);
    CREATE INDEX IF NOT EXISTS crew_members_player_idx ON crew_members (player_id);
  `);
}
