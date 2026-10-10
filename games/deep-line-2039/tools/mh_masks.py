"""体の UV 配置（MakeHuman の既定 UV）上に描く顔まわりのマスク。

MakeHuman の UV では顔が横倒しに置かれている: u が小さいほど頭頂、大きいほど首。v=0.4832 が顔の中心線で、
v が大きい側がキャラクターの左。体型を変えても UV は変わらないので、ここで一度描けば全員に使える。
"""
from PIL import Image, ImageDraw, ImageFilter

VC = 0.4832  # 顔の中心線


def _mirror(pts):
    return [(u, 2 * VC - v) for u, v in pts]


def _poly(d, size, pts, fill=255):
    d.polygon([(u * size, (1 - v) * size) for u, v in pts], fill=fill)


def _stroke(d, size, pts, widths, fill=255):
    """太さの変わる線（眉など）を小さな円の連なりで描く。"""
    for (u0, v0), (u1, v1), w0, w1 in zip(pts, pts[1:], widths, widths[1:]):
        n = 24
        for i in range(n + 1):
            t = i / n
            u, v, w = u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, (w0 + (w1 - w0) * t) * size
            x, y = u * size, (1 - v) * size
            d.ellipse((x - w, y - w * 0.8, x + w, y + w * 0.8), fill=fill)


BROW = [(0.8265, 0.4935), (0.8215, 0.5045), (0.8185, 0.5170), (0.8185, 0.5300), (0.8240, 0.5425)]
BROW_W = [0.0042, 0.0046, 0.0040, 0.0032, 0.0020]
# ひげ（左半分。中心線から外へ、上唇 → 頬 → もみあげ → あご下 → 首）
BEARD = [(0.8880, VC), (0.8875, 0.4990), (0.8830, 0.5130), (0.8740, 0.5350), (0.8640, 0.5580), (0.8520, 0.5850),
         (0.8360, 0.6060), (0.8420, 0.6170), (0.8700, 0.6250), (0.9050, 0.6280), (0.9400, 0.6150), (0.9640, 0.5800),
         (0.9720, 0.5300), (0.9740, VC)]
MOUSTACHE = [(0.8875, VC), (0.8870, 0.4995), (0.8960, 0.5060), (0.9060, 0.5040), (0.9010, 0.4960), (0.8990, VC)]
CHEEK = [(0.858, 0.522), (0.850, 0.540), (0.856, 0.560), (0.872, 0.552), (0.874, 0.532)]
FOREHEAD = [(0.770, 0.455), (0.770, 0.512), (0.806, 0.512), (0.806, 0.455)]


def face_masks(size=2048):
    """名前 -> PIL 画像（L, 0..255）。ぼかして境目をやわらげる。"""
    out = {}

    def new():
        im = Image.new('L', (size, size), 0)
        return im, ImageDraw.Draw(im)

    im, d = new()
    _stroke(d, size, BROW, BROW_W)
    _stroke(d, size, _mirror(BROW), BROW_W)
    out['brows'] = im.filter(ImageFilter.GaussianBlur(size / 1500))
    im, d = new()
    _poly(d, size, BEARD + list(reversed(_mirror(BEARD))))
    out['beard'] = im.filter(ImageFilter.GaussianBlur(size / 400))
    im, d = new()
    _poly(d, size, MOUSTACHE + list(reversed(_mirror(MOUSTACHE))))
    out['moustache'] = im.filter(ImageFilter.GaussianBlur(size / 700))
    im, d = new()
    _poly(d, size, CHEEK)
    _poly(d, size, _mirror(CHEEK))
    out['cheeks'] = im.filter(ImageFilter.GaussianBlur(size / 120))
    im, d = new()
    _poly(d, size, FOREHEAD)
    out['forehead'] = im.filter(ImageFilter.GaussianBlur(size / 200))
    return out
