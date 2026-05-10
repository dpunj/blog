#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const BLOG_ROOT = resolve(import.meta.dir, "..");
const NOTES_ROOT = process.env.NOTES_ROOT ?? "/Users/dpunj/notes";
const KNOWLEDGE_DB_PATH = join(BLOG_ROOT, "data/knowledge.db");
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_REASONING_EFFORT = "low";

type ZirpProvider = "openai" | "anthropic";

type ModelConfig = {
	provider: ZirpProvider;
	model: string;
	reasoningEffort: "minimal" | "low" | "medium" | "high";
};

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
  bun zirp init-db
  bun zirp index [--include-journal]
  bun zirp stats
  bun zirp search <query> [--limit 8] [--include-journal] [--memory]
  bun zirp prompt <query> [--include-journal] [--memory]
  bun zirp ask <query> [--include-journal] [--memory] [--provider openai|anthropic] [--model gpt-5.5] [--reasoning-effort low]

Notes:
  - journal/ is excluded unless --include-journal is passed.
  - search/prompt/ask prefer the SQLite index when available; use --memory to force v0 in-memory search.
  - ask defaults to OpenAI GPT-5.5 with reasoning effort low when OPENAI_API_KEY is present.
  - set ZIRP_PROVIDER/ZIRP_MODEL/ZIRP_REASONING_EFFORT or pass flags to override.
  - if no configured API key is found, ask prints the prompt.`);
}

async function main() {
	const cli = parseCliArgs(process.argv.slice(2));
	const command = cli.positionals[0];

	if (!command || command === "help" || command === "--help") {
		usage();
		return;
	}

	const includeJournal = cli.flags.has("include-journal");
	const forceMemory = cli.flags.has("memory");
	const modelConfig = getModelConfig(cli);
	const requestedLimit = Number(cli.values.get("limit") ?? 8);
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 8;
	const query = cli.positionals.slice(1).join(" ").trim();

	if (command === "init-db") {
		initZirpDb();
		console.log(
			`Initialized zirp_* tables in ${relative(BLOG_ROOT, KNOWLEDGE_DB_PATH)}`,
		);
		return;
	}

	if (command === "index") {
		const docs = loadCorpus(includeJournal);
		indexCorpus(docs, includeJournal);
		return;
	}

	if (command === "stats") {
		printZirpStats();
		return;
	}

	if (command === "inventory") {
		const docs = loadCorpus(includeJournal);
		printInventory(docs, includeJournal);
		return;
	}

	if (!query) {
		throw new Error(`Missing query for '${command}'`);
	}

	const hits = search(query, limit, includeJournal, forceMemory);

	if (command === "search") {
		recordZirpRun("search", query, hits);
		printHits(hits);
		return;
	}

	if (command === "prompt") {
		const prompt = buildPrompt(query, hits);
		recordZirpRun("prompt", query, hits);
		console.log(formatPrompt(prompt.system, prompt.user));
		return;
	}

	if (command === "ask") {
		const responseText = await ask(query, hits, modelConfig);
		recordZirpRun(
			"ask",
			query,
			hits,
			responseText,
			formatModelLabel(modelConfig),
		);
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

function getModelConfig(cli: ReturnType<typeof parseCliArgs>): ModelConfig {
	const provider = normalizeProvider(
		cli.values.get("provider") ?? process.env.ZIRP_PROVIDER,
	);
	const model = normalizeModelName(
		cli.values.get("model") ??
			process.env.ZIRP_MODEL ??
			(provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL),
	);
	const reasoningEffort = normalizeReasoningEffort(
		cli.values.get("reasoning-effort") ??
			process.env.ZIRP_REASONING_EFFORT ??
			DEFAULT_REASONING_EFFORT,
	);
	return { provider, model, reasoningEffort };
}

function normalizeProvider(value?: string): ZirpProvider {
	if (value === "anthropic") return "anthropic";
	if (value === "openai") return "openai";
	return process.env.OPENAI_API_KEY ? "openai" : "anthropic";
}

function normalizeModelName(model: string) {
	if (["5.5", "gpt55", "gpt-55"].includes(model.toLowerCase())) {
		return "gpt-5.5";
	}
	return model;
}

function normalizeReasoningEffort(
	value: string,
): ModelConfig["reasoningEffort"] {
	if (["minimal", "low", "medium", "high"].includes(value)) {
		return value as ModelConfig["reasoningEffort"];
	}
	return DEFAULT_REASONING_EFFORT;
}

function formatModelLabel(config: ModelConfig) {
	return config.provider === "openai"
		? `${config.provider}:${config.model}:reasoning=${config.reasoningEffort}`
		: `${config.provider}:${config.model}`;
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

function search(
	query: string,
	limit: number,
	includeJournal: boolean,
	forceMemory: boolean,
) {
	if (!forceMemory && hasZirpIndex()) {
		const indexedHits = searchIndexedCorpus(query, limit);
		if (indexedHits.length > 0) return indexedHits;
	}

	return searchCorpus(query, loadCorpus(includeJournal), limit);
}

function initZirpDb() {
	const db = openKnowledgeDb();
	db.run("PRAGMA foreign_keys = ON");
	runSqlScript(
		db,
		`
		CREATE TABLE IF NOT EXISTS zirp_sources (
			id TEXT PRIMARY KEY,
			source_type TEXT NOT NULL,
			tier TEXT NOT NULL,
			title TEXT NOT NULL,
			source_path TEXT NOT NULL,
			url TEXT,
			author TEXT,
			source_hash TEXT NOT NULL,
			upstream_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
			metadata_json TEXT,
			indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS zirp_chunks (
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

		CREATE VIRTUAL TABLE IF NOT EXISTS zirp_chunks_fts USING fts5(
			title,
			text,
			source_id UNINDEXED,
			chunk_id UNINDEXED,
			tier UNINDEXED,
			tokenize = 'porter unicode61'
		);

		CREATE TABLE IF NOT EXISTS zirp_embeddings (
			chunk_id TEXT PRIMARY KEY REFERENCES zirp_chunks(id) ON DELETE CASCADE,
			model TEXT NOT NULL,
			dimensions INTEGER NOT NULL,
			embedding BLOB NOT NULL,
			embedded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS zirp_runs (
			id TEXT PRIMARY KEY,
			query TEXT NOT NULL,
			mode TEXT NOT NULL,
			model TEXT,
			response_text TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS zirp_run_sources (
			run_id TEXT NOT NULL REFERENCES zirp_runs(id) ON DELETE CASCADE,
			chunk_id TEXT NOT NULL REFERENCES zirp_chunks(id) ON DELETE CASCADE,
			rank INTEGER NOT NULL,
			score REAL NOT NULL,
			PRIMARY KEY (run_id, chunk_id)
		);

		CREATE TABLE IF NOT EXISTS zirp_exclusions (
			path_glob TEXT PRIMARY KEY,
			reason TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_zirp_sources_tier ON zirp_sources(tier);
		CREATE INDEX IF NOT EXISTS idx_zirp_sources_type ON zirp_sources(source_type);
		CREATE INDEX IF NOT EXISTS idx_zirp_chunks_source ON zirp_chunks(source_id);
	`,
	);
	db.close();
}

function indexCorpus(docs: ZirpDoc[], includeJournal: boolean) {
	initZirpDb();
	const db = openKnowledgeDb();
	db.run("PRAGMA foreign_keys = ON");

	const insertSource = db.prepare(`
		INSERT INTO zirp_sources (
			id, source_type, tier, title, source_path, url, author, source_hash,
			upstream_resource_id, metadata_json, indexed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`);
	const insertChunk = db.prepare(`
		INSERT INTO zirp_chunks (
			id, source_id, chunk_index, text, token_count, weight, metadata_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`);
	const insertFts = db.prepare(`
		INSERT INTO zirp_chunks_fts (title, text, source_id, chunk_id, tier)
		VALUES (?, ?, ?, ?, ?)
	`);

	const rebuild = db.transaction((records: ZirpDoc[]) => {
		db.run("DELETE FROM zirp_run_sources");
		db.run("DELETE FROM zirp_embeddings");
		db.run("DELETE FROM zirp_chunks_fts");
		db.run("DELETE FROM zirp_chunks");
		db.run("DELETE FROM zirp_sources");

		let chunkCount = 0;
		for (const doc of records) {
			const sourceType = inferSourceType(doc);
			const upstreamResourceId = doc.id.startsWith("library:")
				? doc.id.slice("library:".length)
				: null;
			insertSource.run(
				doc.id,
				sourceType,
				doc.tier,
				doc.title,
				doc.sourcePath,
				doc.sourcePath.startsWith("http") ? doc.sourcePath : null,
				doc.metadata?.author ?? null,
				hashDoc(doc),
				upstreamResourceId,
				JSON.stringify({ kind: doc.kind, weight: doc.weight, ...doc.metadata }),
			);

			const chunks = chunkText(doc.text);
			for (const [chunkIndex, chunk] of chunks.entries()) {
				const chunkId = `${doc.id}#${chunkIndex}`;
				insertChunk.run(
					chunkId,
					doc.id,
					chunkIndex,
					chunk,
					tokenize(chunk).length,
					doc.weight,
					JSON.stringify({ kind: doc.kind }),
				);
				insertFts.run(doc.title, chunk, doc.id, chunkId, doc.tier);
				chunkCount += 1;
			}
		}
		return chunkCount;
	});

	const chunkCount = rebuild(docs);
	db.run("PRAGMA wal_checkpoint(FULL)");
	db.close();
	console.log(
		`Indexed ${docs.length.toLocaleString()} sources into ${chunkCount.toLocaleString()} chunks.`,
	);
	console.log(`journal included: ${includeJournal ? "yes" : "no"}`);
}

function hasZirpIndex() {
	if (!existsSync(KNOWLEDGE_DB_PATH)) return false;
	try {
		const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
			readonly: true,
		});
		const row = db
			.query(
				"SELECT count(*) AS count FROM sqlite_master WHERE name = 'zirp_chunks'",
			)
			.get() as { count: number };
		if (row.count === 0) {
			db.close();
			return false;
		}
		const chunks = db
			.query("SELECT count(*) AS count FROM zirp_chunks")
			.get() as { count: number };
		db.close();
		return chunks.count > 0;
	} catch {
		return false;
	}
}

