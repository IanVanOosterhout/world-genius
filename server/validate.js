/* Everything arriving from a browser is treated as hostile until it has been through here.

   The server cannot tell a real score from an invented one: the game runs entirely in the page,
   so anyone with the developer console open can post whatever they like. What it can do is
   refuse anything the game itself could never have produced, which stops accidents, stale
   clients and idle tampering from polluting a board. See server/README.md. */

export const MODES = new Set(["fact", "flag", "capital"]);
/* Round length is a free number now, not one of three presets, so the check is a range. The
   upper bound is the number of playable countries: the game will not let anyone pick a round
   longer than the region can fill. */
export const LEN_MIN = 1;
export const LEN_MAX = 197;
export const validLen = (v) => Number.isInteger(v) && v >= LEN_MIN && v <= LEN_MAX;
/* Every region the country data actually has, not the subset the home screen currently offers
   as filter buttons. Pinning this to the UI meant a region the game could legitimately start
   using would have its scores refused, and refused permanently, which is worse than useless. */
export const REGIONS = new Set(["all",
  "Africa", "Asia", "Europe", "North America", "South America", "Oceania"]);
export const NAME_MAX = 14;
export const CLUES_PER_COUNTRY = 10;

// Same normalisation the browser applies, so a name cannot arrive here in a shape the local
// board would never store.
export function cleanName(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/* The browser generates this once and keeps it. It is the identity that owns scores and
   challenges; the name is only how a friend finds you, which is why the name is unique but not
   the thing rows hang off. Renaming yourself therefore keeps your history. */
export function validPlayerId(v) {
  return typeof v === "string" && /^[0-9a-f]{16,64}$/.test(v);
}

export function validChallengeId(v) {
  return typeof v === "string" && /^[0-9a-f]{16,64}$/.test(v);
}

/* A question is a country and, for a fact round, which of its ten clues was shown. The server
   holds no country list, so the code is checked for shape rather than membership: enough to
   reject garbage, and the client would fail to render a country it does not know anyway. */
export function validQuestions(q, len) {
  if (!Array.isArray(q) || q.length !== len) return "questions";
  for (const e of q) {
    if (!e || typeof e !== "object") return "questions";
    if (typeof e.iso !== "string" || !/^[A-Z]{2}$/.test(e.iso)) return "questions";
    if (!Number.isInteger(e.clue) || e.clue < 0 || e.clue >= CLUES_PER_COUNTRY) return "questions";
  }
  return null;
}

export function validSetup(b) {
  if (!MODES.has(b.mode)) return "mode";
  if (!validLen(b.len)) return "len";
  if (typeof b.reg !== "string" || !REGIONS.has(b.reg)) return "reg";
  return null;
}

export function validResult(b, len) {
  if (!Number.isInteger(b.score) || b.score < 0 || b.score > len) return "score";
  if (!Number.isInteger(b.streak) || b.streak < 0 || b.streak > len) return "streak";
  return null;
}

export function validRound(b) {
  if (!b || typeof b !== "object") return "body must be an object";
  if (!validPlayerId(b.playerId)) return "playerId";
  if (!cleanName(b.name)) return "name";
  const setup = validSetup(b);
  if (setup) return setup;
  return validResult(b, b.len);
}

/* A board query names a mode and a region and nothing else: the length of the round is not part
   of what a board covers any more, so a query carrying one is neither required nor refused. */
export function validQuery(q) {
  if (!MODES.has(q.mode)) return "mode";
  if (!REGIONS.has(q.reg)) return "reg";
  if (q.scope !== "world" && q.scope !== "friends") return "scope";
  if (q.scope === "friends" && !validPlayerId(q.playerId)) return "playerId";
  if (q.playerId != null && q.playerId !== "" && !validPlayerId(q.playerId)) return "playerId";
  return null;
}
