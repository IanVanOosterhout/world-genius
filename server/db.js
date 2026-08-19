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
  /* Railway overlaps deployments, so two containers can boot and migrate at the same moment. The
     legacy step below is the one that cannot survive that: both see the old column, both try to
     drop it, and the loser crashes with "column played_at does not exist". An advisory lock makes
     the whole migration one-at-a-time; the second container waits, then finds nothing to do. */
  const gate = await pool.connect();
  try {
    await gate.query("SELECT pg_advisory_lock(4820157)");
    await runMigration();
  } finally {
    await gate.query("SELECT pg_advisory_unlock(4820157)").catch(() => {});
    gate.release();
  }
}

async function runMigration() {
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

/* A challenge is one fixed set of questions played by two people. The questions column holds the
       countries in order and, for fact rounds, which of that country's ten clues to show, so both
       players meet the identical round rather than merely the same countries.

       The whole set is decided when the challenge is created, before anybody has played it. That
       is the point: neither player waits on the other, both sides are symmetric, and each score
       is nullable until that player has finished. Whoever finishes second sees the result; whoever
       finishes first is told the other is still playing. */
    CREATE TABLE IF NOT EXISTS challenges (
      id             TEXT PRIMARY KEY,
      from_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      to_id          TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      mode           TEXT NOT NULL,
      len            INTEGER NOT NULL,
      reg            TEXT NOT NULL,
      questions      JSONB NOT NULL,
      from_score     INTEGER,
      from_streak    INTEGER,
      to_score       INTEGER,
      to_streak      INTEGER,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      from_played_at TIMESTAMPTZ,
      to_played_at   TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS scores_board_idx
      ON scores (mode, len, reg, score DESC, streak DESC, at ASC);
    CREATE INDEX IF NOT EXISTS friends_player_idx ON friends (player_id);
    CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests (to_id);
  `);

  // Crews were replaced by friends and challenges. Dropping them keeps the schema honest about
  // what the game actually does.
  await pool.query(`
    DROP TABLE IF EXISTS crew_members;
    DROP TABLE IF EXISTS crews;
  `);

  /* Bring a database built under the old challenge model forward rather than dropping it. Back
     then the challenger played first and their score was written at creation, so an existing row
     is a round they had already finished: its creation time is the only record of when, which is
     close enough for a history list and better than throwing the row away. Every statement is
     idempotent, so this is a no-op on a database that has already been through it. */
  await pool.query(`
    ALTER TABLE challenges ALTER COLUMN from_score DROP NOT NULL;
    ALTER TABLE challenges ALTER COLUMN from_streak DROP NOT NULL;
    ALTER TABLE challenges ALTER COLUMN from_streak DROP DEFAULT;
    ALTER TABLE challenges ADD COLUMN IF NOT EXISTS from_played_at TIMESTAMPTZ;
    ALTER TABLE challenges ADD COLUMN IF NOT EXISTS to_played_at   TIMESTAMPTZ;
  `);
  await pool.query(`
    UPDATE challenges SET from_played_at = created_at
     WHERE from_played_at IS NULL AND from_score IS NOT NULL`);
  /* played_at only ever meant "the opponent answered", so that is the column it becomes. The test
     and the work are one statement: a JS-side check followed by a separate query would leave the
     same gap the lock above closes, and this way the block is correct on its own. */
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'challenges' AND column_name = 'played_at') THEN
        UPDATE challenges SET to_played_at = played_at WHERE to_played_at IS NULL;
        ALTER TABLE challenges DROP COLUMN played_at;
      END IF;
    END $$;
  `);

  /* Last, because they name columns the step above is responsible for existing. Putting them up
     with the CREATE TABLEs is what broke the first two deploys of this schema: on a database
     built under the old model the index was created against a column that had not been added
     yet, and on one already migrated it was created against a column that had been dropped.

     Both sides of a challenge are looked up the same way, so both get the same index: the list
     query wants every challenge a player has a half in, and buckets them on whether each half
     has been played. */
  await pool.query(`
    CREATE INDEX IF NOT EXISTS challenges_to_idx     ON challenges (to_id, to_played_at);
    CREATE INDEX IF NOT EXISTS challenges_from_idx   ON challenges (from_id, from_played_at);
    CREATE INDEX IF NOT EXISTS challenges_recent_idx ON challenges (created_at DESC);
  `);
}