function searchIndexedCorpus(query: string, limit: number): SearchHit[] {
	const ftsQuery = buildFtsQuery(query);
	if (!ftsQuery) return [];

	const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
		readonly: true,
	});
	try {
		const rows = db
			.query(`
				SELECT
					c.id AS chunk_id,
					c.text AS text,
					c.weight AS weight,
					s.id AS source_id,
					s.title AS title,
					s.source_path AS source_path,
					s.tier AS tier,
					s.source_type AS source_type,
					bm25(zirp_chunks_fts) AS rank
				FROM zirp_chunks_fts
				JOIN zirp_chunks c ON c.id = zirp_chunks_fts.chunk_id
				JOIN zirp_sources s ON s.id = c.source_id
				WHERE zirp_chunks_fts MATCH ?
				ORDER BY rank
				LIMIT ?
			`)
			.all(ftsQuery, Math.max(limit * 100, 500)) as Record<
			string,
			string | number | null
		>[];

		const queryTokens = tokenize(query);
		const hits = rows
			.map((row) => {
				const doc = {
					id: String(row.source_id),
					title: String(row.title),
					text: String(row.text),
					sourcePath: String(row.source_path),
					tier: row.tier as CorpusTier,
					kind: String(row.source_type),
					weight: Number(row.weight),
					metadata: { chunkId: String(row.chunk_id) },
				};
				const lexicalScore = scoreDoc(
					queryTokens,
					query.toLowerCase(),
					tokenize(doc.title),
					tokenize(doc.text),
					doc,
				);
				const rankBoost = 1 / (1 + Math.abs(Number(row.rank)));
				return {
					...doc,
					score: lexicalScore + rankBoost,
					snippet: makeSnippet(doc.text, queryTokens),
				};
			})
			.filter((hit) => hit.score > 0)
			.sort((a, b) => b.score - a.score);
		return dedupeHitsBySource(hits).slice(0, limit);
	} finally {
		db.close();
	}
}

