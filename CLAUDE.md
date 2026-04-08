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

## Deploying to Railway

The app is hosted on Railway (project: `voice-email`, service: `voice-email`, environment: `production`).

```
railway link --project voice-email
railway up --detach --service voice-email
```

The production URL is https://voice-email-production.up.railway.app.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
