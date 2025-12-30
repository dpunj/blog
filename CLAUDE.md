# CLAUDE.md

Project context and instructions for AI assistants working on this codebase.

## Project Overview

Personal blog for divesh.gg built with Astro, Preact, and Tailwind CSS v4. This is a content-focused site with two types of posts: "waves" (short posts) and "depths" (long-form content).

## Tech Stack

- **Framework**: Astro 4.x with Preact integration
- **Styling**: Tailwind CSS v4 (via @tailwindcss/vite)
- **Content**: Markdown with frontmatter, managed via Astro Content Collections
- **Type Safety**: TypeScript with Zod schema validation
- **Tooling**: Biome for linting and formatting
- **Package Manager**: Bun (preferred) or npm

## Project Structure

```
src/
├── components/
│   ├── library/     # Library explorer components (Preact)
│   └── ...          # Other UI components (.astro, .jsx, .tsx)
├── content/
│   ├── waves/       # Short-form posts (markdown)
│   └── depths/      # Long-form posts (markdown)
├── content.config.ts # Content collections schema
├── data/
│   └── tag-hierarchy.json  # Library tag organization
├── layouts/         # Page layout templates
├── pages/           # File-based routing
├── scripts/         # Utility functions (library.ts, music.ts, etc.)
└── styles/          # Global CSS
scripts/
├── db.ts            # SQLite schema and CRUD helpers (bun:sqlite)
└── sync.ts          # Unified CLI for syncing all data sources
data/
└── knowledge.db     # SQLite database (source of truth)
public/data/
└── library.json     # Exported from SQLite for Astro build
```

## Development Workflow

### Commands
- `bun dev` - Start dev server (localhost:4321)
- `bun build` - Production build to ./dist/
- `bun preview` - Preview production build
- `bun lint` - Check for issues
- `bun lint:fix` - Auto-fix linting issues
- `bun format` - Format all files
- `bun sync local` - Sync local sources (books, music) - fast
- `bun sync api` - Sync API sources (Readwise, Zotero) - slow, rate limited
- `bun sync --export-library` - Export library from SQLite to JSON for Astro

### Package Manager
- **Prefer Bun** for all package operations
- Fallback to npm if needed

## Code Style & Standards

### Formatting (Biome)
- **Indentation**: Tabs (not spaces)
- **Quotes**: Double quotes for JavaScript/TypeScript
- **CSS**: Tailwind directives enabled
- **Astro files**: Formatting and linting disabled (handled by Astro)

### File Conventions
- Components: PascalCase (e.g., `BlogPost.astro`, `Header.astro`)
- Use `.astro` for server components
- Use `.jsx`/`.tsx` for Preact interactive components
- Content files: kebab-case markdown (e.g., `how-videogames-shaped-me.md`)

## Content Management

### Blog Post Schema
All posts require frontmatter:

```yaml
---
title: string           # Required
author: string          # Required
description: string     # Required (for SEO/previews)
pubDate: Date          # Required (YYYY-MM-DD format)
tags: string[]         # Required
image?: string         # Optional image URL
---
```

