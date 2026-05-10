#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const BLOG_ROOT = resolve(import.meta.dir, "..");
const NOTES_ROOT = process.env.NOTES_ROOT ?? "/Users/dpunj/notes";
const DEFAULT_MODEL = process.env.ZIRP_MODEL ?? "claude-haiku-4-5-20251001";

type CorpusTier =
	| "self"
	| "personal"
	| "operator"
	| "library"
	| "books"
	| "music";

type ZirpDoc = {
	id: string;
	title: string;
	text: string;
	sourcePath: string;
	tier: CorpusTier;
	kind: string;
	weight: number;
	metadata?: Record<string, string | number | undefined>;
};

type SearchHit = ZirpDoc & {
	score: number;
	snippet: string;
};

const TIER_WEIGHT: Record<CorpusTier, number> = {
	self: 1.3,
	personal: 1.15,
	operator: 1.05,
	library: 0.75,
	books: 0.7,
	music: 0.55,
};

const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"what",
	"when",
	"where",
	"why",
	"how",
	"into",
	"about",
	"would",
	"should",
	"could",
	"have",
	"has",
	"are",
	"was",
	"were",
	"you",
	"your",
	"our",
	"but",
	"not",
	"can",
	"all",
	"like",
	"just",
]);

function usage() {
	console.log(`divesh_zirp v0

Commands:
  bun zirp inventory [--include-journal]
  bun zirp search <query> [--limit 8] [--include-journal]
  bun zirp prompt <query> [--include-journal]
  bun zirp ask <query> [--include-journal]

Notes:
  - journal/ is excluded unless --include-journal is passed.
  - ask uses ANTHROPIC_API_KEY if present; otherwise it prints the prompt.`);
}

async function main() {
	const cli = parseCliArgs(process.argv.slice(2));
	const command = cli.positionals[0];

	if (!command || command === "help" || command === "--help") {
		usage();
		return;
	}

	const includeJournal = cli.flags.has("include-journal");
	const requestedLimit = Number(cli.values.get("limit") ?? 8);
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 8;
	const query = cli.positionals.slice(1).join(" ").trim();

	const docs = loadCorpus(includeJournal);

	if (command === "inventory") {
		printInventory(docs, includeJournal);
		return;
	}

	if (!query) {
		throw new Error(`Missing query for '${command}'`);
	}

	if (command === "search") {
		printHits(searchCorpus(query, docs, limit));
		return;
	}

	if (command === "prompt") {
		const prompt = buildPrompt(query, searchCorpus(query, docs, limit));
		console.log(formatPrompt(prompt.system, prompt.user));
		return;
	}

	if (command === "ask") {
		await ask(query, docs, limit);
		return;
	}

	throw new Error(`Unknown command '${command}'`);
}

function parseCliArgs(args: string[]) {
	const flags = new Set<string>();
	const values = new Map<string, string>();
	const positionals: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}

		const name = arg.slice(2);
		const next = args[index + 1];
		if (next && !next.startsWith("--")) {
			values.set(name, next);
			index += 1;
		} else {
			flags.add(name);
		}
	}

	return { flags, values, positionals };
}

function loadCorpus(includeJournal: boolean) {
	const docs: ZirpDoc[] = [];
	docs.push(...loadBlogDocs());
	docs.push(...loadPersonalDocs(includeJournal));
	docs.push(...loadOperatorDocs());
	docs.push(...loadKnowledgeDbDocs());
	docs.push(...loadGoodreadsDocs());
	docs.push(...loadSpotifyDocs());
	return docs.filter((doc) => doc.text.trim().length > 0);
}

function loadBlogDocs() {
	const docs: ZirpDoc[] = [];
	for (const folder of ["src/content/depths", "src/content/waves"]) {
		for (const path of walk(join(BLOG_ROOT, folder), 3)) {
			if (!isMarkdown(path) || basename(path).startsWith("_")) continue;
			if (path.toLowerCase().includes("backup")) continue;
			docs.push(markdownDoc(path, "self", "blog-post", BLOG_ROOT));
		}
	}

	const aboutPath = join(BLOG_ROOT, "src/pages/about.astro");
	if (existsSync(aboutPath)) {
		const raw = readFileSync(aboutPath, "utf8");
		docs.push({
			id: "blog:about",
			title: "About Divesh",
			text: stripMarkup(raw),
			sourcePath: relative(BLOG_ROOT, aboutPath),
			tier: "self",
			kind: "about-page",
			weight: TIER_WEIGHT.self,
		});
	}

	return docs;
}

