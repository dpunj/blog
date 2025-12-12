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
├── components/      # UI components (.astro, .jsx, .tsx)
├── content/
│   ├── waves/       # Short-form posts (markdown)
│   └── depths/      # Long-form posts (markdown)
├── content.config.ts # Content collections schema
├── layouts/         # Page layout templates
├── pages/           # File-based routing
├── scripts/         # Client-side JavaScript
└── styles/          # Global CSS
```

## Development Workflow

### Commands
- `bun dev` - Start dev server (localhost:4321)
- `bun build` - Production build to ./dist/
- `bun preview` - Preview production build
- `bun lint` - Check for issues
- `bun lint:fix` - Auto-fix linting issues
- `bun format` - Format all files

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

## Don't

- Don't add `tailwind.config.js` (uses Tailwind v4 CSS-based config)
- Don't format .astro files with Biome (disabled in config)
- Don't use spaces for indentation (tabs only)
- Don't skip frontmatter validation in content files
- Don't create content files starting with `_` (ignored by glob pattern)
