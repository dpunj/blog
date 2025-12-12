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

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

| Command | Action |
| :-- | :-- |
| `bun lint` | Check for linting issues |
| `bun lint:fix` | Fix linting issues |
| `bun format` | Format all files |

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
```

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
