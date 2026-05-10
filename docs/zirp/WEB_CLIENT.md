# divesh_zirp web client

`bun zirp serve` runs a local web cockpit for the SQLite-backed oracle.

```bash
bun zirp serve
# opens http://127.0.0.1:7331
```

It is intentionally local-only by default. The server binds to `127.0.0.1` unless you override `--host`.

## What it does

- Search the indexed corpus.
- Ask the oracle with the same model defaults as the CLI.
- Generate and inspect prompts.
- Show index stats.
- Show recent `zirp_runs`.
- Display source cards with snippets and paths.

## Model behavior

Same as CLI:

1. `OPENAI_API_KEY` → OpenAI `gpt-5.5`, reasoning effort `low`.
2. `ANTHROPIC_API_KEY` → Claude Haiku fallback.
3. No key → return generated prompt instead of answer.

The UI exposes provider/model/reasoning controls per request.

## Local API

```txt
GET  /api/stats
GET  /api/runs
POST /api/search
POST /api/prompt
POST /api/ask
```

Example:

```bash
curl -X POST http://127.0.0.1:7331/api/search \
  -H 'content-type: application/json' \
  -d '{"query":"games as training grounds","limit":5}'
```

## Public-facing path

The current web client is a **private local cockpit**, not the public blog oracle.

For publishing `divesh_zirp` publicly, keep a hard boundary:

| Surface | Corpus | Auth | Notes |
| --- | --- | --- | --- |
| Local cockpit | Full local corpus, optional journal | localhost | Private research/building tool. |
| Public oracle | Blog posts + explicitly curated public notes only | rate-limited | Safe to embed on `divesh.gg`. |
| Private oracle | Full personal corpus | authenticated | Only if needed later. |

Public launch requirements:

- Build a separate public-safe index from `self` sources only by default.
- Exclude `personal`, `operator`, `journal`, legal/data exports, and private Readwise metadata unless explicitly allowlisted.
- Add rate limiting and cost controls.
- Add source visibility labels.
- Add a public system prompt that says it is a corpus-grounded oracle, not Divesh.
- Add a privacy checklist before deploy.

## Suggested public UX

A future `/zirp` page on the blog should be simpler than the local cockpit:

- one beautiful question box;
- a few suggested prompts;
- answer + citations;
- source chips linking to public posts;
- “what is this?” explainer;
- no private stats, runs, prompt inspector, or journal mode.

The local cockpit is for power use. The public oracle is for readers.
