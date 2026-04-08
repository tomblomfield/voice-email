## Local development

Environment variables are not checked into the repo. Copy from the canonical source:

```
cp /Users/tom/Code/voice-email/.env .
```

Required vars: OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_SECRET.
See .env.example for details.

## Starting the server

Install dependencies if needed:

```sh
npm ci
```

Start the local dev server on port 3000:

```sh
npm run dev
```

If port 3000 is already in use, stop the existing listener first and then restart:

```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill -9 <pid>
npm run dev
```

The app should be available at http://localhost:3000.

## Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Google OAuth 2.0 for Gmail + Calendar access
- OpenAI Realtime API for voice interaction

## Deploying to Railway

The app is hosted on Railway (project: `voice-email`, service: `voice-email`, environment: `production`).

```
railway link --project voice-email
railway up --detach --service voice-email
```

The production URL is https://voice-email-production.up.railway.app.

## Testing

```
npm test
```

Uses Vitest. Tests live next to source files (e.g. `gmail.test.ts`).
