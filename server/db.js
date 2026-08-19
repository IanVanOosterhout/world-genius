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

    -- A friend is added by typing their name, so a name has to point at exactly one player.
    -- Case-insensitive, because nobody remembers how a friend capitalised themselves.
    CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON players (lower(name));

    /* Friendship is mutual and stored as both directions, so a board query never has to look
       both ways round. Rows are only written once a request has been accepted. */
    CREATE TABLE IF NOT EXISTS friends (
      player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      friend_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, friend_id),
      CHECK (player_id <> friend_id)
    );

    -- An asked-for friendship that has not been answered yet. Deleted either way it goes.
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      to_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_id, to_id),
      CHECK (from_id <> to_id)
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

    /* A challenge is one fixed set of questions played by two people. the questions column holds the
       countries in order and, for fact rounds, which of that country's ten clues was shown, so
       the friend meets the identical round rather than merely the same countries. The challenger
       always plays first, which is why their score is not nullable and the opponent's is. */
    CREATE TABLE IF NOT EXISTS challenges (
      id           TEXT PRIMARY KEY,
      from_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      to_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      mode         TEXT NOT NULL,
      len          INTEGER NOT NULL,
      reg          TEXT NOT NULL,
      questions    JSONB NOT NULL,
      from_score   INTEGER NOT NULL,
      from_streak  INTEGER NOT NULL DEFAULT 0,
      to_score     INTEGER,
      to_streak    INTEGER,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      played_at    TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS scores_board_idx
      ON scores (mode, len, reg, score DESC, streak DESC, at ASC);
    CREATE INDEX IF NOT EXISTS friends_player_idx ON friends (player_id);
    CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests (to_id);
    -- The two lookups the challenges screen makes: what is waiting for me, and what have I sent.
    CREATE INDEX IF NOT EXISTS challenges_to_idx ON challenges (to_id, played_at);
    CREATE INDEX IF NOT EXISTS challenges_from_idx ON challenges (from_id, created_at DESC);
  `);

  // Crews were replaced by friends and challenges. Dropping them keeps the schema honest about
  // what the game actually does.
  await pool.query(`
    DROP TABLE IF EXISTS crew_members;
    DROP TABLE IF EXISTS crews;
  `);
}
