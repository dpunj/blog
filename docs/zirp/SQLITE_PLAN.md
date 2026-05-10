# SQLite plan for divesh_zirp

Yes: `divesh_zirp` should get its own SQLite store.

The existing `data/knowledge.db` is already the source of truth for synced library resources. The ZIRP layer should not mutate that directly. Instead, it should maintain a separate derived index optimized for retrieval, provenance, prompts, and future embeddings.

## Why SQLite

SQLite fits the project because it is:

- local-first and private;
- already part of the blog tooling via Bun;
- easy to inspect with `sqlite3`;
- good enough for tens/hundreds of thousands of chunks;
- compatible with FTS5 for lexical search;
- upgradeable to vector search via `sqlite-vec` or external embedding tables.

## Proposed file

```txt
data/zirp.db
```

`data/` is already gitignored/generated-local territory, so the index can be rebuilt at any time.

## Schema sketch

### sources

One row per source artifact: a blog post, note, Readwise item, Goodreads row, Spotify track, etc.

```sql
CREATE TABLE zirp_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,      -- blog | note | versa | readwise | zotero | goodreads | spotify
  tier TEXT NOT NULL,             -- self | personal | operator | library | books | music
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  url TEXT,
  author TEXT,
  source_hash TEXT NOT NULL,
  metadata_json TEXT,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### chunks

One row per searchable chunk. Even metadata-only records get a single chunk.

```sql
CREATE TABLE zirp_chunks (
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

### lexical index

Use SQLite FTS5 for fast local search.

```sql
CREATE VIRTUAL TABLE zirp_chunks_fts USING fts5(
  title,
  text,
  source_id UNINDEXED,
  chunk_id UNINDEXED,
  tier UNINDEXED,
  tokenize = 'porter unicode61'
);
```

### embeddings

Add later once the chunk pipeline is stable.

```sql
CREATE TABLE zirp_embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES zirp_chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  embedded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

If using `sqlite-vec`, this would become a virtual vector table instead of a plain BLOB table.

### prompt runs

Store what was asked, what was retrieved, and what was answered.

```sql
CREATE TABLE zirp_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,             -- search | prompt | ask
  model TEXT,
  response_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE zirp_run_sources (
  run_id TEXT NOT NULL REFERENCES zirp_runs(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES zirp_chunks(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (run_id, chunk_id)
);
```

## Commands to add

```bash
bun zirp init-db
bun zirp index
bun zirp index --include-journal
bun zirp stats
bun zirp search "games as training grounds"
bun zirp ask "what should I write next?"
```

## Retrieval pipeline v1

1. Crawl local corpus into `zirp_sources`.
2. Hash source content and skip unchanged records.
3. Chunk source text into 512-token windows with overlap for long docs.
4. Upsert chunks into `zirp_chunks` and `zirp_chunks_fts`.
5. Search FTS5 first.
6. Re-rank with tier weights and title/path boosts.
7. Later: blend FTS5 with vector similarity.
8. Store each run and retrieved sources for debugging.

## Chunking policy

| Source | Policy |
| --- | --- |
| Blog posts | Chunk body; preserve title/frontmatter metadata. |
| Notes | Chunk by headings first, then length. |
| Readwise/Zotero metadata | One chunk per resource until full text is available. |
| Goodreads | One chunk per book row. |
| Spotify | One chunk per track or artist aggregate in a later pass. |
| Persona docs | Store as system docs, not normal retrieval docs. |

## Privacy policy

- Default index excludes `journal/`.
- Keep a `zirp_exclusions` table or config file for sensitive paths.
- Store source hashes, not full raw legal/data archive content.
- Treat `data/zirp.db` as local-only and gitignored.

## Open questions

- Should we use `sqlite-vec`, LanceDB, or plain embedding BLOBs first?
- Should Spotify be indexed track-by-track or summarized by artist/album clusters?
- Should Readwise highlights/full text be pulled into the ZIRP DB, or should the existing `knowledge.db` remain metadata-only?
- Should `SOUL.md` and `STYLE.md` be regenerated from stored chunks on demand?

## Recommendation

Build SQLite v1 in two steps:

1. **FTS5-only index**: source/chunk tables, hashing, indexing, search, run logging.
2. **Semantic layer**: embeddings once the ingestion/indexing shape feels right.

That gives us an inspectable local brain before adding vector magic.