function dedupeHitsBySource(hits: SearchHit[]) {
	const seen = new Set<string>();
	const deduped: SearchHit[] = [];
	for (const hit of hits) {
		if (seen.has(hit.id)) continue;
		seen.add(hit.id);
		deduped.push(hit);
	}
	return deduped;
}

function recordZirpRun(
	mode: "search" | "prompt" | "ask",
	query: string,
	hits: SearchHit[],
	responseText?: string,
	model?: string,
) {
	if (!hasZirpTables()) return;

	const indexedHits = hits.filter((hit) => hit.metadata?.chunkId);
	const db = openKnowledgeDb();
	const insertRun = db.prepare(`
		INSERT INTO zirp_runs (id, query, mode, model, response_text, created_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`);
	const insertRunSource = db.prepare(`
		INSERT INTO zirp_run_sources (run_id, chunk_id, rank, score)
		VALUES (?, ?, ?, ?)
	`);

	const write = db.transaction(() => {
		const runId = randomUUID();
		insertRun.run(runId, query, mode, model ?? null, responseText ?? null);
		for (const [index, hit] of indexedHits.entries()) {
			insertRunSource.run(
				runId,
				String(hit.metadata?.chunkId),
				index + 1,
				hit.score,
			);
		}
	});

	write();
	db.close();
}

