#!/usr/bin/env python3
"""
Cut NASA Blue Marble (equirectangular, public domain) to the exact frame used by the vector map
and write it out as a tiled pyramid for embedding.

The map frame is equirectangular too, which is the projection the source is already in, so this
is a crop to the clipped latitude range and a resample in scale only. It used to be a full
reprojection onto an Equal Earth frame, which bowed the imagery into a rounded shell along with
everything else; the flat frame leaves the imagery looking the way the source does.

The app is fully offline, so a tiled satellite basemap fetched from a server is not an option.
Instead the whole world is baked once, ahead of time, into images that line up pixel-for-pixel
with the country borders.

A single image cannot serve the whole zoom range. The map zooms to 26x, and one image big
enough to stay sharp there would be tens of gigapixels. So this writes three levels:

  base   4000 px wide, one image, always attached. Covers the zoomed-out world view.
  L1     8000 px wide, 8x4 tiles.
  L2    16000 px wide, 16x8 tiles. Saturates the 21600x10800 source at the equator.

The app attaches only the tiles that intersect the viewport, at the highest level whose
visible tile count stays within budget, so decode memory stays bounded no matter the zoom.

Tiles carry a few pixels of bleed so neighbours overlap and no seam can show between them.

Usage:  python3 build_sat.py [quality]
"""
import json, os, sys, math
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, 'bluemarble_21600.jpg')
OUT  = os.path.join(HERE, 'sat')

BASE_W = 4000
LEVELS = [
    # width, cols, rows  -> every tile is 1000 px wide before bleed
    (8000,   8, 4),
    (16000, 16, 8),
]
BLEED = 4          # px of overlap baked into each side of every tile
SS    = 2          # supersampling factor per axis (2 -> 4 samples per output pixel)

# Quality is spent where it is looked at. Measured against a freshly rendered ground truth, a
# uniform encode leaves open-ocean tiles around 6 dB better than land tiles for no benefit:
# empty sea has nothing to preserve, while terrain is both detailed and the thing a player is
# actually staring at, magnified up to 4x at full zoom. So tiles are graded by how much land
# they hold. The test keys off Blue Marble's palette, where sea is blue-dominant and dark.
LAND_SHARE = 0.25

with open(os.path.join(HERE, 'map_data.json')) as f:
    md = json.load(f)
ext, W, H = md['ext'], md['W'], md['H']

print(f'loading {os.path.basename(SRC)} ...')
src = Image.open(SRC).convert('RGB')
SW, SH = src.size
SA = np.asarray(src)
del src
print(f'  source {SW}x{SH}  ({SA.nbytes/2**30:.2f} GiB in memory)')


