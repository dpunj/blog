# divesh.gg

My personal blog, built with [Astro](https://astro.build) - a modern static site generator.

- [ ] Register divesh.gg domain

## 🚀 Features

- Fast, static site generation with Astro
- Markdown content management with frontmatter
- Responsive design with dark mode support
- Tag-based navigation for blog posts
- Organized content collections for different types of posts

## ⛴️ Project Structure

```text
├── public/              # Static assets (images, fonts, etc.)
├── src/
│   ├── components/      # Reusable UI components
│   ├── content/         # Content collections
│   │   ├── waves/       # Stream of consciousness posts
│   │   └── depths/      # In-depth, longer-form content
│   ├── layouts/         # Page layout templates
│   │   ├── BaseLayout.astro     # Main site layout
│   │   └── MarkdownPostLayout.astro  # Blog post layout
│   ├── pages/           # Page routes and templates
│   │   ├── index.astro  # Homepage
│   │   ├── waves/
│   │   │   └── [slug].astro  # Dynamic route for waves posts
│   │   └── depths/
│   │       └── [slug].astro  # Dynamic route for depths posts
│   ├── scripts/         # Client-side JavaScript
│   └── styles/          # Global CSS styles
│   └── content.config.ts # Content collection schema
└── package.json         # Project dependencies and scripts
```

## 📚 Layout Structure

This blog uses a two-level layout system:

1. **BaseLayout.astro** - Provides the foundational HTML structure, including:
   - HTML document structure
   - Head metadata
   - Header and footer components
   - Global styling

2. **MarkdownPostLayout.astro** - Specialized layout for blog posts that:
   - Builds upon BaseLayout
   - Handles Markdown frontmatter data
   - Formats post metadata (title, date, author, tags)
   - Provides post-specific styling

This nested layout approach follows Astro's best practices for creating maintainable, reusable templates.

## 📝 Content Collections

This blog uses Astro's Content Collections API to manage blog posts. These are organized into collections:

- `waves/` - Stream of consciousness posts on various topics
- `depths/` - More in-depth, longer-form content

Each post is a Markdown file with frontmatter that follows this schema:

```typescript
{
    title: string,
    description: string,
    author: string,
    pubDate: Date,
    tags: string[],
    image?: {
        url: string,
        alt: string
    }
}
```

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 🔄 Development Workflow

1. Create or edit Markdown files in the `src/content/` directory
2. Run `npm run dev` to preview changes locally
3. Commit changes to the repository
4. Deploy to your hosting platform of choice

## 📱 Deployment

[Add information about your deployment strategy here]
