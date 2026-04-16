# PM.ai

PM.ai is a lightweight local MVP for the idea: "Tell it what you know, it tells you what to build, then builds it."

What it does:

- ingests customer interviews, feedback, and usage notes
- recommends one feature to build next with reasoning
- generates a feature spec and a Figma-style wireframe description
- writes artifacts to disk for every run
- optionally launches `codex exec` to kick off implementation in a target workspace

## Run it

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Modes

The app works in two modes:

1. Demo mode

   No setup required. The app uses a deterministic fallback synthesis so you can test the UX and artifact flow immediately.

2. Live OpenAI mode

   Export an API key before starting the server:

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-5.4-mini"
npm start
```

## Optional Codex autorun

To let PM.ai invoke `codex exec` after generating the brief:

```bash
export ALLOW_CODEX_RUN=1
export CODEX_MODEL="gpt-5.3-codex"
npm start
```

The UI includes a `Codex workspace path` field. PM.ai will write the kickoff prompt to disk and, when autorun is enabled, launch `codex exec` against that workspace.

## Artifacts

Every run creates a folder in `artifacts/` containing:

- `input.json`
- `analysis.json`
- `brief.md`
- `wireframe.md`
- `tickets.json`
- `codex-prompt.md`

If Codex autorun is enabled, the same run folder also gets a `codex/` subdirectory with:

- `session.log`
- `last-message.md`

## Notes

- This MVP intentionally uses no external npm dependencies.
- File uploads are read in the browser and merged into the appropriate textarea before submission.
- The app is designed as a thin local prototype you can evolve into a fuller product workflow.
# pm-ai
