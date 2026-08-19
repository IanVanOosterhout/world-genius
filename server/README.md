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
| `GET`  | `/v1/board` | Read a board: `scope=world\|friends`, `mode`, `reg`, `playerId` |
| `GET`  | `/v1/friends` | Your friends, requests waiting on you, and requests you sent |
| `POST` | `/v1/friends` | Ask someone to be friends, by name |
| `POST` | `/v1/friends/accept` | Accept a request, which makes it mutual |
| `POST` | `/v1/friends/decline` | Decline a request |
| `POST` | `/v1/challenge` | Create a challenge: the rules, and the questions both sides will meet |
| `GET`  | `/v1/challenges` | Challenges to play, played and waiting on the other, and settled |
| `POST` | `/v1/challenge/result` | Report your half of a challenge, from either side |

Every response carries the CORS header, refusals included: a 404 without it is invisible to the
browser, which reports it as a network failure rather than as the answer it is.

A player is identified by a random id the browser generates and keeps, not by their name, so
renaming yourself keeps your scores and your challenges. Names are unique because a friend finds
you by typing one. Friendship is mutual: asking creates a request, and accepting writes both
directions at once. Two people asking each other resolves immediately rather than crossing.

A challenge carries its question set as `{iso, clue}` per question. The clue index is what makes a
fact round reproducible: without it the two players would meet the same countries but different
questions, which is not the same round.

The whole set is fixed when the challenge is created, before either player has touched it, so both
of them can start at once and neither waits on the other to finish. The two sides are symmetric:
each score is null until that player has played, `/v1/challenge/result` works out which half the
caller is reporting, and whoever finishes second is the one who sees the verdict. The challenger is
just the person who chose the rules.

## Boards

A board is one mode and one region, ranked by how many questions were answered right. The round
length is not part of the query: 19 out of 20 outranks 18 out of 100, and 20 out of 100 outranks
both. Rows are still stored per `(player_id, mode, len, reg)`, so `DISTINCT ON (player_id)` picks
each player's best round and the ranking is over people rather than rounds. Each row carries the
`len` behind its score, since the board no longer has one of its own.

Order is score, then the streak behind it, then who got there first, and it matches the board the
browser builds from `localStorage` exactly, so the same round ranks the same way on either. A
`len` parameter from an older page is read and ignored rather than refused.

## Origins

Any origin is answered, and the reason is worth writing down because the alternative was tried and
broke the game. The API used to allow three origins: the Pages URL and two localhost ports. A copy
of the game opened straight off the disk, which is how the top of the main README tells people to
open it, is a `file://` page whose origin is the string `null`, so it matched nothing.

That failed in the worst way available. A simple `GET` was still sent and answered, and the browser
discarded the response, so boards looked empty rather than broken. A preflighted request, which is
every `POST` here, was never sent at all: the log shows the `OPTIONS`, a `204`, and then nothing.
The player saw "could not reach the server" from a server that was up and healthy.

The list was never protecting anything either. There are no cookies and no credentials; every
request carries its own random player id, which another site has no way of learning, so there is no
session to ride on. Anything that is not a browser ignores CORS completely. All the list did was
decide which copies of the game were allowed to work.

## What it does not do

It cannot tell a real score from an invented one. Scores arrive from a browser, and anyone who
opens the developer console can post whatever they like. The server range-checks everything it
stores (a score cannot exceed the round length, a round length has to be one the game offers) and
rate-limits submissions, which stops nonsense and accidents but not a determined faker. The
Friends board, shared only with people you know, is the one that stays meaningful. This is a game
about guessing countries, so that trade is deliberate: the alternative is accounts and server-side
question serving, which would cost the game its offline-first single-file design.
