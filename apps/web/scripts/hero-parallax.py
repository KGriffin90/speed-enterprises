"""
Layered 3D-parallax renderer for the homepage hero clips.

Turns the stills in public/images/hero/{residential,restaurant,commercial}.png into
seamless 5s/60fps clips in public/videos/hero-{mansion,restaurant,commercial}.mp4.

Why layered (not a continuous depth warp)
-----------------------------------------
A continuous per-pixel depth warp bends straight lines, which looks fake on
architecture. Instead we estimate disparity (Depth-Anything-V2), segment the
image into a few depth layers (k-means), fill what's hidden behind each layer
(inpaint), then move every layer with a SIMILARITY transform only — uniform
scale + translation about the frame centre. A similarity transform maps straight
lines to straight lines, so window frames, rooflines and kerbs stay perfectly
straight while nearer layers move/scale more than far ones → real parallax.
Composited back-to-front; the backmost layer is a fully inpainted background so
there are never holes or border gaps. Motion is eased (smootherstep) to ~0
velocity at both ends, so the rotator crossfade (HeroVideoRotator.tsx) is clean.

Re-rendering (torch has no Python 3.14 wheels yet — use 3.12):
    brew install uv
    uv venv /tmp/vpenv --python 3.12
    VIRTUAL_ENV=/tmp/vpenv uv pip install --python /tmp/vpenv/bin/python \
        torch torchvision transformers timm pillow opencv-python-headless numpy
    /tmp/vpenv/bin/python apps/web/scripts/hero-parallax.py            # all
    /tmp/vpenv/bin/python apps/web/scripts/hero-parallax.py commercial # one

Tuning per clip (CLIPS below): u/v = eased start→end camera truck/tilt; zoom =
global dolly range; scale = extra per-layer scale spread (more = stronger depth
push); P = parallax translation strength in px (x, y). Bigger moves widen the
disocclusion gaps the inpainter must invent — keep them modest for realism.
"""
import sys, time, subprocess
from pathlib import Path
import numpy as np
import cv2
import torch
from transformers import pipeline
from PIL import Image

W, H = 2560, 1440          # supersample: hard mask edges get anti-aliased on the
OUT_W, OUT_H = 1280, 720   # area-downscale to output
FPS, DUR = 60, 5.0
N = int(FPS * DUR)
K = 6                                  # depth layers

ROOT = Path(__file__).resolve().parents[1]      # apps/web
SRC = ROOT / "public" / "images" / "hero"
DST = ROOT / "public" / "videos"

DEV = "mps" if torch.backends.mps.is_available() else "cpu"
PIPE = pipeline("depth-estimation",
                model="depth-anything/Depth-Anything-V2-Small-hf", device=DEV)


def precrop(bgr, zoom, cx, cy):
    """Zoom into the subject before framing: crop a centred (cx,cy normalised)
    box of size (w/zoom, h/zoom), clamped to bounds. Used to bring a distant
    subject closer to camera."""
    h, w = bgr.shape[:2]
    cw, ch = int(round(w / zoom)), int(round(h / zoom))
    x0 = int(round(cx * w - cw / 2)); y0 = int(round(cy * h - ch / 2))
    x0 = max(0, min(w - cw, x0)); y0 = max(0, min(h - ch, y0))
    return bgr[y0:y0 + ch, x0:x0 + cw]


def cover_crop_16x9(bgr):
    h, w = bgr.shape[:2]
    t = 16 / 9
    if w / h > t:
        nw = int(round(h * t)); x0 = (w - nw) // 2; bgr = bgr[:, x0:x0 + nw]
    else:
        nh = int(round(w / t)); y0 = (h - nh) // 2; bgr = bgr[y0:y0 + nh, :]
    return cv2.resize(bgr, (W, H), interpolation=cv2.INTER_AREA)


def disparity(bgr):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    d = np.array(PIPE(Image.fromarray(rgb))["depth"], dtype=np.float32)  # bright = near
    d = cv2.resize(d, (W, H), interpolation=cv2.INTER_CUBIC)
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    d = np.clip((d - lo) / (hi - lo + 1e-6), 0, 1)
    # Reflective glass makes the depth model return speckled depth across a
    # facade; a median kills that speckle and the strong blur keeps the whole
    # facade as ONE plane, so k-means doesn't slice it into slivers (which the
    # inpaint then streaks across). Big blur also keeps parallax seams gentle.
    d = cv2.medianBlur((d * 255).astype(np.uint8), 9).astype(np.float32) / 255.0
    return cv2.GaussianBlur(d, (0, 0), 7.0)


