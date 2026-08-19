# World Genius API

The shared leaderboard behind the game. The game itself is a single static file that works with
no network at all; this only backs the Friends and World boards. Everything it serves is derived
from finished rounds submitted by players.

    npm install
    DATABASE_URL=postgres://... npm start

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness, and whether the database is reachable |
| `POST` | `/v1/score` | Submit a finished round |
| `GET`  | `/v1/board` | Read a board: `scope=world\|crew`, `mode`, `len`, `reg`, optional `crew`, `playerId` |
| `POST` | `/v1/crew` | Create a crew, returns its code |
| `POST` | `/v1/crew/join` | Join a crew by code |

A player is identified by a random id the browser generates and keeps, not by their name, so two
people can share a name and one person can rename themselves without splitting or merging rows.

## What it does not do

It cannot tell a real score from an invented one. Scores arrive from a browser, and anyone who
opens the developer console can post whatever they like. The server range-checks everything it
stores (a score cannot exceed the round length, a round length has to be one the game offers) and
rate-limits submissions, which stops nonsense and accidents but not a determined faker. A crew
board, shared only with people you know, is the one that stays meaningful. This is a game about
guessing countries, so that trade is deliberate: the alternative is accounts and server-side
question serving, which would cost the game its offline-first single-file design.
