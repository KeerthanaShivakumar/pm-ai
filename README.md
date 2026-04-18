---
title: PM.ai
emoji: "🧭"
colorFrom: yellow
colorTo: blue
sdk: docker
app_port: 7860
short_description: PM copilot from evidence to build kickoff.
---

# PM.ai

PM.ai is a lightweight local MVP for the idea: "Tell it what you know, it tells you what to build, then builds it."

What it does:

- ingests customer interviews, feedback, and usage notes
- recommends one feature to build next with reasoning
- generates a feature spec and a Figma-style wireframe description
- writes artifacts to disk for every run
- can launch a live coding run through the OpenAI Responses API from the approved Codex brief

## Run it

Create a local env file first:

```bash
cp .env.example .env
```

Then set your values in `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4-mini
PORT=3000
HOST=127.0.0.1
```

The server loads `.env` and `.env.local` automatically. Hosted environments continue to use platform-provided environment variables through `process.env`, so the same code path works locally and in production.

Start the app:

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Modes

The app works in two modes:

1. Demo mode

   No setup required. The app uses a deterministic fallback synthesis so you can test the UX and artifact flow immediately.

2. Live OpenAI mode

   Put `OPENAI_API_KEY` in `.env` locally, or configure it as a platform secret in production.

## Live coding

```bash
CODEX_MODEL=gpt-5.3-codex
npm start
```

The UI includes a `Codex workspace path` field. PM.ai uses that as repo context inside the generated prompt, then streams model output back into the in-app code viewer while also writing the raw output and parsed file blocks into the run artifacts. Launch remains a manual action from the approved Codex stage.

## Logging and observability

PM.ai now logs the main runtime transitions on both the server and the client:

- server logs use the `[pm-ai]` prefix
- browser logs use the `[pm-ai-ui]` prefix
- request routing, workflow stage transitions, Codex stream lifecycle, and failure paths are logged
- raw customer transcripts and full prompts are not written into logs; the app logs counts, IDs, statuses, and payload sizes instead

This makes it easier to debug:

- workflow creation and stage generation issues
- stale downstream stage invalidation
- Codex launch gating and live stream failures
- Hugging Face startup and request handling problems

## Deployment

### Generic hosting

Do not commit secrets into the repo. Configure these as environment variables in your host:

- `OPENAI_API_KEY` as a secret
- `OPENAI_MODEL` as a normal env var if you want to override the default
- `PORT` and `HOST` only if your platform requires them

This app already reads from `process.env`, so platforms like Render, Railway, Fly.io, Docker hosts, and similar services work without code changes.

### Hugging Face Spaces

This repo now includes a `Dockerfile`, which is the correct route for a Node HTTP server on Hugging Face Spaces.

Use these settings:

- Space SDK: `Docker`
- Secret: `OPENAI_API_KEY`
- Variable: `OPENAI_MODEL=gpt-5.4-mini`
- Variable: `PORT=7860`
- Variable: `HOST=0.0.0.0`

The Docker image already defaults to `PORT=7860` and `HOST=0.0.0.0`, so on Hugging Face you typically only need to set the OpenAI secret and optional model override. If you want live coding enabled, set `CODEX_MODEL=gpt-5.3-codex` or keep the default.

## Artifacts

Every run creates a folder in `artifacts/` containing:

- `input.json`
- `analysis.json`
- `brief.md`
- `wireframe.md`
- `tickets.json`
- `codex-prompt.md`

If the live coding step runs, the same run folder also gets a `codex/` subdirectory with:

- `stream.log`
- `output.md`
- `files.json`
- `job.json`

## Notes

- This MVP intentionally uses no external npm dependencies.
- Local `.env` loading is built in; no `dotenv` package is required.
- Structured logging is built in; no separate logging package is required.
- File uploads are read in the browser and merged into the appropriate textarea before submission.
- The app is designed as a thin local prototype you can evolve into a fuller product workflow.

## Source of inspiration
- Cursor for Product Managers - https://www.ycombinator.com/rfs#cursor-for-product-managers
