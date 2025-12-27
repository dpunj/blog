// 1. Import utilities from `astro:content`
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// define general schema with zod validation
const blogSchema = z.object({
	title: z.string(),
	image: z.string().optional(),
	pubDate: z.coerce.date(),
	tags: z.array(z.string()),
});

// define collections with shared schema
const waves = defineCollection({
	loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/waves" }),
	schema: blogSchema,
});

const depths = defineCollection({
	loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/depths" }),
	schema: blogSchema,
});

// export single collections object
export const collections = { waves, depths };