function loadPersonalDocs(includeJournal: boolean) {
	const docs: ZirpDoc[] = [];
	if (!existsSync(NOTES_ROOT)) return docs;

	const personalRoots = ["personal", "resources", "projects", "local/docs"];

	for (const root of personalRoots) {
		const fullRoot = join(NOTES_ROOT, root);
		for (const path of walk(fullRoot, 3)) {
			if (isMarkdown(path))
				docs.push(markdownDoc(path, "personal", root, NOTES_ROOT));
		}
	}

	for (const path of walk(NOTES_ROOT, 1)) {
		if (!isMarkdown(path)) continue;
		const name = basename(path);
		if (["AGENTS.md", "README.md"].includes(name)) continue;
		docs.push(markdownDoc(path, "personal", "root-note", NOTES_ROOT));
	}

	if (includeJournal) {
		for (const path of walk(join(NOTES_ROOT, "journal"), 2)) {
			if (isMarkdown(path))
				docs.push(markdownDoc(path, "personal", "journal", NOTES_ROOT));
		}
	}

	return docs;
}

function loadOperatorDocs() {
	const docs: ZirpDoc[] = [];
	const roots = ["Versa/Strategy", "Versa/Sales & Ops", "Versa/Fundraising"];
	for (const root of roots) {
		const fullRoot = join(NOTES_ROOT, root);
		for (const path of walk(fullRoot, 3)) {
			if (isMarkdown(path))
				docs.push(markdownDoc(path, "operator", root, NOTES_ROOT));
		}
	}
	return docs;
}

function loadKnowledgeDbDocs() {
	const dbPath = join(BLOG_ROOT, "data/knowledge.db");
	if (!existsSync(dbPath)) return [];

	try {
		const db = new Database(`file:${dbPath}?mode=ro&immutable=1`, {
			readonly: true,
		});
		const rows = db
			.query(`
				SELECT id, type, title, author, description, tags, source, url, date_published
				FROM resources
				ORDER BY source_updated_at DESC
			`)
			.all() as Record<string, string | null>[];
		db.close();

		return rows.map((row) => {
			const title = row.title ?? "Untitled resource";
			const author = row.author ? ` by ${row.author}` : "";
			const text = [title, row.author, row.description, row.tags]
				.filter(Boolean)
				.join("\n");
			return {
				id: `library:${row.id}`,
				title: `${title}${author}`,
				text,
				sourcePath: row.url ?? `knowledge.db:${row.id}`,
				tier: "library" as const,
				kind: row.type ?? "resource",
				weight: TIER_WEIGHT.library,
				metadata: {
					source: row.source ?? undefined,
					date: row.date_published ?? undefined,
				},
			};
		});
	} catch (error) {
		console.warn(`Warning: could not read knowledge.db: ${String(error)}`);
		return [];
	}
}

function loadGoodreadsDocs() {
	const csvPath = join(BLOG_ROOT, "public/data/goodreads_library_export.csv");
	if (!existsSync(csvPath)) return [];

	const rows = parseCsv(readFileSync(csvPath, "utf8"));
	return rows.map((row, index) => {
		const title = row.Title || "Untitled book";
		const author = row.Author || row["Author l-f"] || "";
		const shelf = row["Exclusive Shelf"] || "";
		const rating = row["My Rating"] || "";
		const shelves = row.Bookshelves || "";
		return {
			id: `goodreads:${index}`,
			title: author ? `${title} by ${author}` : title,
			text: [title, author, shelf, rating && `rating ${rating}`, shelves]
				.filter(Boolean)
				.join("\n"),
			sourcePath: "public/data/goodreads_library_export.csv",
			tier: "books" as const,
			kind: shelf || "book",
			weight: TIER_WEIGHT.books + (rating === "5" ? 0.15 : 0),
			metadata: { rating, shelf },
		};
	});
}

function loadSpotifyDocs() {
	const jsonPath = join(BLOG_ROOT, "public/data/wtm.json");
	if (!existsSync(jsonPath)) return [];

	try {
		const data = JSON.parse(readFileSync(jsonPath, "utf8"));
		const tracks = Array.isArray(data) ? data : data.tracks;
		if (!Array.isArray(tracks)) return [];
		return tracks.map((track, index) => {
			const artists = Array.isArray(track.artists)
				? track.artists
						.map((artist: { name?: string }) => artist.name)
						.filter(Boolean)
						.join(", ")
				: "";
			const album = track.album?.name ?? "";
			const title = track.name ?? "Untitled track";
			return {
				id: `spotify:${track.id ?? index}`,
				title: artists ? `${title} by ${artists}` : title,
				text: [title, artists, album].filter(Boolean).join("\n"),
				sourcePath: "public/data/wtm.json",
				tier: "music" as const,
				kind: "track",
				weight: TIER_WEIGHT.music,
				metadata: { album },
			};
		});
	} catch (error) {
		console.warn(`Warning: could not read Spotify data: ${String(error)}`);
		return [];
	}
}

