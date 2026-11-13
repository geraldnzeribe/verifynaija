# Deploying VerifyNaija

About 20 minutes. You need: a computer with Node.js 20+, a GitHub account, a Vercel account, and a free Gemini API key.

## 1. Deploy the NEAR contract (testnet)

Open a terminal (PowerShell on Windows) in the project folder.

```bash
npm install -g near-cli-rs
```

Create the contract account. The faucet funds it with free testnet NEAR. Pick your own name; it must end in `.testnet`.

```bash
near account create-account sponsor-by-faucet-service verifynaija-gerald.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

Deploy the compiled contract (already built, at `contract/verifynaija.wasm`):

```bash
near contract deploy verifynaija-gerald.testnet use-file contract/verifynaija.wasm without-init-call network-config testnet sign-with-legacy-keychain send
```

Check it works:

```bash
near contract call-function as-read-only verifynaija-gerald.testnet get_count json-args '{}' network-config testnet now
```

It should print `0`.

The account's private key is now in `~/.near-credentials/testnet/verifynaija-gerald.testnet.json` (on Windows: `C:\Users\<you>\.near-credentials\testnet\`). You'll paste the `private_key` value into Vercel in step 3. **Never commit it or share it.**

## 2. Push the code to GitHub

Create a new public repository called `verifynaija` on github.com, then from the project folder:

```bash
git init
git add .
git commit -m "VerifyNaija: counterfeit checker on NEAR"
git branch -M main
git remote add origin https://github.com/<your-username>/verifynaija.git
git push -u origin main
```

## 3. Deploy the app on Vercel

1. On vercel.com, **Add New → Project**, and import the `verifynaija` repository. Leave the build settings empty.
2. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your key from aistudio.google.com/apikey |
   | `NEAR_NETWORK` | `testnet` |
   | `NEAR_ACCOUNT_ID` | `verifynaija-gerald.testnet` |
   | `NEAR_CONTRACT_ID` | `verifynaija-gerald.testnet` |
   | `NEAR_PRIVATE_KEY` | the `private_key` value from step 1 (starts with `ed25519:`) |

3. Click **Deploy**. Open the URL on your phone and check a real product.

## 4. Add reference photos (any time)

Follow `references/README.md`, run `python3 tools/build_refs.py`, then commit and push. Vercel redeploys automatically.

To measure accuracy against your fake and genuine test photos:

```bash
node tools/evaluate.mjs https://<your-app>.vercel.app
```
