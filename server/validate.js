/* Everything arriving from a browser is treated as hostile until it has been through here.

   The server cannot tell a real score from an invented one: the game runs entirely in the page,
   so anyone with the developer console open can post whatever they like. What it can do is
   refuse anything the game itself could never have produced, which stops accidents, stale
   clients and idle tampering from polluting a board. See server/README.md. */

export const MODES = new Set(["fact", "flag", "capital"]);
export const LENS = new Set([5, 10, 20]);
export const REGIONS = new Set(["all", "Africa", "Asia", "Europe"]);
export const NAME_MAX = 14;

// Same normalisation the browser applies, so a name cannot arrive here in a shape the local
// board would never store.
export function cleanName(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

// The browser generates this once and keeps it. Identity is the id, never the name, so two
// players may share a name and either can rename without merging or splitting their rows.
export function validPlayerId(v) {
  return typeof v === "string" && /^[0-9a-f]{16,64}$/.test(v);
}

// Ambiguous glyphs are left out: a code gets read aloud and typed in by hand.
export const CREW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function validCrewCode(v) {
  return typeof v === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(v);
}

export function validRound(b) {
  if (!b || typeof b !== "object") return "body must be an object";
  if (!validPlayerId(b.playerId)) return "playerId";
  if (!cleanName(b.name)) return "name";
  if (!MODES.has(b.mode)) return "mode";
  if (!Number.isInteger(b.len) || !LENS.has(b.len)) return "len";
  if (typeof b.reg !== "string" || !REGIONS.has(b.reg)) return "reg";
  if (!Number.isInteger(b.score) || b.score < 0 || b.score > b.len) return "score";
  if (!Number.isInteger(b.streak) || b.streak < 0 || b.streak > b.len) return "streak";
  return null;
}

export function validQuery(q) {
  if (!MODES.has(q.mode)) return "mode";
  const len = Number(q.len);
  if (!Number.isInteger(len) || !LENS.has(len)) return "len";
  if (!REGIONS.has(q.reg)) return "reg";
  if (q.scope !== "world" && q.scope !== "crew") return "scope";
  if (q.scope === "crew" && !validCrewCode(q.crew)) return "crew";
  if (q.playerId != null && q.playerId !== "" && !validPlayerId(q.playerId)) return "playerId";
  return null;
}
