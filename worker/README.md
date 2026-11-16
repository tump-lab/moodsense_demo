# MoodSense Worker

A Cloudflare Worker that replaces what would otherwise be Firebase Cloud Functions (which need the paid Blaze plan).

| Route / trigger | What it does |
| --- | --- |
| `POST /ai` | Sends one chat completion to Claude. Needs a Firebase sign-in token. The Claude key lives only here. |
| `POST /delete` | Deletes everything stored remotely for the signed-in user (Settings → Delete my data). |
| Cron, hourly | Rebuilds `community_agg/{community}` from each user's latest check-in in the last 24 hours. |

## One-time setup

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY          # paste the Claude API key
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # paste the whole service-account JSON
npx wrangler deploy                                # prints https://moodsense-api.<you>.workers.dev
```

Put that address in the app's `.env` as `EXPO_PUBLIC_API_URL`, then rebuild the app.

The service account needs Firestore and Storage access (the default Firebase Admin SDK service account has both).

## Local checks

`npm run check` type-checks the Worker. `npx wrangler dev` runs it locally; requests without a valid sign-in token get a 401.
