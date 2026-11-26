"""Compose the Gate 4D review stills into labelled 2 x 2 sheets (one per camera). Pillow only.

    py -3.14 -I research/geospatial_cinematic/geometry/review/compose_review.py <stills dir>
"""

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

LABELS = {
    "current": ("ACTUAL · MDS medio 1,82 m sobre textura", "Superficie derivada; fachadas = píxeles cenitales estirados"),
    "A": ("A · MDS nativo 0,5 m, muros neutros", "Valores de origen sin modificar; muros >60° sin foto"),
    "B": ("B · MDT + prismas por celda (MDS − MDT ≥ 2,5 m)", "Geometría derivada; árboles y edificios sin distinguir"),
    "C": ("C · LoD1: huellas Catastro + alturas LiDAR", "Huella oficial (CC BY 4.0 DG Catastro) · altura derivada · fachadas neutras simplificadas"),
}


def font(size, bold=False):
    for name in (("segoeuib.ttf" if bold else "segoeui.ttf"), "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main(d):
    d = pathlib.Path(d)
    for cam in ("oblique", "close"):
        tiles = [Image.open(d / f"{cam}_{v}.png").convert("RGB") for v in LABELS]
        w, h = tiles[0].size
        sheet = Image.new("RGB", (2 * w, 2 * h + 44), (14, 16, 18))
        draw = ImageDraw.Draw(sheet)
        for k, (v, tile) in enumerate(zip(LABELS, tiles)):
            x, y = (k % 2) * w, 44 + (k // 2) * h
            sheet.paste(tile, (x, y))
            draw.rectangle([x, y, x + w, y + 58], fill=(8, 9, 10))
            draw.text((x + 14, y + 6), LABELS[v][0], font=font(20, True), fill=(243, 239, 230))
            draw.text((x + 14, y + 33), LABELS[v][1], font=font(15), fill=(217, 164, 65))
        draw.text((14, 10), f"Gate 4D · revisión visual · mismo recorte, misma cámara ({cam}), misma luz ilustrativa · textura PNOA 2023 · LiDAR PNOA 2024 v1 · escala vertical 1×",
                  font=font(17), fill=(243, 239, 230))
        sheet.save(d / f"compare_{cam}.png")
        print(d / f"compare_{cam}.png")


if __name__ == "__main__":
    main(sys.argv[1])
