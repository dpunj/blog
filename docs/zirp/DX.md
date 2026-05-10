# divesh_zirp DX walkthrough

This is the canonical daily-use runbook for the local oracle.

## TL;DR

```bash
bun sync api --export-library  # fetch remote library data, then export site JSON
bun zirp inventory             # dry-run scan of the live corpus
bun zirp index                 # rebuild derived zirp_* tables
bun zirp stats                 # inspect the indexed corpus
bun zirp serve                 # open local cockpit at http://127.0.0.1:7331
```

Use `bun zirp -h` for CLI help.

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
bun sync api --export-library  # if data/knowledge.db needs fresh remote data
bun zirp init-db               # safe to rerun
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

## Command semantics

| Command | Reads | Writes | Meaning |
| --- | --- | --- | --- |
| `bun sync api --export-library` | Remote APIs | `data/knowledge.db`, `public/data/library.json` | Fetch Readwise/Zotero/etc., then export site JSON. |
| `bun sync --export-library` | `data/knowledge.db` | `public/data/library.json` | Export current DB to site JSON; no remote fetch. |
| `bun zirp inventory` | Disk + `data/knowledge.db` | Nothing | Dry-run scan: what ZIRP would index now. |
| `bun zirp index` | Disk + `data/knowledge.db` | `zirp_*` tables | Rebuild the oracle index. |
| `bun zirp stats` | `zirp_*` tables | Nothing | Inspect what is currently indexed. |
| `bun zirp serve` | `zirp_*` tables | `zirp_runs` on use | Local cockpit + SQLite explorer. |

Think:

```txt
inventory = live corpus preview
index     = live corpus → zirp_* tables
stats     = current zirp_* table counts
```

If `inventory` and `stats` disagree after syncing or editing, run `bun zirp index`.

Notes from real use:

- `bun sync api --export-library` may report fetched/synced API items even when the unique library count barely changes, especially for sources like Letterboxd that refresh recent entries.
- `bun sync --export-library` only regenerates `public/data/library.json`; it does not fetch remote APIs.
- `bun zirp inventory` can change whenever disk files or `data/knowledge.db` change. `bun zirp stats` changes only after `bun zirp index`.

## Daily use

### Refresh remote library data

```bash
bun sync api --export-library
bun zirp index
bun zirp stats
```

Use this after adding/saving new Readwise/Zotero/Letterboxd/RAWG items.

### Refresh local-only edits

```bash
bun zirp inventory
bun zirp index
bun zirp stats
```

Use this after editing blog posts, notes, Goodreads CSV, or Spotify exports.

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
