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
| `POST` | `/v1/name` | Claim a name; 409 if someone else holds it |
| `POST` | `/v1/score` | Submit a finished round |
| `GET`  | `/v1/board` | Read a board: `scope=world\|friends`, `mode`, `len`, `reg`, `playerId` |
| `GET`  | `/v1/friends` | Your friends, requests waiting on you, and requests you sent |
| `POST` | `/v1/friends` | Ask someone to be friends, by name |
| `POST` | `/v1/friends/accept` | Accept a request, which makes it mutual |
| `POST` | `/v1/friends/decline` | Decline a request |
| `POST` | `/v1/challenge` | Send a challenge: the round you played, and the questions in it |
| `GET`  | `/v1/challenges` | Challenges waiting for you, sent by you, and settled |
| `POST` | `/v1/challenge/result` | Answer a challenge you were sent |

A player is identified by a random id the browser generates and keeps, not by their name, so
renaming yourself keeps your scores and your challenges. Names are unique because a friend finds
you by typing one. Friendship is mutual: asking creates a request, and accepting writes both
directions at once. Two people asking each other resolves immediately rather than crossing.

A challenge carries its question set as `{iso, clue}` per question. The clue index is what makes a
fact round reproducible: without it the opponent would meet the same countries but different
questions, which is not the same round.

## What it does not do

It cannot tell a real score from an invented one. Scores arrive from a browser, and anyone who
opens the developer console can post whatever they like. The server range-checks everything it
stores (a score cannot exceed the round length, a round length has to be one the game offers) and
rate-limits submissions, which stops nonsense and accidents but not a determined faker. A crew
board, shared only with people you know, is the one that stays meaningful. This is a game about
guessing countries, so that trade is deliberate: the alternative is accounts and server-side
question serving, which would cost the game its offline-first single-file design.
