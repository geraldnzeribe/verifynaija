# Reference photos

One folder per product. Copy `_example/` and rename it (lowercase, hyphens), e.g. `peak-milk-400g/`.

- `meta.json`: the product's name, brand, words that appear on the pack, category
  (`drug`, `food`, `personal_care`, `electronics`, `other`), NAFDAC number if any, and where the genuine photo came from.
- `genuine-1.jpg`: a clear, front-on photo of the **genuine** pack. This is what shoppers' photos are compared against.
  Best: your own photo of a pack bought from a trusted pharmacy or supermarket. Also fine: the maker's website or official store.
- `genuine-2.jpg`, `genuine-3.jpg`...: more genuine photos. These are held back to test the app (it should NOT flag them).
- `fake-1.jpg`, `fake-2.jpg`...: confirmed fakes (NAFDAC alerts, news, posts that show fake vs original). Used only to test accuracy.

Write the source of every photo in `sources.csv` (file, source URL, notes). Photos are not committed to git.

Then run `node tools/build_refs.mjs` (or `python3 tools/build_refs.py`).

**Faster way to get genuine photos:** list official product pages in `links.txt` and run
`node tools/fetch_refs.mjs`. It checks robots.txt, waits between requests, downloads each page's
main product image into the right folder and writes a starter `meta.json` for you to check.
