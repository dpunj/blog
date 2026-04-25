// 1. Import utilities from Astro
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// define general schema with zod validation
const blogSchema = z.object({
	title: z.string(),
	image: z.string().optional(),
	pubDate: z.coerce.date(),
	tags: z.array(z.string()),
});

// define collections with shared schema
const contentPattern = ["**/[^_]*.md", "!**/*backup*.md", "!**/*Backup*.md"];

const waves = defineCollection({
	loader: glob({ pattern: contentPattern, base: "./src/content/waves" }),
	schema: blogSchema,
});

const depths = defineCollection({
	loader: glob({ pattern: contentPattern, base: "./src/content/depths" }),
	schema: blogSchema,
});

// export single collections object
export const collections = { waves, depths };