def render(out_w, out_h, band=96):
    """Resample the source into an out_w x out_h RGBA array of the map frame.

    The frame is equirectangular, so the inverse is linear on both axes: a row is one latitude
    and a column is one longitude, independent of each other. Supersampling and the bilinear
    fetch are kept because the scale change still resamples every pixel.
    """
    out = np.empty((out_h, out_w, 4), np.uint8)
    px_scale = out_w / W                      # output px per map unit
    xs_base = np.arange(out_w, dtype=np.float64)

    for y0 in range(0, out_h, band):
        y1 = min(y0 + band, out_h)
        n  = y1 - y0
        acc_rgb = np.zeros((n, out_w, 3), np.float32)
        acc_cov = np.zeros((n, out_w), np.float32)
        any_rgb = np.zeros((n, out_w, 3), np.float32)

        for sy in range(SS):
            yy    = (np.arange(y0, y1) + (sy + 0.5) / SS) / px_scale        # map units
            Ymap  = ext['minY'] + yy / ext['scale']                          # projected, y-down
            lat    = np.degrees(-Ymap)                                       # undo the y flip
            row_ok = np.abs(lat) <= 90.0

            v  = (90.0 - lat) / 180.0 * (SH - 1)
            v  = np.clip(np.nan_to_num(v), 0, SH - 1)
            v0 = np.floor(v).astype(np.int32)
            v1 = np.minimum(v0 + 1, SH - 1)
            fv = (v - v0).astype(np.float32)[:, None, None]

            for sx in range(SS):
                xs   = (xs_base + (sx + 0.5) / SS) / px_scale                # map units
                Xmap = ext['minX'] + xs / ext['scale']                       # projected x
                lon  = np.degrees(Xmap)[None, :]                             # one per column

                inside = row_ok[:, None] & (np.abs(lon) <= 180.0)

                u  = (np.nan_to_num(lon) + 180.0) / 360.0 * (SW - 1)
                u  = np.clip(u, 0, SW - 1)
                u0 = np.floor(u).astype(np.int32)
                u1 = np.minimum(u0 + 1, SW - 1)
                fu = (u - u0).astype(np.float32)[:, :, None]

                r0 = SA[v0[:, None], u0].astype(np.float32)
                r1 = SA[v0[:, None], u1].astype(np.float32)
                top = r0 + (r1 - r0) * fu
                r0 = SA[v1[:, None], u0].astype(np.float32)
                r1 = SA[v1[:, None], u1].astype(np.float32)
                bot = r0 + (r1 - r0) * fu
                rgb = top + (bot - top) * fv

                cov = inside.astype(np.float32)
                acc_rgb += rgb * cov[:, :, None]
                acc_cov += cov
                any_rgb += rgb

        ns = SS * SS
        # Weight colour by coverage so a pixel straddling the projection edge is not pulled
        # toward whatever the clamp produced outside it. Fully-outside pixels keep the plain
        # mean, which is the edge-clamped colour, so lossy compression has no black to bleed.
        w = np.maximum(acc_cov, 1.0)[:, :, None]
        rgb = np.where(acc_cov[:, :, None] > 0, acc_rgb / w, any_rgb / ns)
        out[y0:y1, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
        # Antialiased coverage: the projection edge gets a soft alpha rather than a hard step.
        out[y0:y1, :, 3] = np.clip(acc_cov / ns * 255.0 + 0.5, 0, 255).astype(np.uint8)

        print(f'\r  rows {y1}/{out_h}', end='', flush=True)
    print()
    return out


def save_webp(arr, path, quality):
    Image.fromarray(arr, mode='RGBA').save(
        path, 'WEBP', quality=quality, method=6, alpha_quality=100, exact=True)
    return os.path.getsize(path)


def land_share(rgb):
    """Rough fraction of a tile that is not open water, used only to grade encode quality."""
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    return float(((b <= g + 6) | (r > 90)).mean())


def cut_tiles(level, cols, rows, prefix, q_land, q_sea):
    """Slice a rendered level into cols x rows tiles, each carrying BLEED px of overlap."""
    lh, lw = level.shape[:2]
    tw, th = lw // cols, lh // rows
    total, manifest, nland = 0, {}, 0
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * tw, r * th
            sx0, sy0 = max(0, x0 - BLEED), max(0, y0 - BLEED)
            sx1, sy1 = min(lw, x0 + tw + BLEED), min(lh, y0 + th + BLEED)
            sub = level[sy0:sy1, sx0:sx1]
            pad = ((sy0 - (y0 - BLEED), (y0 + th + BLEED) - sy1),
                   (sx0 - (x0 - BLEED), (x0 + tw + BLEED) - sx1), (0, 0))
            if any(a or b for a, b in pad[:2]):
                sub = np.pad(sub, pad, mode='edge')
            name = f'{prefix}_{c}_{r}.webp'
            is_land = land_share(level[y0:y0+th, x0:x0+tw, :3]) > LAND_SHARE
            nland += is_land
            total += save_webp(sub, os.path.join(OUT, name), q_land if is_land else q_sea)
            manifest[f'{c},{r}'] = name
        print(f'\r  tiles {(r+1)*cols}/{cols*rows}', end='', flush=True)
    print()
    return {'cols': cols, 'rows': rows, 'tw': tw, 'th': th, 'bleed': BLEED,
            'tiles': manifest}, total, nland


Q_LAND = int(sys.argv[1]) if len(sys.argv) > 1 else 84
Q_SEA  = max(1, Q_LAND - 14)
Q_BASE = max(1, Q_LAND - 6)      # the base is only ever seen downsampled, at world zoom
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.webp') or f == 'manifest.json':
        os.remove(os.path.join(OUT, f))

manifest = {'W': W, 'H': H, 'quality': {'land': Q_LAND, 'sea': Q_SEA, 'base': Q_BASE}, 'levels': []}
grand = 0

base_h = int(round(BASE_W * H / W))
print(f'base {BASE_W}x{base_h}')
n = save_webp(render(BASE_W, base_h), os.path.join(OUT, 'base.webp'), Q_BASE)
manifest['base'] = 'base.webp'
grand += n
print(f'  base.webp  {n/1024:.0f} KB')

for i, (lw, cols, rows) in enumerate(LEVELS):
    lh = int(round(lw * H / W))
    print(f'L{i+1} {lw}x{lh}  ({cols}x{rows} tiles)')
    lvl, n, nland = cut_tiles(render(lw, lh), cols, rows, f'l{i+1}', Q_LAND, Q_SEA)
    manifest['levels'].append(lvl)
    grand += n
    print(f'  L{i+1}  {n/1024/1024:.2f} MB across {cols*rows} tiles '
          f'({nland} land at q{Q_LAND}, {cols*rows-nland} sea at q{Q_SEA})')

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f)

print(f'\ntotal imagery {grand/1024/1024:.2f} MB  (land q{Q_LAND}, sea q{Q_SEA}, base q{Q_BASE})')
print(f'  ~{grand*4/3/1024/1024:.2f} MB once base64-encoded into index.html')
