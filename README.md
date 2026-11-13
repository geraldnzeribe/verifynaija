# VerifyNaija

**Photograph a product pack. Find out if it shows signs of being fake.**

Fake medicines, food and cosmetics are sold openly in Nigerian markets. NAFDAC can't stand at every stall, and most shoppers have no quick way to check what they're buying. VerifyNaija gives them three checks in one photo, and keeps a public record of fakes that nobody can quietly delete.

Built for the NEAR Hackathon (Nov 2026). Tracks: AI Security & Defense, Open Innovation.

## What it does

1. **Reads the label.** A vision model pulls out the brand, product name, NAFDAC number, batch and expiry, and lists concrete problems a pharmacist would notice: misspellings, blurry print, missing batch numbers, expired dates.
2. **Checks the NAFDAC Greenbook.** For medicines, the NAFDAC number is looked up live in NAFDAC's public register of about 8,800 products. Not registered, registered to a different product, or registration lapsed? You're told.
3. **Compares with the genuine pack.** Your photo is compared with a photo of the genuine pack, and differences in logo, colour, layout and wording are marked on your photo.
4. **Shows what other buyers reported.** Reports are stored on NEAR. The app reads them straight from the chain to show how often a product has been reported, and where (a hotspot map by state).

The result is a **risk score with plain-language reasons**. The app never says a product is genuine, only whether it found red flags.

## Why NEAR

- **Tamper-proof reports.** A report of a fake in Onitsha can't be deleted by a distributor who'd rather it went away. The contract stamps each report with the block time and the submitting account, so those can't be faked by the client.
- **No wallet needed to report.** A relayer account pays the gas, so a shopper with a cheap Android phone can report in two taps. (Rewarding confirmed reporters with small NEAR tips is next on the roadmap.)
- **Open data.** Anyone, including NAFDAC, journalists or a manufacturer's brand-protection team, can read every report through public view calls without asking us.

## How it's built

```
public/            the app (plain HTML/CSS/JS, mobile-first, no build step)
api/analyze.js     label reading + Greenbook + pack comparison + score
api/report.js      relays a report to the NEAR contract
api/greenbook.js   Greenbook search
api/config.js      contract id + RPC for the browser
api/_lib/          scoring (pure, tested), Greenbook client, Gemini client, references
contract/          NEAR smart contract (C → wasm32) + tests on a mock NEAR runtime
data/              small offline Greenbook snapshot used when the site is unreachable
references/        genuine (and known-fake) pack photos, one folder per product
tools/             reference builder, accuracy evaluation, local dev server with mock mode
```

The browser reads reports directly from NEAR RPC (`get_reports`, `get_count`). Only writes go through the relayer.

### Contract methods

| Method | Type | What it does |
|---|---|---|
| `submit_report({...})` | change | Stores a report; returns its id. Adds `by` (account) and `ts` (block time). |
| `confirm_report({id})` | change | "I saw this fake too". One confirmation per account. |
| `get_count({})` | view | Number of reports. |
| `get_reports({from, limit})` | view | Newest first, up to 50 per call, with confirmation counts. |
| `get_report({id})` | view | One report, or `null`. |

The contract is written in C and compiled to WebAssembly with `zig cc` (`npm run build:contract`). It talks to the NEAR host functions directly, has no dependencies, and compiles to an 8 KB wasm file. `npm test` runs it against a mock NEAR runtime.

## Honest limits

- The Greenbook proves a NAFDAC number is registered. It can't prove the pack in your hand is genuine, because counterfeiters copy real numbers. That's why the photo comparison and buyer reports matter.
- The Greenbook covers medicines and medical products, not food or cosmetics. For those, the app relies on the label check, the photo comparison and reports.
- The photo comparison is only as good as our reference photos. Products without a reference get the label and Greenbook checks only, and the app says so.
- AI can misread a label. Reasons are shown so a shopper can check them with their own eyes.

## Run it locally

```bash
npm install
npm test                          # contract + scoring tests
MOCK=1 node tools/devserver.mjs   # full app with canned AI and an in-memory contract
```

With real services: copy `.env.example` to `.env`, fill it in, and run `node tools/devserver.mjs`.

## Deploy

See [DEPLOY.md](DEPLOY.md).

## Roadmap

- Every confirmed report adds a labelled photo to the dataset, and with enough of them we can train a dedicated fake/genuine classifier per product.
- Small NEAR rewards for reports that others confirm.
- Brand and pharmacy accounts that can register their genuine packs and batch codes.
- WhatsApp bot: send a photo, get the result back.

## Licence

MIT
