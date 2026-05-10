# divesh_zirp DX walkthrough

This is the daily-use runbook for the local oracle.

## Mental model

`divesh_zirp` has three layers:

1. **Sources** — blog posts, selected vault notes, Versa notes, Readwise/Zotero metadata, Goodreads, Spotify.
2. **SQLite index** — derived `zirp_*` tables inside `data/knowledge.db`.
3. **Prompt/answer layer** — retrieved snippets + `SOUL.md` + `STYLE.md` + `LEXICON.md`, optionally sent to a model.

The source-of-truth tables stay untouched:

```txt
resources
tags
resource_tags
sync_state
```

The rebuildable oracle layer lives next to them:

```txt
zirp_sources
zirp_chunks
zirp_chunks_fts
zirp_runs
zirp_run_sources
zirp_embeddings
zirp_exclusions
```

## First setup after clone or merge

```bash
cd ~/code/blog
bun install
bun sync --export-library   # if data/knowledge.db needs to be regenerated
bun zirp init-db
bun zirp index
bun zirp stats
```

Open the local cockpit:

```bash
bun zirp serve
# http://127.0.0.1:7331
```

Expected shape after indexing:

```txt
zirp sources: ~11k
zirp chunks:  ~11k+
```

Counts will drift as Readwise/Zotero/Spotify/Goodreads change.

## Daily use

### Inventory the live corpus

```bash
bun zirp inventory
```

This reads sources directly from disk/DB and shows what would be indexed. It does not require the SQLite ZIRP index.

### Rebuild the index

```bash
bun zirp index
```

Run after:

- editing blog posts;
- adding notes;
- syncing Readwise/Zotero;
- changing Goodreads/Spotify exports.

### Search sources

```bash
bun zirp search "games as training grounds"
```

This uses the SQLite FTS index by default when present.

Force the original in-memory v0 path:

```bash
bun zirp search "games as training grounds" --memory
```

### Build a model prompt without calling an API

```bash
bun zirp prompt "connect WoW, feedback loops, and Versa"
```

This prints:

- system prompt;
- `SOUL.md` / `LEXICON.md` / `STYLE.md`;
- retrieved snippets;
- user question.

Useful for debugging or copy/pasting into another model.

### Ask the oracle

```bash
bun zirp ask "what is the hidden game I keep trying to play?"
```

If an API key is configured, this calls a model. If no key is found, it prints the prompt instead.

### Use the web cockpit

```bash
bun zirp serve
```

Then open `http://127.0.0.1:7331`. The cockpit gives you search, ask, prompt inspection, stats, run history, table browsing, and a read-only SQL scratchpad in one local UI.

## Model defaults

Default model behavior is:

1. If `OPENAI_API_KEY` exists, use **OpenAI `gpt-5.5` with reasoning effort `low`**.
2. Otherwise, if `ANTHROPIC_API_KEY` exists, use **Claude Haiku**.
3. If neither key exists, print the prompt.

Override per command:

```bash
bun zirp ask "what should I write next?" \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort low
```

The shorthand model aliases `5.5`, `gpt55`, and `gpt-55` normalize to `gpt-5.5`.

Override via env:

```bash
export ZIRP_PROVIDER=openai
export ZIRP_MODEL=gpt-5.5
export ZIRP_REASONING_EFFORT=low
bun zirp ask "give me five essay ideas only I could write"
```

Anthropic override:

```bash
bun zirp ask "summarize my recurring obsessions" \
  --provider anthropic \
  --model claude-haiku-4-5-20251001
```

## Golden queries

Use these as smoke tests after indexing.

```bash
bun zirp search "games as training grounds" --limit 5
bun zirp search "feedback loops and pressure" --limit 5
bun zirp search "Panama wedge commerce identity" --limit 5
bun zirp prompt "connect Melee, WoW, and Versa into an essay thesis"
bun zirp ask "what are my recurring obsessions?"
bun zirp ask "explain Versa using my native game metaphors"
bun zirp ask "what should I write next based on my corpus?"
```

## Fun experiments

### Mirror test

```bash
bun zirp ask "what do I seem to believe that I have not stated directly?"
```

### Essay shaper

```bash
bun zirp ask "turn feedback as force into a sharper blog intro"
```

### Taste oracle

```bash
bun zirp ask "what does my reading and music taste suggest about my aesthetic?"
```

### Founder frame

```bash
bun zirp ask "what is the hidden game Versa is playing?"
```

### Retrieval comparison

```bash
bun zirp search "feedback loops and pressure" --limit 5
bun zirp search "feedback loops and pressure" --limit 5 --memory
```

## Private mode

By default, `journal/` is excluded.

To include it:

```bash
bun zirp index --include-journal
bun zirp ask "what emotional patterns keep repeating?"
```

Treat this as spicy mode. Rebuild without it when done:

```bash
bun zirp index
```

## Reset / rebuild

Rebuild derived ZIRP tables without touching source-of-truth library tables:

```bash
sqlite3 data/knowledge.db <<'SQL'
DELETE FROM zirp_run_sources;
DELETE FROM zirp_runs;
DELETE FROM zirp_embeddings;
DELETE FROM zirp_chunks_fts;
DELETE FROM zirp_chunks;
DELETE FROM zirp_sources;
SQL

bun zirp index
```

Hard reset schema:

```bash
sqlite3 data/knowledge.db <<'SQL'
DROP TABLE IF EXISTS zirp_run_sources;
DROP TABLE IF EXISTS zirp_runs;
DROP TABLE IF EXISTS zirp_embeddings;
DROP TABLE IF EXISTS zirp_chunks_fts;
DROP TABLE IF EXISTS zirp_chunks;
DROP TABLE IF EXISTS zirp_sources;
DROP TABLE IF EXISTS zirp_exclusions;
SQL

bun zirp init-db
bun zirp index
```

## Troubleshooting

### `data/knowledge.db not found`

Run the sync/export pipeline first:

```bash
bun sync --export-library
```

### Search feels stale

Rebuild:

```bash
bun zirp index
```

### Ask prints a prompt instead of answering

No API key was found for the selected provider. Add one:

```bash
export OPENAI_API_KEY=...
# or
export ANTHROPIC_API_KEY=...
```

### Search quality seems weird

Try:

```bash
bun zirp search "your query" --memory
```

If in-memory is better, the FTS query/re-ranker may need tuning.

### Too much private context

Rebuild without journal:

```bash
bun zirp index
```

Then inspect stats:

```bash
bun zirp stats
```