function markdownDoc(
	path: string,
	tier: CorpusTier,
	kind: string,
	root: string,
): ZirpDoc {
	const raw = readFileSync(path, "utf8");
	const parsed = parseMarkdown(raw);
	return {
		id: `${tier}:${relative(root, path)}`,
		title: parsed.title || titleFromPath(path),
		text: parsed.body,
		sourcePath: relative(root, path),
		tier,
		kind,
		weight: TIER_WEIGHT[tier],
	};
}

function parseMarkdown(raw: string) {
	const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/);
	const header = raw.match(/^#\s+(.+)$/m);
	const title =
		frontmatter?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ??
		header?.[1] ??
		"";
	const body = frontmatter ? raw.slice(frontmatter[0].length) : raw;
	return { title: title.trim(), body: stripMarkup(body) };
}

function stripMarkup(raw: string) {
	return raw
		.replace(/---[\s\S]*?---/g, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\[[^\]]+\]\([^)]+\)/g, (match) =>
			match.replace(/\]\([^)]+\)/, "").replace(/^\[/, ""),
		)
		.replace(/[`*_>#|{}]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function searchCorpus(
	query: string,
	docs: ZirpDoc[],
	limit: number,
): SearchHit[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return [];
	const phrase = query.toLowerCase();

	return docs
		.map((doc) => {
			const titleTokens = tokenize(doc.title);
			const textTokens = tokenize(doc.text);
			const score = scoreDoc(queryTokens, phrase, titleTokens, textTokens, doc);
			return { ...doc, score, snippet: makeSnippet(doc.text, queryTokens) };
		})
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

function scoreDoc(
	queryTokens: string[],
	phrase: string,
	titleTokens: string[],
	textTokens: string[],
	doc: ZirpDoc,
) {
	const textCounts = new Map<string, number>();
	for (const token of textTokens)
		textCounts.set(token, (textCounts.get(token) ?? 0) + 1);
	const titleSet = new Set(titleTokens);
	let uniqueMatches = 0;
	let repeatedMatches = 0;
	let titleMatches = 0;

	const uniqueQueryTokens = new Set(queryTokens);
	for (const token of uniqueQueryTokens) {
		const count = textCounts.get(token) ?? 0;
		if (count > 0) uniqueMatches += 1;
		repeatedMatches += Math.min(count, 8) * 0.18;
		if (titleSet.has(token)) titleMatches += 1;
	}

	if (uniqueMatches < Math.min(2, uniqueQueryTokens.size)) return 0;

	const haystack = `${doc.title}\n${doc.text}`.toLowerCase();
	const phraseBoost = phrase.length > 6 && haystack.includes(phrase) ? 3 : 0;
	const titleBoost = titleMatches * 1.5;
	return (
		(uniqueMatches + repeatedMatches + titleBoost + phraseBoost) * doc.weight
	);
}

function tokenize(input: string) {
	return (
		input
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.match(/[a-z0-9][a-z0-9-]{1,}/g)
			?.filter((token) => !STOPWORDS.has(token)) ?? []
	);
}

function makeSnippet(text: string, tokens: string[]) {
	const lower = text.toLowerCase();
	const index =
		tokens
			.map((token) => lower.indexOf(token))
			.filter((value) => value >= 0)
			.sort((a, b) => a - b)[0] ?? 0;
	const start = Math.max(0, index - 180);
	const snippet = text
		.slice(start, start + 520)
		.replace(/\s+/g, " ")
		.trim();
	return start > 0 ? `…${snippet}` : snippet;
}

function buildPrompt(query: string, hits: SearchHit[]) {
	const system = [
		"You are divesh_zirp, a private retrieval-grounded oracle for Divesh.",
		"Answer from the provided corpus context and persona docs. Be warm, direct, playful, and honest about uncertainty.",
		"Do not claim access to private facts that are not in the sources. Cite source labels inline when useful.",
		readPersona("SOUL.md"),
		readPersona("LEXICON.md"),
		readPersona("STYLE.md"),
	].join("\n\n");

	const context = hits
		.map((hit, index) => {
			const excerpt = trimChars(hit.snippet || hit.text, 1200);
			return `[${index + 1}] ${hit.title}\nsource: ${hit.sourcePath}\ntier: ${hit.tier}/${hit.kind}\nexcerpt: ${excerpt}`;
		})
		.join("\n\n");

	const user = `Question: ${query}\n\nRetrieved sources:\n${context}\n\nAnswer with a concise synthesis first, then cite the strongest sources.`;
	return { system, user };
}

function readPersona(file: string) {
	const path = join(BLOG_ROOT, "docs/zirp", file);
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

async function ask(query: string, docs: ZirpDoc[], limit: number) {
	const hits = searchCorpus(query, docs, limit);
	const prompt = buildPrompt(query, hits);
	const apiKey = process.env.ANTHROPIC_API_KEY;

	if (!apiKey) {
		console.log("ANTHROPIC_API_KEY not found. Printing prompt instead.\n");
		console.log(formatPrompt(prompt.system, prompt.user));
		return;
	}

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify({
			model: DEFAULT_MODEL,
			max_tokens: 900,
			system: prompt.system,
			messages: [{ role: "user", content: prompt.user }],
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Anthropic request failed: ${response.status} ${body}`);
	}

	const body = (await response.json()) as { content?: { text?: string }[] };
	console.log(
		body.content
			?.map((part) => part.text)
			.filter(Boolean)
			.join("\n") ?? "",
	);
	console.log("\nSources:");
	for (const [index, hit] of hits.entries()) {
		console.log(`${index + 1}. ${hit.title} — ${hit.sourcePath}`);
	}
}

