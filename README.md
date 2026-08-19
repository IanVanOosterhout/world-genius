# World Genius

A geography guessing game that runs in any browser, on any device. Read a clue, look at a flag, or
name a capital, then find the country by tapping it on a world map.

**To play: open `index.html` in a browser.** That's it, no server, no install, no internet
connection. Everything (map geometry, 1,970 clues, all 197 flags) is embedded in that one file.

The shared parts, friends, challenges and the Friends and World boards, do need the internet,
and they work from a copy opened straight off the disk as well as from a hosted one. They did not
always: see [Opening it from disk used to break the shared half](#opening-it-from-disk-used-to-break-the-shared-half).

## Modes

- **Fact Mode**, a clue about what a country is known for: exports, landmarks, food, history,
  wildlife, sport. 1,970 clues across 197 countries, exactly 10 each, mixing the historical with
  the current. A clue you have already been given will not come round again for the rest of the
  session: each country cycles through all ten of its clues before any one of them repeats.
- **Flag Mode**, identify the country from its flag alone. Tap the flag to enlarge it full screen.
- **Capital Mode**, given a capital city, find its country. Countries with more than one seat of
  government (South Africa, Bolivia, the Netherlands…) show a note explaining which is which when
  the answer is revealed.

All three are answered the same way: find the country on the map and tap it, then confirm. Once
an answer is revealed, tap the flag beside the country's name to see it full screen, in any mode.

## Map styles

- **Vector** (default), flat country fills with clear borders
- **Satellite**, NASA Blue Marble imagery cut to the same frame, with country outlines drawn over it

Switch with the globe button on the map, or from the home screen. The imagery is baked into the
file like everything else, so satellite view works with no network connection.

Because the map zooms to 26x, the imagery ships as a pyramid rather than one flat picture: a
whole-world base plus two tiled levels, the finest of which is 16000 px across and saturates the
21600x10800 source at the equator. The app attaches only the tiles that overlap the viewport, at
the finest level whose visible tile count fits its budget, so the number of decoded pixels stays
roughly constant however far in you zoom. Tiles carry a few pixels of bleed so no seam can open
between them, and fade in over the coarser imagery already on screen.

## The map

Every country is drawn with real borders from [Natural Earth](https://www.naturalearthdata.com/)
(public domain) 1:50m data, on a flat equirectangular projection: longitude straight across,
latitude straight down. It was Equal Earth first, which keeps country sizes honest, but the
converging meridians bowed the whole map into a rounded shell and a curved frame is harder to
read when the task is finding a country rather than measuring one. It is also the projection
Blue Marble already ships in, so the satellite imagery needs no resampling beyond a resize.

- **Pan**, drag, or swipe on touch
- **Zoom**, scroll, pinch, double-click, or the +/− buttons
- Countries too small to tap at world zoom (San Marino, Nauru, Singapore, and 27 others) are
  marked with a dot. Zoom in and the dots retire as the real shapes become tappable.
- Dependencies and territories (Greenland, Puerto Rico, French Guiana…) are drawn in a darker
  shade so the map is complete, but they are never answers.

All 197 countries are selectable, the 193 UN members plus Vatican City, Palestine, Taiwan and
Kosovo.

## Options

- **Questions per round**, 5, 10, 20, or **Custom** for any number. The maximum is the number of
  countries in the chosen region, because a country is asked at most once per round. Narrowing the
  region brings the length down with it if it no longer fits, and presets that do not fit are
  greyed out.
- **Region**, whole world, or drill into Africa, Asia or Europe
- **Zoom sensitivity**, 0.3x to 2.5x, default 1x. Scales how far one scroll notch or pinch zooms
  the map. The +/- buttons keep their fixed steps.
- **Practice Mode**, off by default. Turn it on to see a country's name before you confirm;
  leaving it off is the real test, since you only see the shape you highlighted. Practice rounds
  are not scored: they set no personal best and go on no board. There is no Practice Mode inside
  a challenge.

## The leaderboard

The first time the game is opened it asks for a name, once, and remembers it. Every finished
round goes on the leaderboard under that name, reached from the button on the home screen or from
the results screen.

**Switch** on the home screen hands the game to someone else: tap a name that has played before,
or type a new one. Each person is only ever asked for a name once. Scores, personal bests and the
resume card are per player, so a friend taking a turn cannot inherit or overwrite yours.

A board covers one mode and one region, and **ranks by how many questions were answered right,
whatever the round length**. 19 out of 20 stands above 18 out of 100, and 20 out of 100 above
both. Each row shows the length behind the score. Its tabs pick the mode; the region comes from
the home screen. Ties break on the longest streak behind the score, then on whoever got there
first.

Personal bests are still kept per length, so one player can hold several. Only their best goes on
the board: a board ranks people, not rounds.

**Play this mode**, under the board, opens the round setup on the mode whose board is showing.
Pick the mode, region and length, then Start. It asks rather than assuming, because the board
covers every length at once and so cannot show what a round started from it would be.

### This device, Friends, World, Challenges

The leaderboard has four tabs across the top.

- **This device** is `localStorage` only: whoever has played in that browser. It needs no network
  and never fails.
- **Friends** ranks the people you have added, and you.
- **World** is everyone who has ever played.
- **Challenges** is not a ranking but a record: your wins and losses, every settled head to head,
  and the challenges still open on either side.

**Friends themselves live on the home screen**, directly under your name, not inside the
leaderboard. That is where you add one, answer a request, and start a challenge. The leaderboard's
Friends tab only ranks them.

Because a friend is found by typing their name, **names are unique**. The first person to claim
one keeps it, and anyone else is asked to pick another.

Friendship is mutual. Adding someone asks them; nothing appears on either board until they accept,
and when they do you are on each other's board without either of you adding again. Requests wait
in the same panel, with Accept and Decline. If you each ask the other, that settles on the spot
rather than leaving you both waiting.

## Challenge a friend

Press **Challenge** beside a friend's name on the home screen. You pick the rules for that round
alone, mode, region and length, and press **Start**.

**The round is built for both of you at that moment.** You start playing it immediately, and so
can they, from their home screen, without waiting for you to finish. Both of you meet **the
identical set**: same countries, same order, and in Fact Mode the same clue out of that country's
ten, so neither of you gets an easier round.

Whoever finishes first is told the other is still playing. Whoever finishes second sees the
result. Nobody is blocked on anybody, which is the point: a challenge is two people playing the
same round, not one person waiting on another's turn.

There is no Practice Mode inside a challenge. The two halves have to be the same round played the
same way, and a score with the answers showing is not one the other player can be measured
against. A challenge is otherwise an ordinary round: it counts towards your personal best and your
place on the boards, the same as any other.

**Rematch**, on the results screen, opens the setup again for the same person on the same rules,
ready to start. The questions are fresh: replaying the identical ones would only be a memory test.

The leaderboard's **Challenges** tab is the record: how many you have won and lost, every settled
head to head with its score, and the ones still open, whether they are waiting on you or on them.

Identity on the server is a random id the browser generates once, not your name, so renaming
yourself keeps your scores and your challenges.

### Opening it from disk used to break the shared half

For a while the API only answered browsers on three known origins: the GitHub Pages URL and two
localhost ports. A copy opened the way this README tells you to open it, straight off the disk, is
a `file://` page whose origin is the string `null`, which matched none of them.

The failure was quiet and misleading. A plain `GET` still reached the server, which answered
normally, and the browser then threw the response away, so boards simply looked empty. Anything
needing a preflight, which is every `POST` the game makes, never left the browser at all. Adding a
friend reported **"Could not reach the server"** while the server sat there perfectly healthy.

The API now answers any origin. The allowlist was never protecting anything: there are no cookies
and no credentials, every request carries its own random player id that another site has no way of
learning, and anything that is not a browser ignores CORS entirely. All it decided was which copies
of the game were allowed to work.

The client also used to report every failure as "could not reach the server", including refusals
the server had answered clearly. It now separates not reaching the server from being refused by
it, and says which.

There was a second half to the same bug. A name is claimed on the server when you first type it,
and if that call fails the game carries on with the name saved locally, on the principle that the
round matters more than the name. It was supposed to claim it again next time it reached the
server, and never did: the name gate was the only thing that ever claimed, and it runs once. So a
device whose first claim failed kept a name the server had never heard of, and a friend typing it
was told nobody was playing under it. The claim is now retried on every load, which is a no-op
once it has stuck.

**A public board is only as honest as the people on it.** The game runs entirely in the page, so
anyone who opens the developer console can post a score they did not earn. The server refuses
anything the game could not have produced and rate-limits submissions, which stops accidents and
idle tampering but not a determined faker. Fixing that properly would mean serving questions from
the server, which would cost the game its offline-first single-file design.

Playing never waits on the network. A round is scored and stored locally first and submitted
after, so a failure costs nothing: unsent rounds queue and go up behind the next one that gets
through.

## Rebuilding

`index.html` is generated. The inputs live in `build/`. Almost every change needs only the last
step:

```bash
node build/build_app.js
```

`build_app.js` inlines `map_data.json`, `facts_all.json`, `flags/*.webp` and the satellite tiles
into `app_template.html` and writes `index.html`, in a second or two. It parses the generated
inline script before writing, so a malformed injection fails at the terminal instead of shipping
a blank app to the browser. Edit clues in `facts_all.json` and re-run this alone. That file is
kept readable, one clue per line, grouped by region and alphabetical by country within each
region.

The other two steps rebuild `build_app.js`'s own inputs, and are only needed when the sources of
those inputs change:

- `node build/build_map.js` simplifies and projects the Natural Earth borders in
  `world50.geojson` into `map_data.json`. Run it if the borders or the projection change.
- `python3 build/build_flags.py` fetches all 197 flags from [flagcdn.com](https://flagcdn.com)
  at 1280 px wide and writes them to `flags/` as lossless WebP. Needs `Pillow` and a network
  connection. `--audit` re-checks the flags already on disk without fetching anything: that every
  playable country has one, that each decodes, that none is a single flat colour, that none is
  under-resolution, and that no two are pixel-identical, which is how a wrong country's flag
  would show up. The country list comes from `map_data.json`, so a country added to the map
  cannot silently end up with no flag.
- `python3 build/build_sat.py` reprojects `bluemarble_21600.jpg` into the tile pyramid under
  `sat/`. It takes an optional WebP quality argument and needs `numpy` and `Pillow`. It is the
  slow step, about 90 seconds and roughly 1.5 GB of memory, but its output only changes if the
  projection or the source imagery does. The source is NASA's public-domain Blue Marble at
  21600x10800, from
  <https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x10800.jpg>.

Flags are stored lossless rather than lossy. Flags are flat colour with hard edges, the case
lossless WebP compresses best and lossy compresses worst: Belarus at 1280 px is 3 KB lossless
against 23 KB at quality 92, and the lossy copy rings around every edge of its ornament. All 197
come to 1,035 KB.

`build_sat.py` reads `map_data.json` for the projection it has to match, so the order matters: a
run of `build_map.js` must be followed by `build_sat.py` before `build_app.js`. They resolve
their paths from their own location, so they can be run from anywhere, and the full chain is:

```bash
node build/build_map.js && python3 build/build_sat.py && python3 build/build_flags.py && node build/build_app.js
```

Publish the result with `./deploy.sh`, below.

## Publishing

The game is one static file, so any static host serves it. `deploy.sh` publishes it to
GitHub Pages:

```bash
./deploy.sh
```

It force-pushes `index.html` (plus an empty `.nojekyll`) to the `gh-pages` branch as a
single commit with no parent, replacing whatever was there. `--dry-run` builds the commit
locally and pushes nothing.

The branch is rewritten rather than added to because `index.html` is 10.7 MB of
already-compressed imagery. Git cannot delta one build against the previous one, so an
ordinary commit per release would put a whole fresh copy into history, permanently, in
every clone. Rewriting keeps the branch at exactly one copy, the current one. Nothing is
lost by it: the build is reproducible from `build/`, and the source history on `main` is
kept normally.

For the same reason `index.html` is not tracked on `main` at all, and neither is
`bluemarble_21600.jpg` (28 MB, re-downloadable from the NASA URL above) or the `sat/`
pyramid built from it. Everything else, including the 197 flags and every clue, is in the
repository.

Updates reach players on reload. Pages serves with `Cache-Control: max-age=600`, so a
browser that loaded the game in the last ten minutes may hold its cached copy until that
window passes.
