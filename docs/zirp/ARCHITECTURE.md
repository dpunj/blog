# divesh_zirp v0

`divesh_zirp` is a local-first personal oracle for Divesh's writing, taste, reading, and founder context. It borrows the `vgr_zirp` shape, but keeps v0 deliberately simple: no hosted vector database, no required API calls, and no journal indexing by default.

## Goals

- Retrieve grounded context from self-authored writing and taste data.
- Answer in a Divesh-flavored voice without pretending to be omniscient.
- Cite source paths/titles so outputs can be traced back.
- Stay private-first: local corpus, optional LLM call only if an API key exists.

## Corpus tiers

| Tier | Sources | Weight | Notes |
| --- | --- | ---: | --- |
| 0 | Blog essays, waves, about page | 1.30 | Highest-signal self-authored public writing. |
| 1 | Personal notes, root notes, selected resources | 1.15 | Private self-context and taste notes. `journal/` excluded by default. |
| 2 | Versa strategy and sales notes | 1.05 | Operator/founder context. |
| 3 | Readwise/Zotero resource metadata | 0.75 | What Divesh reads and saves. Uses title/author/description/tags. |
| 4 | Goodreads CSV | 0.70 | Books read/to-read, ratings, shelves. |
| 5 | Spotify playlist export | 0.55 | Taste signal, not a factual source. |

## Current retrieval

v0 uses weighted lexical retrieval:

1. Load local corpus records.
2. Tokenize query and documents.
3. Score unique and repeated token matches.
4. Add boosts for title matches and exact phrase matches.
5. Multiply by source-tier weight.
6. Return top sources with snippets.

This is intentionally crude but useful. v1 should add embeddings with a local SQLite vector extension, LanceDB, or a hosted vector index.

## Commands

```bash
bun zirp inventory
bun zirp search "games as training grounds"
bun zirp prompt "connect WoW, feedback loops, and Versa"
bun zirp ask "what should I write next?"
```

`ask` calls Anthropic only if `ANTHROPIC_API_KEY` is present. Otherwise it prints the composed prompt for copy/paste into any model.

## Privacy defaults

- Does not index `journal/` unless `--include-journal` is passed.
- Does not modify notes or source data.
- Reads `~/code/blog/data/knowledge.db` in immutable read-only mode.
- API calls are opt-in via environment variables.

## v1 upgrades

- Embeddings and semantic search.
- Derived `SOUL.md` / `STYLE.md` from the full self-authored corpus.
- A small local web UI under `/zirp` or `/oracle`.
- MCP server exposing `ask_divesh_zirp` and `search_divesh_corpus`.
- Source curation UI for including/excluding sensitive files.