function formatPrompt(system: string, user: string) {
	return `# SYSTEM\n\n${system}\n\n# USER\n\n${user}`;
}

function printHits(hits: SearchHit[]) {
	for (const [index, hit] of hits.entries()) {
		console.log(`${index + 1}. ${hit.title}`);
		console.log(
			`   score=${hit.score.toFixed(2)} tier=${hit.tier}/${hit.kind}`,
		);
		console.log(`   source=${hit.sourcePath}`);
		console.log(`   ${hit.snippet}\n`);
	}
}

function printInventory(docs: ZirpDoc[], includeJournal: boolean) {
	console.log(`divesh_zirp corpus: ${docs.length.toLocaleString()} docs`);
	console.log(`notes root: ${NOTES_ROOT}`);
	console.log(`journal included: ${includeJournal ? "yes" : "no"}\n`);
	const groups = new Map<string, number>();
	for (const doc of docs) {
		const key = `${doc.tier}/${doc.kind}`;
		groups.set(key, (groups.get(key) ?? 0) + 1);
	}
	for (const [key, count] of [...groups.entries()].sort(
		(a, b) => b[1] - a[1],
	)) {
		console.log(`${key.padEnd(28)} ${count}`);
	}
}

function walk(root: string, maxDepth: number) {
	const files: string[] = [];
	if (!existsSync(root)) return files;
	visit(root, 0, files, maxDepth);
	return files;
}

function visit(path: string, depth: number, files: string[], maxDepth: number) {
	if (depth > maxDepth) return;
	const stat = statSync(path);
	if (stat.isFile()) {
		files.push(path);
		return;
	}
	if (!stat.isDirectory()) return;
	for (const entry of readdirSync(path)) {
		if (
			entry.startsWith(".") ||
			["node_modules", "dist", "Archive", "Legal", "Data"].includes(entry)
		)
			continue;
		visit(join(path, entry), depth + 1, files, maxDepth);
	}
}

function parseCsv(input: string) {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		const next = input[index + 1];
		if (char === '"' && inQuotes && next === '"') {
			field += '"';
			index += 1;
		} else if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === "," && !inQuotes) {
			row.push(field);
			field = "";
		} else if ((char === "\n" || char === "\r") && !inQuotes) {
			if (char === "\r" && next === "\n") index += 1;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += char;
		}
	}

	if (field || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const [headers = [], ...body] = rows;
	return body.map((values) =>
		Object.fromEntries(
			headers.map((header, index) => [header, values[index] ?? ""]),
		),
	);
}

function isMarkdown(path: string) {
	return extname(path).toLowerCase() === ".md";
}

function titleFromPath(path: string) {
	return basename(path, extname(path)).replace(/[-_]/g, " ");
}

function trimChars(text: string, limit: number) {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