def make_layers(bgr, disp, k=K):
    """List of (color BGR f32, alpha f32, rel_disp) ordered back→front.

    Fewer layers keeps a graded facade as ONE rigid plane: when split across
    layers, the halves separate under motion and reveal a sliver beneath
    (a faint line). Scenes with rich depth (mansion) want more layers."""
    flat = disp.reshape(-1, 1).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, lbl, centers = cv2.kmeans(flat, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    centers = centers.flatten()
    order = np.argsort(centers)
    lbl = lbl.reshape(H, W)
    d0 = float(np.median(disp[int(H*0.25):int(H*0.8), int(W*0.3):int(W*0.7)]))

    masks = [(lbl == k).astype(np.float32) for k in order]
    layers = []
    for i, k in enumerate(order):
        nearer = np.zeros((H, W), np.float32)
        for j in range(i + 1, len(order)):
            nearer = np.maximum(nearer, masks[j])
        if i == 0:                                  # backmost fills the whole frame
            hole = (masks[i] < 0.5).astype(np.uint8)
            alpha = np.ones((H, W), np.float32)
        else:
            hole = (cv2.dilate(nearer, np.ones((5, 5), np.uint8)) > 0.5).astype(np.uint8)
            # Hard mask (exact partition of unity): a feathered edge would let the
            # opaque background layer beneath bleed through along iso-depth
            # contours, leaving the wispy streaks. Edges are anti-aliased by the
            # supersampled render → area-downscale instead.
            alpha = masks[i]
        # NS inpaint with a small radius fills tighter and avoids the bright
        # diffusion "rays" TELEA leaves when a thin occluder (pole/sign) is
        # removed and later uncovered by parallax.
        color = cv2.inpaint(bgr, hole, 3, cv2.INPAINT_NS).astype(np.float32)
        layers.append((color, alpha, float(centers[k]) - d0))
    return layers


def smoother(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def render(layers, p, out_path):
    cx, cy = W / 2.0, H / 2.0
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-an",
         # area downscale: clean, no ringing (lanczos/bicubic overshoot at
         # high-contrast edges and leave bright halo outlines).
         "-vf", f"scale={OUT_W}:{OUT_H}:flags=area,format=yuv420p",
         "-c:v", "libx264", "-profile:v", "high", "-crf", "18", "-preset", "slow",
         "-movflags", "+faststart", str(out_path)],
        stdin=subprocess.PIPE)
    u0, u1 = p["u"]; v0, v1 = p["v"]; g0, g1 = p["zoom"]
    Px, Py = p["P"]; Ks = p["scale"]
    for f in range(N):
        s = smoother(f / (N - 1))
        u, v, g = u0 + (u1-u0)*s, v0 + (v1-v0)*s, g0 + (g1-g0)*s
        out = np.zeros((H, W, 3), np.float32)
        for color, alpha, rd in layers:
            sc = g * (1.0 + Ks * rd)                # nearer layers scale a touch more
            tx, ty = -u * rd * Px, -v * rd * Py     # rigid parallax translation
            M = np.array([[sc, 0, (1 - sc) * cx + tx],
                          [0, sc, (1 - sc) * cy + ty]], np.float32)
            wc = cv2.warpAffine(color, M, (W, H), flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_REFLECT_101)
            wa = cv2.warpAffine(alpha, M, (W, H), flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_REFLECT_101)[..., None]
            out = out * (1 - wa) + wc * wa
        ff.stdin.write(np.clip(out, 0, 255).astype(np.uint8).tobytes())
    ff.stdin.close(); ff.wait()


CLIPS = {
    "residential": dict(out="hero-mansion.mp4",
                        u=(-1.0, 1.0), v=(0.0, 0.0),    zoom=(1.0, 1.04), scale=0.05, P=(34, 22)),
    "restaurant":  dict(out="hero-restaurant.mp4",
                        u=(0.8, -0.8), v=(-0.1, 0.15),  zoom=(1.0, 1.05), scale=0.06, P=(30, 22)),
    # k=3 (sky / building / foreground): keeps the whole glass facade as one
    # rigid plane so it can't split and reveal a sliver under motion.
    "commercial":  dict(out="hero-commercial.mp4", precrop=(1.42, 0.515, 0.60), k=3,
                        u=(0.8, -0.8), v=(0.3, -0.3), zoom=(1.0, 1.04), scale=0.05, P=(30, 22)),
}

if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for name, p in CLIPS.items():
        if only and name != only:
            continue
        t0 = time.time()
        bgr = cv2.imread(str(SRC / f"{name}.png"))
        if "precrop" in p:
            bgr = precrop(bgr, *p["precrop"])
        bgr = cover_crop_16x9(bgr)
        render(make_layers(bgr, disparity(bgr), p.get("k", K)), p, DST / p["out"])
        print(f"{p['out']}: {time.time()-t0:.1f}s")
    print("done")