function printZirpStats() {
	if (!existsSync(KNOWLEDGE_DB_PATH)) {
		console.log("data/knowledge.db not found");
		return;
	}
	if (!hasZirpTables()) {
		console.log("zirp_* tables not initialized. Run `bun zirp init-db`.");
		return;
	}

	const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
		readonly: true,
	});
	try {
		const sources = db
			.query("SELECT count(*) AS count FROM zirp_sources")
			.get() as { count: number };
		const chunks = db
			.query("SELECT count(*) AS count FROM zirp_chunks")
			.get() as { count: number };
		const runs = db.query("SELECT count(*) AS count FROM zirp_runs").get() as {
			count: number;
		};
		console.log(`zirp sources: ${sources.count.toLocaleString()}`);
		console.log(`zirp chunks:  ${chunks.count.toLocaleString()}`);
		console.log(`zirp runs:    ${runs.count.toLocaleString()}\n`);

		const tiers = db
			.query(`
				SELECT s.tier AS tier, s.source_type AS source_type, count(*) AS count
				FROM zirp_sources s
				GROUP BY s.tier, s.source_type
				ORDER BY count DESC
			`)
			.all() as { tier: string; source_type: string; count: number }[];
		for (const row of tiers) {
			console.log(
				`${`${row.tier}/${row.source_type}`.padEnd(28)} ${row.count}`,
			);
		}
	} finally {
		db.close();
	}
}

function hasZirpTables() {
	try {
		const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
			readonly: true,
		});
		const row = db
			.query(
				"SELECT count(*) AS count FROM sqlite_master WHERE name = 'zirp_sources'",
			)
			.get() as { count: number };
		db.close();
		return row.count > 0;
	} catch {
		return false;
	}
}