### Content Types
- **waves/**: Short posts, updates, quick thoughts
- **depths/**: Long-form articles, essays, deep dives

### Adding Content
1. Create markdown file in `src/content/waves/` or `src/content/depths/`
2. Add required frontmatter
3. Schema validation enforced via `content.config.ts`

## Key Integrations

### Tailwind CSS v4
- Uses new Vite plugin (`@tailwindcss/vite`)
- Configuration via CSS (not tailwind.config.js)

### Preact
- For interactive components requiring client-side JS
- Lighter alternative to React
- Use `client:*` directives in Astro for hydration

### Library (Digital Garden)
A browsable archive of bookmarks (Readwise) and papers (Zotero) with hierarchical tag navigation.

**Data Flow:**
```
Readwise/Zotero APIs → sync.ts → SQLite → --export-library → library.json → /library page
```

**Key Files:**
- `scripts/sync.ts` - Unified sync CLI with API fetchers and rate limiting
- `scripts/db.ts` - SQLite schema and CRUD helpers
- `src/scripts/library.ts` - Types, tag hierarchy builder, filters, sorting
- `src/data/tag-hierarchy.json` - Manual tag → hierarchy mapping (edit this!)
- `src/components/library/` - Preact components (LibraryExplorer, TagTree, ResourceList, etc.)
- `public/data/library.json` - Exported for Astro (regenerate with `bun sync --export-library`)

**Environment Variables** (`.env`):
```
READWISE_TOKEN=xxx
ZOTERO_API_KEY=xxx
ZOTERO_USER_ID=xxx
```

**Updating the Library:**
1. Run `bun sync api` to fetch latest from Readwise + Zotero (slow, rate limited)
2. Run `bun sync --export-library` to regenerate JSON for Astro
3. Edit `src/data/tag-hierarchy.json` to organize new tags
4. Uncategorized tags appear at the bottom of the tag tree

## Important Notes

- **SEO Component**: Uses TypeScript (.tsx) - maintain type safety
- **Navigation**: Check `Navigation.astro` for site structure
- **Git**: Main branch is `main`
- **Images**: Currently using placeholder images, update as needed
- **Domain**: divesh.gg (not yet registered - noted in README)

## Common Tasks

### Adding a New Post
1. Create `.md` file in appropriate content directory
2. Add complete frontmatter with all required fields
3. Content automatically appears via content collections

### Adding a New Component
1. Create in `src/components/`
2. Use `.astro` for static/server-rendered
3. Use `.jsx`/`.tsx` for client-side interactive components
4. Import and use in pages or layouts

### Styling Changes
- Prefer Tailwind utility classes
- Global styles in `src/styles/`
- Component-scoped styles in `<style>` blocks

## Testing & Quality

- Run `bun lint` before committing
- Use `bun lint:fix` and `bun format` to auto-fix issues
- Check build with `bun build` to catch type errors
- Preview builds locally with `bun preview`

## Knowledge Base (SQLite)

A local SQLite database (`data/knowledge.db`) is the single source of truth for all resources.

### Architecture

```
Local files (CSV, JSON) ──┐
                          ├──▶ sync.ts ──▶ SQLite ──▶ --export-library ──▶ JSON ──▶ Astro
API sources (Readwise, Zotero) ──┘
```

### Sync Commands

```bash
# Granular sync
bun sync books        # Goodreads CSV → SQLite
bun sync music        # Spotify JSON → SQLite
bun sync readwise     # Readwise API → SQLite (slow)
bun sync zotero       # Zotero API → SQLite (slow)

# Grouped sync
bun sync local        # books + music (fast, no API calls)
bun sync api          # readwise + zotero (slow, rate limited)
bun sync all          # everything

# Export & stats
bun sync --export-library   # SQLite → public/data/library.json
bun sync --stats            # Show database stats
bun sync --export TYPE      # Export to stdout (book|track|article|paper|all)
```

### Data Sources

| Source | Input | Type | Command |
|--------|-------|------|---------|
| Goodreads | `public/data/goodreads_library_export.csv` | books | `bun sync books` |
| Spotify | `public/data/wtm.json` | tracks | `bun sync music` |
| Readwise | API (requires `READWISE_TOKEN`) | articles, bookmarks | `bun sync readwise` |
| Zotero | API (requires `ZOTERO_API_KEY`, `ZOTERO_USER_ID`) | papers | `bun sync zotero` |

### API Sync Details

The `bun sync api` command fetches from Readwise and Zotero APIs with built-in rate limiting:

| API | Rate Limit | Delay Between Requests |
|-----|------------|------------------------|
| Readwise | 20 req/min | 3.5 seconds |
| Zotero | 1 req/sec | 1.1 seconds |

**Features:**
- **Pagination** — automatically fetches all pages
- **Retry on 429** — respects `Retry-After` header, up to 3 retries
- **Upsert** — existing resources updated, new ones inserted (no duplicates)

**Typical runtime:** 2-5 minutes depending on library size.

## Don't

- Don't add `tailwind.config.js` (uses Tailwind v4 CSS-based config)
- Don't format .astro files with Biome (disabled in config)
- Don't use spaces for indentation (tabs only)
- Don't skip frontmatter validation in content files
- Don't create content files starting with `_` (ignored by glob pattern)
