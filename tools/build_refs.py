"""Build the genuine-pack reference set the app compares photos against.

Folder layout (one folder per product):

    references/
      emzor-paracetamol-500/
        meta.json          {"name": "...", "brand": "Emzor", "keywords": ["paracetamol"],
                            "category": "drug", "nafdac": "04-0411", "source": "emzorpharma.com"}
        genuine-1.jpg      photos of the GENUINE pack (official site, trusted retailer, or your own)
        genuine-2.jpg
        fake-1.jpg         (optional) confirmed fakes, used only for testing accuracy
      sources.csv          (optional) file,source_url,label,notes

Run:  python3 tools/build_refs.py
Writes public/refs/<id>/<n>.jpg (resized) and public/refs/refs.json. Fakes are copied to
dataset/fakes/<id>/ for tools/evaluate.mjs and are never published with the app.
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "references"
OUT = ROOT / "public" / "refs"
FAKES = ROOT / "dataset" / "fakes"
GENUINE_TEST = ROOT / "dataset" / "genuine"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def save_resized(src: Path, dst: Path, size=900):
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    im.thumbnail((size, size))
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "JPEG", quality=85, optimize=True)


def main():
    if not SRC.exists():
        sys.exit("No references/ folder yet. See the docstring at the top of this file.")
    if OUT.exists():
        shutil.rmtree(OUT)
    refs = []
    for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
        meta_path = d / "meta.json"
        if not meta_path.exists():
            print(f"skip {d.name}: no meta.json")
            continue
        meta = json.loads(meta_path.read_text())
        images = sorted(p for p in d.iterdir() if p.suffix.lower() in IMG_EXT)
        genuine = [p for p in images if p.stem.lower().startswith("genuine")]
        fakes = [p for p in images if p.stem.lower().startswith("fake")]
        if not genuine:
            print(f"skip {d.name}: no genuine-*.jpg")
            continue
        # first genuine photo is the reference; any extra genuine photos are held out for testing
        rel = f"/refs/{d.name}/1.jpg"
        save_resized(genuine[0], OUT / d.name / "1.jpg")
        for i, g in enumerate(genuine[1:], 1):
            save_resized(g, GENUINE_TEST / d.name / f"{i}.jpg", 1280)
        for i, f in enumerate(fakes, 1):
            save_resized(f, FAKES / d.name / f"{i}.jpg", 1280)
        refs.append({
            "id": d.name,
            "name": meta["name"],
            "brand": meta.get("brand", ""),
            "keywords": [k.lower() for k in meta.get("keywords", [])],
            "category": meta.get("category", "other"),
            "nafdac": meta.get("nafdac", ""),
            "source": meta.get("source", ""),
            "images": [rel],
        })
        print(f"{d.name}: 1 reference, {len(genuine) - 1} genuine test, {len(fakes)} fake test")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "refs.json").write_text(json.dumps(refs, indent=1))
    print(f"\n{len(refs)} products written to public/refs/refs.json")


if __name__ == "__main__":
    main()
