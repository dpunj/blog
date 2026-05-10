# SQLite plan for divesh_zirp

Yes: `divesh_zirp` should use SQLite, and the cleanest move is **separate namespaced ZIRP tables inside the existing `data/knowledge.db`**.

The existing DB is already the local knowledge substrate for Readwise/Zotero sync state and resource metadata. Rather than create a second SQLite file, v1 should add derived `zirp_*` tables that can be rebuilt without disturbing the source-of-truth tables.

## Why same DB, separate tables

| Choice | Take |
| --- | --- |
| Same `data/knowledge.db` | Best default. One local brain, one backup/export target, easy joins to existing `resources`. |
| Separate `zirp_*` tables | Keeps generated retrieval/index data clearly isolated from synced source data. |
| Separate `data/zirp.db` | Still viable later if the index gets huge, but unnecessary for v1. |

This gives us the right boundary: **same database, different layer**.

## Existing tables

Current source-of-truth tables:

```txt
resources
resource_tags
tags
sync_state
```

The ZIRP layer should never rewrite those tables except through the existing sync pipeline. It only reads from them and writes to `zirp_*` tables.

## Proposed tables

### `zirp_sources`

One row per source artifact: a blog post, note, Readwise item, Goodreads row, Spotify track, etc.

```sql
CREATE TABLE IF NOT EXISTS zirp_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,      -- blog | note | versa | readwise | zotero | goodreads | spotify
  tier TEXT NOT NULL,             -- self | personal | operator | library | books | music
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  url TEXT,
  author TEXT,
  source_hash TEXT NOT NULL,
  upstream_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  metadata_json TEXT,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`upstream_resource_id` lets Readwise/Zotero-derived ZIRP sources point back to `resources` without duplicating the whole library model.

### `zirp_chunks`

One row per searchable chunk. Even metadata-only records get a single chunk.

```sql
CREATE TABLE IF NOT EXISTS zirp_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES zirp_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  weight REAL NOT NULL DEFAULT 1.0,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, chunk_index)
);
```

### `zirp_chunks_fts`

Use SQLite FTS5 for fast local lexical search.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS zirp_chunks_fts USING fts5(
  title,
  text,
  source_id UNINDEXED,
  chunk_id UNINDEXED,
  tier UNINDEXED,
  tokenize = 'porter unicode61'
);
```

### `zirp_embeddings`

Add later once the source/chunk pipeline is stable.

```sql
CREATE TABLE IF NOT EXISTS zirp_embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES zirp_chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  embedded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

If using `sqlite-vec`, this would become a virtual vector table instead of a plain BLOB table.

### `zirp_runs` and `zirp_run_sources`

Store what was asked, what was retrieved, and what was answered.

```sql
CREATE TABLE IF NOT EXISTS zirp_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,             -- search | prompt | ask
  model TEXT,
  response_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zirp_run_sources (
  run_id TEXT NOT NULL REFERENCES zirp_runs(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES zirp_chunks(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (run_id, chunk_id)
);
```

### `zirp_exclusions`

Keep privacy controls inspectable and local.

```sql
CREATE TABLE IF NOT EXISTS zirp_exclusions (
  path_glob TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Commands

```bash
bun zirp init-db                 # creates zirp_* tables in data/knowledge.db
bun zirp index                   # crawls corpus and updates zirp_sources/chunks/fts
bun zirp index --include-journal # explicit spicy mode
bun zirp stats
bun zirp search "games as training grounds"
bun zirp ask "what should I write next?"
```

## Retrieval pipeline v1

1. Open `data/knowledge.db` normally, not immutable, for `zirp_*` writes.
2. Crawl local corpus into `zirp_sources`.
3. Read existing `resources` rows for Readwise/Zotero and link via `upstream_resource_id`.
4. Hash source content and skip unchanged records.
5. Chunk source text into 512-token windows with overlap for long docs.
6. Upsert chunks into `zirp_chunks` and `zirp_chunks_fts`.
7. Search FTS5 first.
8. Re-rank with tier weights and title/path boosts.
9. Later: blend FTS5 with vector similarity.
10. Store each run and retrieved sources for debugging.

## Chunking policy

| Source | Policy |
| --- | --- |
| Blog posts | Chunk body; preserve title/frontmatter metadata. |
| Notes | Chunk by headings first, then length. |
| Readwise/Zotero metadata | One chunk per `resources` row until full text is available. |
| Goodreads | One chunk per book row. |
| Spotify | One chunk per track in v1; artist/album aggregates later. |
| Persona docs | Store as system docs, not normal retrieval docs. |

## Privacy policy

- Default index excludes `journal/`.
- Legal/data archive folders stay excluded.
- Keep sensitive path rules in `zirp_exclusions`.
- Retrieval tables (`zirp_sources`, `zirp_chunks`, `zirp_chunks_fts`, `zirp_embeddings`, `zirp_run_sources`) are derived and can be rebuilt.
- `zirp_runs` is durable run/conversation history and should be preserved across normal `bun zirp index` runs.
- New `zirp_runs` rows store `retrieved_sources_json` so answer/source snapshots survive index rebuilds.
- The canonical synced library remains `resources` + `sync_state`.

## Migration safety

Because the ZIRP layer is namespaced, hard reset is simple. This deletes run history too:

```sql
DROP TABLE IF EXISTS zirp_run_sources;
DROP TABLE IF EXISTS zirp_runs;
DROP TABLE IF EXISTS zirp_embeddings;
DROP TABLE IF EXISTS zirp_chunks_fts;
DROP TABLE IF EXISTS zirp_chunks;
DROP TABLE IF EXISTS zirp_sources;
DROP TABLE IF EXISTS zirp_exclusions;
```

No source library data is touched.

## Open questions

- Should we use `sqlite-vec`, LanceDB, or plain embedding BLOBs first?
- Should Spotify stay track-by-track or be summarized by artist/album clusters?
- Should Readwise highlights/full text be pulled into `zirp_chunks`, or should v1 stay metadata-only?
- Should `SOUL.md` and `STYLE.md` be regenerated from stored chunks on demand?

## Status

Implemented:

- `bun zirp init-db`
- `bun zirp index`
- `bun zirp stats`
- FTS5-backed `search`/`prompt`/`ask` with `--memory` fallback
- run logging in `zirp_runs` and `zirp_run_sources`

Still next:

1. Add embeddings / semantic search once the FTS5 ingestion shape feels right.
2. Add smarter source curation and exclusion management.
3. Consider regenerating `SOUL.md` and `STYLE.md` from indexed chunks.

This gives us one inspectable local brain without mixing source-of-truth sync data and generated oracle index data.
