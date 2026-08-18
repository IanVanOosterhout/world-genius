#!/usr/bin/env python3
"""Fetch the 197 playable flags and write them into build/flags/ as WebP.

    python3 build_flags.py                 fetch at the default width and audit
    python3 build_flags.py --width 1280    fetch at another width
    python3 build_flags.py --audit         audit what is already there, fetch nothing

Source is flagcdn.com, which serves public-domain flag artwork rasterised from SVG at fixed
widths, keyed by lowercase ISO 3166-1 alpha-2. Every code the game plays is available there,
including the four non-UN members: xk (Kosovo), tw (Taiwan), ps (Palestine), va (Vatican City).

Encoding is lossless WebP, not lossy. A flag is flat colour with hard edges, which is the case
lossless compresses best and lossy compresses worst: Belarus at 1280 px is 3 KB lossless against
23 KB at quality 92, and the lossy copy also rings around every edge of the ornament. So lossless
is both smaller and better here, and there is nothing to trade off.

The country list comes from map_data.json rather than a list kept here, so a country added to the
map cannot be silently left without a flag.
"""
import argparse, hashlib, io, json, os, sys, time, urllib.error, urllib.request

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, "flags")
SRC = "https://flagcdn.com/w{w}/{iso}.png"
UA = "world-genius-build (+https://github.com/IanVanOosterhout/world-genius)"
DEFAULT_WIDTH = 1280

try:
    from PIL import Image
except ImportError:
    sys.exit("build_flags: needs Pillow (pip3 install Pillow)")


def playable():
    with open(os.path.join(D, "map_data.json"), encoding="utf-8") as f:
        return [c["iso"] for c in json.load(f)["playable"]]


def fetch(iso, width, tries=3):
    url = SRC.format(w=width, iso=iso.lower())
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status != 200:
                    raise urllib.error.HTTPError(url, r.status, "bad status", r.headers, None)
                return r.read()
        except Exception as e:
            if n == tries - 1:
                raise RuntimeError("%s: %s" % (iso, e))
            time.sleep(1.5 * (n + 1))


def encode(png_bytes):
    """PNG bytes in, lossless WebP bytes out, with the alpha channel dropped where it is unused.

    flagcdn hands back a paletted PNG, sometimes with an alpha channel that is fully opaque
    (Nepal needs its transparent corners, most flags do not). Carrying a redundant alpha channel
    costs bytes in every flag that does not use it."""
    im = Image.open(io.BytesIO(png_bytes))
    im = im.convert("RGBA")
    alpha = im.getchannel("A")
    if alpha.getextrema() == (255, 255):
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=True, method=6, exact=True)
    return buf.getvalue(), im.size


def load(path):
    with open(path, "rb") as f:
        return f.read()


def audit(isos):
    """Everything that can be checked without the network, reported per flag.

    The aspect check is the one that matters for the game: the app draws a flag at its own
    proportions, so a flag stored at the wrong shape is drawn at the wrong shape."""
    problems, sizes, digests = [], {}, {}
    for iso in isos:
        p = os.path.join(OUT, iso.lower() + ".webp")
        if not os.path.exists(p):
            problems.append((iso, "no file"))
            continue
        raw = load(p)
        try:
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception as e:
            problems.append((iso, "does not decode: %s" % e))
            continue
        w, h = im.size
        sizes[iso] = (w, h, len(raw))
        if w < 640:
            problems.append((iso, "only %d px wide" % w))
        if h < 2 or w < 2:
            problems.append((iso, "degenerate %dx%d" % (w, h)))
        ratio = w / h
        if not 0.5 <= ratio <= 3.0:
            problems.append((iso, "implausible aspect %.2f" % ratio))
        if len(im.convert("RGB").getcolors(1 << 24) or []) < 2:
            problems.append((iso, "single colour, artwork is missing"))
        digests.setdefault(hashlib.sha256(im.convert("RGB").tobytes()).hexdigest(), []).append(iso)
    for d, group in digests.items():
        if len(group) > 1:
            problems.append((",".join(group), "identical artwork, one of these is the wrong flag"))
    return problems, sizes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    ap.add_argument("--audit", action="store_true", help="audit the existing files, fetch nothing")
    args = ap.parse_args()

    isos = playable()
    print("%d playable countries" % len(isos))

    if not args.audit:
        os.makedirs(OUT, exist_ok=True)
        total = grown = 0
        for i, iso in enumerate(isos, 1):
            png = fetch(iso, args.width)
            webp, size = encode(png)
            p = os.path.join(OUT, iso.lower() + ".webp")
            before = len(load(p)) if os.path.exists(p) else 0
            with open(p, "wb") as f:
                f.write(webp)
            total += len(webp)
            grown += len(webp) - before
            print("  %3d/%d  %s  %dx%d  %5.1f KB" % (i, len(isos), iso, size[0], size[1], len(webp) / 1024),
                  flush=True)
        print("wrote %d flags, %.0f KB total (%+.0f KB)" % (len(isos), total / 1024, grown / 1024))

    problems, sizes = audit(isos)
    if sizes:
        widths = sorted({w for w, h, n in sizes.values()})
        print("audit: %d flags, widths %s, %.0f KB total"
              % (len(sizes), widths, sum(n for w, h, n in sizes.values()) / 1024))
    if problems:
        print("audit: %d problem(s)" % len(problems))
        for iso, why in problems:
            print("  %s: %s" % (iso, why))
        sys.exit(1)
    print("audit: clean")


if __name__ == "__main__":
    main()
