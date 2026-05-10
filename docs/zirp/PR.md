# PR: Add local-first `divesh_zirp` personal oracle v0

## Summary

This PR adds `divesh_zirp`: a local-first personal oracle for querying Divesh's writing, taste corpus, saved resources, and founder context.

Inspired by Venkatesh Rao's `vgr_zirp`, this v0 keeps the architecture intentionally simple and private: weighted local retrieval, explicit persona docs, source citations, and optional LLM answering only when `ANTHROPIC_API_KEY` is configured.

## Why

The blog repo already has the raw material for a personal ZIRP:

- self-authored essays/waves about games, feedback loops, spirituality, identity, and founding;
- a local Readwise/Zotero knowledge DB;
- Goodreads and Spotify exports that capture long-running taste signals;
- Versa strategy/sales/fundraising notes that capture the current operator context.

`divesh_zirp` makes that corpus queryable as a living mirror:

- “What do I actually believe?”
- “What should I write next?”
- “Connect WoW, feedback loops, and Versa.”
- “What does my saved reading imply about my taste?”
- “Turn this rough thought into a Divesh-shaped essay frame.”

## Inspiration

The shape comes from [`vgr_zirp`](https://ribbonfarm.com/vgr_zirp_tech/):

1. corpus-grounded answers;
2. retrieval before generation;
3. a “soul document” persona layer;
4. explicit style/lexicon artifacts instead of vague prompting.

This repo's version adapts that pattern for a private, local-first personal corpus.

## What changed

- Added `scripts/zirp.ts`
  - `inventory` — counts local corpus docs by tier/kind.
  - `search` — weighted local lexical retrieval with source snippets.
  - `prompt` — composes a full prompt with retrieved sources + persona docs.
  - `ask` — calls Anthropic if `ANTHROPIC_API_KEY` exists; otherwise prints the prompt.
- Added `bun zirp` package script.
- Added seed persona docs:
  - `docs/zirp/SOUL.md`
  - `docs/zirp/STYLE.md`
  - `docs/zirp/LEXICON.md`
- Added architecture and future docs:
  - `docs/zirp/README.md`
  - `docs/zirp/ARCHITECTURE.md`
  - `docs/zirp/SQLITE_PLAN.md`

## Corpus tiers

| Tier | Sources | Weight |
| --- | --- | ---: |
| Self-authored | Blog essays, waves, about page | 1.30 |
| Personal notes | `personal/`, `resources/`, root notes, projects | 1.15 |
| Operator notes | Versa strategy, sales, fundraising | 1.05 |
| Library metadata | Readwise/Zotero from `knowledge.db` | 0.75 |
| Books | Goodreads CSV | 0.70 |
| Music | Spotify export | 0.55 |

## Privacy defaults

- `journal/` is excluded unless `--include-journal` is passed.
- Existing `data/knowledge.db` is opened read-only/immutable.
- Source notes are never modified.
- Legal/data archive folders are not crawled.
- Network calls only happen for `ask`, and only if `ANTHROPIC_API_KEY` exists.

## Example commands

```bash
bun zirp inventory
bun zirp search "games as training grounds"
bun zirp prompt "connect WoW, feedback loops, and Versa"
bun zirp ask "what should I write next?"
```

## Validation

```bash
bunx biome check scripts/zirp.ts package.json
bun check
```

Both pass.

## Follow-up

The obvious next move is a dedicated ZIRP layer inside the existing `data/knowledge.db`:

- namespaced `zirp_*` source and chunk tables;
- FTS5 search;
- source hashing and incremental indexing;
- prompt run logging;
- later: embeddings via `sqlite-vec` or a compatible vector layer.

This keeps one local knowledge DB while clearly separating synced source data from derived oracle index data.

See `docs/zirp/SQLITE_PLAN.md`.
