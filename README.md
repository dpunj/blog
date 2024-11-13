# divesh.gg

My personal blog, built with Astro.
- [ ] Register divesh.gg domain

## ⛴️ Project structure

```text
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

- `src/pages/` looks for `.astro` or `.md` files, with each page being exposed as a route
- `src/components/` is where we like to put any Astro/React/Vue/Svelte/Preact components
- Any static assets, like images, can be placed in the `public/` directory

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
