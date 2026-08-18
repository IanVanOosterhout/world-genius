# World Genius

A geography guessing game that runs in any browser, on any device. Read a clue, look at a flag, or
name a capital, then find the country by tapping it on a world map.

**To play: open `index.html` in a browser.** That's it, no server, no install, no internet
connection. Everything (map geometry, 1,970 clues, all 197 flags) is embedded in that one file.

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
- **Satellite**, NASA Blue Marble imagery reprojected onto the same Equal Earth frame, with country
  outlines drawn over it

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
(public domain) 1:50m data, on an Equal Earth projection so country sizes are not distorted the
way Mercator distorts them.

- **Pan**, drag, or swipe on touch
- **Zoom**, scroll, pinch, double-click, or the +/− buttons
- Countries too small to tap at world zoom (San Marino, Nauru, Singapore, and 27 others) are
  marked with a dot. Zoom in and the dots retire as the real shapes become tappable.
- Dependencies and territories (Greenland, Puerto Rico, French Guiana…) are drawn in a darker
  shade so the map is complete, but they are never answers.

All 197 countries are selectable, the 193 UN members plus Vatican City, Palestine, Taiwan and
Kosovo.

## Options

- **Questions per round**, 5, 10 or 20
- **Region**, whole world, or drill into Africa, Asia or Europe
- **Zoom sensitivity**, 0.3x to 2.5x, default 1x. Scales how far one scroll notch or pinch zooms
  the map. The +/- buttons keep their fixed steps.
- **Name assist**, off by default. Turn it on to see a country's name before you confirm;
  leaving it off is the real test, since you only see the shape you highlighted.

## The leaderboard

The first time the game is opened it asks for a name, once, and remembers it. Every finished
round goes on the leaderboard under that name, reached from the button on the home screen or from
the results screen.

**Switch** on the home screen hands the game to someone else: tap a name that has played before,
or type a new one. Each person is only ever asked for a name once. Scores, personal bests and the
resume card are per player, so a friend taking a turn cannot inherit or overwrite yours.

A board covers one setup at a time, since a score is only worth comparing against the same mode,
the same number of questions and the same region. Its tabs pick the mode; the round length and
region come from the home screen. Ranking is by score, then by the longest streak behind it, then
by whoever got there first.

Everything is stored in `localStorage`, so a board ranks whoever has played in that browser: one
device passed round a table. Friends on their own phones each keep their own board, and comparing
those means comparing screens.

Scores, best streaks and personal bests are kept per player and per mode/length/region in
`localStorage`.

An unfinished round is saved too, on every tap and every answer. Reload, close the tab or quit
with the X and the home screen offers it back with a **Resume** button, on the same question with
the same clue, score and streak. Starting a new round replaces it; finishing one clears it. Only a
finished round can set a personal best, which is what makes resuming worth having.

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
- `python3 build/build_sat.py` reprojects `bluemarble_21600.jpg` into the tile pyramid under
  `sat/`. It takes an optional WebP quality argument and needs `numpy` and `Pillow`. It is the
  slow step, about 90 seconds and roughly 1.5 GB of memory, but its output only changes if the
  projection or the source imagery does. The source is NASA's public-domain Blue Marble at
  21600x10800, from
  <https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x10800.jpg>.

`build_sat.py` reads `map_data.json` for the projection it has to match, so the order matters: a
run of `build_map.js` must be followed by `build_sat.py` before `build_app.js`. All three resolve
their paths from their own location, so they can be run from anywhere, and the full chain is:

```bash
node build/build_map.js && python3 build/build_sat.py && node build/build_app.js
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

The branch is rewritten rather than added to because `index.html` is 9.6 MB of
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