function openKnowledgeDb() {
	if (!existsSync(KNOWLEDGE_DB_PATH)) {
		throw new Error(
			"data/knowledge.db not found. Run the sync pipeline first.",
		);
	}
	return new Database(KNOWLEDGE_DB_PATH);
}

function runSqlScript(db: Database, sql: string) {
	for (const statement of sql.split(";")) {
		const trimmed = statement.trim();
		if (trimmed) db.run(trimmed);
	}
}

function inferSourceType(doc: ZirpDoc) {
	if (doc.id.startsWith("library:"))
		return String(doc.metadata?.source ?? "library");
	if (doc.id.startsWith("goodreads:")) return "goodreads";
	if (doc.id.startsWith("spotify:")) return "spotify";
	if (doc.tier === "self") return "blog";
	if (doc.tier === "operator") return "versa";
	return "note";
}

function hashDoc(doc: ZirpDoc) {
	return createHash("sha256")
		.update([doc.id, doc.title, doc.sourcePath, doc.text].join("\n"))
		.digest("hex");
}

function chunkText(text: string, size = 512, overlap = 64) {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length <= size) return [text];

	const chunks: string[] = [];
	for (let start = 0; start < words.length; start += size - overlap) {
		chunks.push(words.slice(start, start + size).join(" "));
		if (start + size >= words.length) break;
	}
	return chunks;
}

function buildFtsQuery(query: string) {
	const tokens = tokenize(query)
		.flatMap((token) => token.split(/[^a-z0-9]+/))
		.filter(Boolean);
	const uniqueTokens = [...new Set(tokens)];
	if (uniqueTokens.length === 0) return "";
	return uniqueTokens.map((token) => `${token}*`).join(" OR ");
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
	if (!existsSync(KNOWLEDGE_DB_PATH)) return [];

	try {
		const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
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
				id: `spotify:${track.id ?? "track"}:${index}`,
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

type OpenAIResponse = {
	output_text?: string;
	output?: {
		content?: { text?: string; type?: string }[];
	}[];
};

function extractOpenAIText(body: OpenAIResponse) {
	if (body.output_text) return body.output_text;
	return (
		body.output
			?.flatMap((item) => item.content ?? [])
			.map((content) => content.text)
			.filter(Boolean)
			.join("\n") ?? ""
	);
}

async function ask(query: string, hits: SearchHit[], modelConfig: ModelConfig) {
	const prompt = buildPrompt(query, hits);
	const responseText = await callModel(prompt, modelConfig);

	if (!responseText) {
		console.log(
			`No API key found for ${modelConfig.provider}. Printing prompt instead.\n`,
		);
		console.log(formatPrompt(prompt.system, prompt.user));
		return "";
	}

	console.log(responseText);
	console.log("\nSources:");
	for (const [index, hit] of hits.entries()) {
		console.log(`${index + 1}. ${hit.title} — ${hit.sourcePath}`);
	}
	return responseText;
}

async function callModel(
	prompt: { system: string; user: string },
	modelConfig: ModelConfig,
) {
	if (modelConfig.provider === "openai") {
		return callOpenAI(prompt, modelConfig);
	}
	return callAnthropic(prompt, modelConfig);
}

async function callOpenAI(
	prompt: { system: string; user: string },
	modelConfig: ModelConfig,
) {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) return "";

	const response = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: modelConfig.model,
			max_output_tokens: 900,
			reasoning: { effort: modelConfig.reasoningEffort },
			input: [
				{ role: "system", content: prompt.system },
				{ role: "user", content: prompt.user },
			],
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`OpenAI request failed: ${response.status} ${body}`);
	}

	const body = (await response.json()) as OpenAIResponse;
	return extractOpenAIText(body);
}

async function callAnthropic(
	prompt: { system: string; user: string },
	modelConfig: ModelConfig,
) {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) return "";

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify({
			model: modelConfig.model,
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
	return (
		body.content
			?.map((part) => part.text)
			.filter(Boolean)
			.join("\n") ?? ""
	);
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
