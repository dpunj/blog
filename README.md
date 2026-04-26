# divesh.gg

Personal blog built with [Astro](https://astro.build).

- [ ] Register divesh.gg domain

## Commands

| Command | Action |
| :-- | :-- |
| `bun install` | Install dependencies |
| `bun dev` | Start dev server at `localhost:4321` |
| `bun build` | Build production site to `./dist/` |
| `bun preview` | Preview build locally |
| `bun sync api --export-library` | Sync Readwise/Zotero/etc. and export `/library` data |
| `bun sync --stats` | Show local knowledge DB stats |

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

| Command | Action |
| :-- | :-- |
| `bun check` | Type check (Astro/TypeScript) |
| `bun check:all` | Type check + lint + format check |
| `bun lint` | Check for linting issues |
| `bun lint:fix` | Fix linting issues |
| `bun format` | Format all files |

Run Biome directly on specific files with `bunx biome check <file>`.

## Project Structure

```
src/
├── components/      # UI components
├── content/
│   ├── waves/       # Short posts
│   └── depths/      # Long-form content
├── layouts/         # Page templates
├── pages/           # Routes
├── scripts/         # Client-side JS
└── styles/          # Global CSS
scripts/
├── db.ts            # SQLite knowledge base helpers
└── sync.ts          # Sync/export CLI
public/
└── data/            # Generated/static data files
```

## Features

### Books (`/books`)
Interactive library explorer powered by Goodreads CSV export. Filter by shelf, decade, or recommender. Sort by various fields. Export selections as JSON or text.

### Music (`/music`)
Music explorer for Spotify listening data.

### Library (`/library`)
Digital garden for Readwise and Zotero resources. Data flows through local SQLite, then exports to `public/data/library.json` for Astro.

```bash
bun sync api --export-library  # normal incremental sync + export
bun sync readwise --full       # force full Readwise backfill
bun sync zotero --full         # force full Zotero refresh
bun sync readwise --since 2026-04-01T00:00:00Z
bun sync --stats
```

Required `.env` values:

```env
READWISE_TOKEN=...
ZOTERO_API_KEY=...
ZOTERO_USER_ID=...
```

Notes:
- First Readwise sync can take several minutes for large libraries.
- Later Readwise/Zotero runs are incremental via saved `sync_state` in `data/knowledge.db`.
- `data/` and generated JSON exports are ignored; regenerate them locally.

## Content

Posts are Markdown files in `src/content/` with frontmatter:

```yaml
---
title: string
description: string
author: string
pubDate: Date
tags: string[]
image?: { url: string, alt: string }
---
```
