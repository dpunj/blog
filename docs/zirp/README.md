# divesh_zirp

`divesh_zirp` is a local-first personal oracle for Divesh's writing, taste, reading, music, and founder context.

It is inspired by Venkatesh Rao's [`vgr_zirp`](https://ribbonfarm.com/vgr_zirp_tech/): a retrieval-augmented oracle that combines corpus search with a derived persona layer. This version keeps the same spirit, but starts with a privacy-preserving v0 that runs from the local blog/vault corpus and only calls an LLM when explicitly configured.

## Why

The blog already contains the ingredients for a personal ZIRP:

- Essays about games, computers, feedback loops, spirituality, identity, and founding.
- A local knowledge database with Readwise and Zotero resources.
- Goodreads and Spotify exports that reveal long-running taste signals.
- Versa strategy notes that capture the current founder/operator context.

The goal is not to build a generic chatbot. The goal is to make the corpus queryable as a living mirror:

- What do I actually believe?
- What patterns keep showing up in what I read, save, and write?
- What would be a very Divesh way to frame this idea?
- What should I write next?
- How does this connect to Versa, games, spirituality, or taste?

## Inspiration

`vgr_zirp` has three key ideas worth stealing:

1. **Corpus first** — answers should be grounded in actual writing and saved sources.
2. **Persona as artifact** — voice and worldview should live in explicit docs, not be hand-waved in a prompt.
3. **Retrieval before generation** — the LLM should see relevant excerpts before it speaks.

`divesh_zirp` adapts those ideas locally:

- no hosted vector DB in v0;
- no required API calls;
- no journal indexing by default;
- clear source paths in every retrieval result;
- seed `SOUL.md`, `STYLE.md`, and `LEXICON.md` docs that can later be regenerated from the corpus.

## What shipped in v0

- `scripts/zirp.ts` — a Bun CLI for local corpus inventory, SQLite indexing, search, prompt-building, and optional LLM answers.
- `docs/zirp/SOUL.md` — seed worldview/persona document.
- `docs/zirp/STYLE.md` — seed writing/answer style guide.
- `docs/zirp/LEXICON.md` — seed glossary of recurring personal concepts.
- `docs/zirp/ARCHITECTURE.md` — technical architecture and corpus tiering.
- `docs/zirp/SQLITE_PLAN.md` — follow-up plan for namespaced ZIRP tables in the existing SQLite DB.
- `docs/zirp/DX.md` — daily-use walkthrough, model config, golden queries, and troubleshooting.
- `docs/zirp/WEB_CLIENT.md` — local web cockpit and public-facing oracle plan.

## Commands

```bash
bun zirp inventory
bun zirp init-db
bun zirp index
bun zirp stats
bun zirp serve
bun zirp search "games as training grounds"
bun zirp prompt "connect WoW, feedback loops, and Versa"
bun zirp ask "what should I write next?"
```

`ask` defaults to OpenAI `gpt-5.5` with reasoning effort `low` when `OPENAI_API_KEY` is present. If OpenAI is not configured, it falls back to Anthropic when `ANTHROPIC_API_KEY` is present. If no key is configured, it prints the generated prompt so it can be pasted into any model.

Override per command:

```bash
bun zirp ask "what should I write next?" --provider openai --model gpt-5.5 --reasoning-effort low
```

## Corpus tiers

| Tier | Sources | Weight | Purpose |
| --- | --- | ---: | --- |
| Self-authored | Blog essays, waves, about page | 1.30 | Highest-signal public self-description. |
| Personal notes | `personal/`, `resources/`, root notes, projects | 1.15 | Taste, identity, and private-ish context. |
| Operator notes | Versa strategy, sales, fundraising | 1.05 | Founder/company operating context. |
| Library metadata | Readwise/Zotero from `knowledge.db` | 0.75 | Reading and saved-resource attention trail. |
| Books | Goodreads CSV | 0.70 | Long-term reading taste and shelves. |
| Music | Spotify export | 0.55 | Aesthetic/taste signal, not factual grounding. |

## Privacy posture

- `journal/` is excluded unless `--include-journal` is passed.
- Legal/data archive folders are not crawled.
- Existing `data/knowledge.db` is opened read-only/immutable.
- The CLI never modifies source notes.
- Network calls only happen in `ask`, and only when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` exists.

## Current limits

Current retrieval is SQLite FTS5 plus lexical re-ranking, not embeddings. This is good enough to make the thing durable and inspectable, but it will still miss semantically related sources that do not share words with the query.

The next obvious move is embeddings on top of the existing `zirp_*` tables. See `SQLITE_PLAN.md`.
