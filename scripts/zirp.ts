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
	console.log(`divesh_zirp local oracle

Commands:
  bun zirp inventory [--include-journal]
  bun zirp init-db
  bun zirp index [--include-journal]
  bun zirp stats
  bun zirp serve [--host 127.0.0.1] [--port 7331]
  bun zirp search <query> [--limit 8] [--include-journal] [--memory]
  bun zirp prompt <query> [--include-journal] [--memory]
  bun zirp ask <query> [--include-journal] [--memory] [--provider openai|anthropic] [--model gpt-5.5] [--reasoning-effort low]

Notes:
  - journal/ is excluded unless --include-journal is passed.
  - serve binds to 127.0.0.1 by default for privacy.
  - search/prompt/ask prefer the SQLite index when available; use --memory to force v0 in-memory search.
  - ask defaults to OpenAI GPT-5.5 with reasoning effort low when OPENAI_API_KEY is present.
  - set ZIRP_PROVIDER/ZIRP_MODEL/ZIRP_REASONING_EFFORT or pass flags to override.
  - if no configured API key is found, ask prints the prompt.`);
}

async function main() {
	const cli = parseCliArgs(process.argv.slice(2));
	const command = cli.positionals[0];

	if (
		!command ||
		command === "help" ||
		command === "--help" ||
		command === "-h" ||
		cli.flags.has("help") ||
		cli.flags.has("h")
	) {
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

	if (command === "serve") {
		const host = cli.values.get("host") ?? "127.0.0.1";
		const requestedPort = Number(cli.values.get("port") ?? 7331);
		const port = Number.isFinite(requestedPort) ? requestedPort : 7331;
		serveZirp({ host, port, includeJournal, forceMemory, modelConfig });
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

type ServeOptions = {
	host: string;
	port: number;
	includeJournal: boolean;
	forceMemory: boolean;
	modelConfig: ModelConfig;
};

function serveZirp(options: ServeOptions) {
	const server = Bun.serve({
		hostname: options.host,
		port: options.port,
		async fetch(request) {
			const url = new URL(request.url);
			try {
				if (url.pathname === "/") return htmlResponse(renderZirpUi(options));
				if (url.pathname === "/api/stats") return jsonResponse(getZirpStats());
				if (url.pathname === "/api/runs") return jsonResponse(getRecentRuns());
				if (url.pathname === "/api/db/tables")
					return jsonResponse(getDbTables());
				if (url.pathname === "/api/db/table") {
					return jsonResponse(
						getDbTableRows(
							String(url.searchParams.get("name") ?? ""),
							Number(url.searchParams.get("limit") ?? 50),
						),
					);
				}
				if (url.pathname === "/api/db/query" && request.method === "POST") {
					const body = await readJsonBody(request);
					return jsonResponse(runReadOnlySql(String(body.sql ?? "")));
				}
				if (url.pathname === "/api/search" && request.method === "POST") {
					const body = await readJsonBody(request);
					const query = String(body.query ?? "").trim();
					const limit = readApiLimit(body.limit);
					const hits = search(
						query,
						limit,
						options.includeJournal,
						Boolean(body.memory ?? options.forceMemory),
					);
					recordZirpRun("search", query, hits);
					return jsonResponse({ hits: hits.map(toPublicHit) });
				}
				if (url.pathname === "/api/prompt" && request.method === "POST") {
					const body = await readJsonBody(request);
					const query = String(body.query ?? "").trim();
					const limit = readApiLimit(body.limit);
					const hits = search(
						query,
						limit,
						options.includeJournal,
						Boolean(body.memory ?? options.forceMemory),
					);
					const prompt = buildPrompt(query, hits);
					recordZirpRun("prompt", query, hits);
					return jsonResponse({ ...prompt, hits: hits.map(toPublicHit) });
				}
				if (url.pathname === "/api/ask" && request.method === "POST") {
					const body = await readJsonBody(request);
					const query = String(body.query ?? "").trim();
					const limit = readApiLimit(body.limit);
					const requestModel = getRequestModelConfig(body, options.modelConfig);
					const hits = search(
						query,
						limit,
						options.includeJournal,
						Boolean(body.memory ?? options.forceMemory),
					);
					const prompt = buildPrompt(query, hits);
					const answer = await callModel(prompt, requestModel);
					recordZirpRun(
						"ask",
						query,
						hits,
						answer,
						formatModelLabel(requestModel),
					);
					return jsonResponse({
						answer,
						prompt: answer ? undefined : prompt,
						hits: hits.map(toPublicHit),
						model: formatModelLabel(requestModel),
						noKey: !answer,
					});
				}
				return new Response("Not found", { status: 404 });
			} catch (error) {
				return jsonResponse(
					{ error: error instanceof Error ? error.message : String(error) },
					500,
				);
			}
		},
	});

	console.log(
		`divesh_zirp cockpit listening on http://${server.hostname}:${server.port}`,
	);
	console.log(
		"Local-only by default. Use --host 0.0.0.0 only if you know what you are exposing.",
	);
}

function getRequestModelConfig(
	body: Record<string, unknown>,
	fallback: ModelConfig,
): ModelConfig {
	return {
		provider: normalizeProvider(
			typeof body.provider === "string" ? body.provider : fallback.provider,
		),
		model: normalizeModelName(
			typeof body.model === "string" ? body.model : fallback.model,
		),
		reasoningEffort: normalizeReasoningEffort(
			typeof body.reasoningEffort === "string"
				? body.reasoningEffort
				: fallback.reasoningEffort,
		),
	};
}

async function readJsonBody(request: Request) {
	if (!request.body) return {} as Record<string, unknown>;
	return (await request.json()) as Record<string, unknown>;
}

function readApiLimit(value: unknown) {
	const limit = Number(value ?? 8);
	if (!Number.isFinite(limit)) return 8;
	return Math.max(1, Math.min(20, limit));
}

function toPublicHit(hit: SearchHit) {
	return {
		id: hit.id,
		title: hit.title,
		sourcePath: hit.sourcePath,
		tier: hit.tier,
		kind: hit.kind,
		score: Number(hit.score.toFixed(2)),
		snippet: hit.snippet,
	};
}

function getZirpStats() {
	if (!existsSync(KNOWLEDGE_DB_PATH) || !hasZirpTables()) {
		return { initialized: false, sources: 0, chunks: 0, runs: 0, tiers: [] };
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
		const tiers = db
			.query(`
				SELECT tier, source_type AS sourceType, count(*) AS count
				FROM zirp_sources
				GROUP BY tier, source_type
				ORDER BY count DESC
			`)
			.all() as { tier: string; sourceType: string; count: number }[];
		return {
			initialized: true,
			sources: sources.count,
			chunks: chunks.count,
			runs: runs.count,
			tiers,
		};
	} finally {
		db.close();
	}
}

function getRecentRuns() {
	if (!existsSync(KNOWLEDGE_DB_PATH) || !hasZirpTables()) return { runs: [] };
	const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
		readonly: true,
	});
	try {
		const runs = db
			.query(`
				SELECT id, created_at AS createdAt, mode, model, query
				FROM zirp_runs
				ORDER BY created_at DESC
				LIMIT 20
			`)
			.all() as {
			id: string;
			createdAt: string;
			mode: string;
			model: string | null;
			query: string;
		}[];
		return { runs };
	} finally {
		db.close();
	}
}

function getDbTables() {
	if (!existsSync(KNOWLEDGE_DB_PATH)) return { tables: [] };
	const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
		readonly: true,
	});
	try {
		const tables = db
			.query(`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
					AND name NOT LIKE 'sqlite_%'
					AND name NOT LIKE 'zirp_chunks_fts_%'
				ORDER BY name
			`)
			.all() as { name: string }[];
		return {
			tables: tables.map((table) => ({
				name: table.name,
				count: getTableCount(db, table.name),
			})),
		};
	} finally {
		db.close();
	}
}

function getTableCount(db: Database, tableName: string) {
	try {
		assertSafeIdentifier(tableName);
		const row = db
			.query(`SELECT count(*) AS count FROM "${tableName}"`)
			.get() as {
			count: number;
		};
		return row.count;
	} catch {
		return null;
	}
}

function getDbTableRows(tableName: string, limitValue: number) {
	assertSafeIdentifier(tableName);
	const limit = Math.max(
		1,
		Math.min(200, Number.isFinite(limitValue) ? limitValue : 50),
	);
	const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
		readonly: true,
	});
	try {
		const rows = db
			.query(`SELECT * FROM "${tableName}" LIMIT ?`)
			.all(limit) as Record<string, unknown>[];
		const columns = db.query(`PRAGMA table_info("${tableName}")`).all() as {
			name: string;
			type: string;
		}[];
		return { table: tableName, columns, rows: serializeRows(rows) };
	} finally {
		db.close();
	}
}

function runReadOnlySql(sql: string) {
	const trimmed = sql.trim();
	if (!isReadOnlySql(trimmed)) {
		throw new Error(
			"Only single SELECT/WITH/PRAGMA read-only queries are allowed.",
		);
	}
	const db = new Database(`file:${KNOWLEDGE_DB_PATH}?mode=ro&immutable=1`, {
		readonly: true,
	});
	try {
		const rows = db.query(trimmed).all() as Record<string, unknown>[];
		return { rows: serializeRows(rows.slice(0, 200)) };
	} finally {
		db.close();
	}
}

function isReadOnlySql(sql: string) {
	const normalized = sql.replace(/--.*$/gm, "").trim().toLowerCase();
	if (!normalized) return false;
	if (normalized.slice(0, -1).includes(";")) return false;
	return /^(select|with|pragma)\b/.test(normalized);
}

function assertSafeIdentifier(identifier: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
		throw new Error(`Unsafe table name: ${identifier}`);
	}
}

function serializeRows(rows: Record<string, unknown>[]) {
	return rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, value]) => [
				key,
				value instanceof Uint8Array
					? `[blob ${value.byteLength} bytes]`
					: value,
			]),
		),
	);
}

function htmlResponse(html: string) {
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function renderZirpUi(options: ServeOptions) {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>divesh_zirp cockpit</title>
	<style>
		:root { color-scheme: dark; --bg: #020617; --panel: #0f172a; --panel-2: #111827; --text: #e5e7eb; --muted: #94a3b8; --line: #1f2937; --accent: #38bdf8; --danger: #f87171; }
		* { box-sizing: border-box; }
		body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
		button, input, textarea, select { font: inherit; }
		button { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; background: var(--panel-2); color: var(--text); cursor: pointer; }
		button:hover { border-color: var(--accent); }
		button.primary { background: var(--accent); border-color: var(--accent); color: #082f49; font-weight: 700; }
		button:disabled { cursor: wait; opacity: 0.6; }
		textarea, input, select { width: 100%; border: 1px solid var(--line); border-radius: 14px; background: #020617; color: var(--text); padding: 12px; }
		textarea { min-height: 120px; resize: vertical; }
		label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; }
		code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
		.shell { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
		.header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 24px; }
		.eyebrow { color: var(--accent); font-size: 13px; font-weight: 700; text-transform: uppercase; }
		h1 { margin: 4px 0 8px; font-size: clamp(32px, 6vw, 72px); line-height: 0.95; letter-spacing: -0.04em; }
		p { color: var(--muted); max-width: 760px; }
		.grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr); gap: 18px; align-items: start; }
		.card { border: 1px solid var(--line); border-radius: 22px; background: var(--panel); padding: 18px; }
		.controls { display: grid; grid-template-columns: 1fr 150px 160px 110px; gap: 10px; margin: 12px 0; }
		.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
		.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
		.stat { border: 1px solid var(--line); border-radius: 16px; padding: 12px; background: #020617; }
		.stat strong { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
		.result { border: 1px solid var(--line); border-radius: 16px; padding: 14px; margin-top: 12px; background: #020617; }
		.result h3 { margin: 0 0 6px; font-size: 16px; }
		.meta { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
		.answer { white-space: pre-wrap; }
		.prompt { max-height: 420px; overflow: auto; white-space: pre-wrap; }
		.error { color: var(--danger); margin-top: 10px; }
		.run { border-top: 1px solid var(--line); padding: 10px 0; }
		.run:first-child { border-top: 0; }
		.table-list { display: grid; gap: 8px; }
		.table-button { width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 8px; }
		.sql { min-height: 72px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
		.table-wrap { max-height: 460px; overflow: auto; border: 1px solid var(--line); border-radius: 14px; margin-top: 10px; }
		table { width: 100%; border-collapse: collapse; font-size: 12px; }
		th, td { border-bottom: 1px solid var(--line); padding: 8px; text-align: left; vertical-align: top; }
		th { position: sticky; top: 0; background: var(--panel-2); color: var(--muted); }
		td { max-width: 360px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		@media (max-width: 880px) { .header, .grid { display: block; } .controls { grid-template-columns: 1fr; } .card { margin-top: 16px; } }
	</style>
</head>
<body>
	<div class="shell">
		<header class="header">
			<div>
				<div class="eyebrow">local private cockpit</div>
				<h1>divesh_zirp</h1>
				<p>Search, prompt, and ask your local corpus. SQLite FTS first, persona docs on top, OpenAI 5.5 low by default when configured.</p>
			</div>
			<div class="card">
				<div class="meta">Host</div>
				<strong>${escapeHtml(options.host)}:${options.port}</strong>
				<div class="meta">Model default</div>
				<strong>${escapeHtml(formatModelLabel(options.modelConfig))}</strong>
			</div>
		</header>

		<div class="grid">
			<main class="card">
				<label>Question
					<textarea id="query">what is the hidden game I keep trying to play?</textarea>
				</label>
				<div class="controls">
					<label>Provider<select id="provider"><option value="openai">openai</option><option value="anthropic">anthropic</option></select></label>
					<label>Model<input id="model" value="${escapeHtml(options.modelConfig.model)}" /></label>
					<label>Reasoning<select id="reasoning"><option>minimal</option><option selected>low</option><option>medium</option><option>high</option></select></label>
					<label>Limit<input id="limit" type="number" min="1" max="20" value="8" /></label>
				</div>
				<div class="actions">
					<button class="primary" id="ask">Ask</button>
					<button id="search">Search</button>
					<button id="prompt">Prompt</button>
					<button id="clear">Clear</button>
				</div>
				<details class="result">
					<summary>SQLite scratchpad</summary>
					<label>Read-only SQL
						<textarea class="sql" id="sql">select name from sqlite_master where type = 'table' order by name;</textarea>
					</label>
					<div class="actions"><button id="runSql">Run SQL</button></div>
				</details>
				<div id="error" class="error" role="alert"></div>
				<section id="answer"></section>
				<section id="results"></section>
				<section id="db"></section>
			</main>

			<aside class="card">
				<h2>Index</h2>
				<div class="stats" id="stats"></div>
				<h2>DB tables</h2>
				<div class="table-list" id="tables"></div>
				<h2>Recent runs</h2>
				<div id="runs"></div>
			</aside>
		</div>
	</div>

	<script>
		const $ = (id) => document.getElementById(id);
		const provider = $("provider");
		provider.value = "${options.modelConfig.provider}";
		$("reasoning").value = "${options.modelConfig.reasoningEffort}";

		async function post(path, body) {
			const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			const json = await response.json();
			if (!response.ok) throw new Error(json.error || "Request failed");
			return json;
		}

		function payload() {
			return { query: $("query").value, limit: Number($("limit").value || 8), provider: provider.value, model: $("model").value, reasoningEffort: $("reasoning").value };
		}

		function setBusy(busy) {
			for (const id of ["ask", "search", "prompt"]) $(id).disabled = busy;
		}

		function renderHits(hits = []) {
			$("results").innerHTML = hits.map((hit, index) => '<article class="result"><h3>' + (index + 1) + '. ' + escapeHtml(hit.title) + '</h3><div class="meta">' + escapeHtml(hit.tier + '/' + hit.kind) + ' · score ' + hit.score + '</div><div class="meta">' + escapeHtml(hit.sourcePath) + '</div><p>' + escapeHtml(hit.snippet) + '</p></article>').join("");
		}

		function renderRows(title, rows = []) {
			if (!rows.length) {
				$("db").innerHTML = '<article class="result"><h3>' + escapeHtml(title) + '</h3><p>No rows.</p></article>';
				return;
			}
			const columns = Object.keys(rows[0]);
			$("db").innerHTML = '<article class="result"><h3>' + escapeHtml(title) + '</h3><div class="table-wrap"><table><thead><tr>' + columns.map((column) => '<th>' + escapeHtml(column) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((row) => '<tr>' + columns.map((column) => '<td title="' + escapeHtml(row[column]) + '">' + escapeHtml(row[column]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></article>';
		}

		async function loadTable(name) {
			const json = await fetch('/api/db/table?name=' + encodeURIComponent(name) + '&limit=50').then((r) => r.json());
			renderRows('Table: ' + json.table, json.rows || []);
		}

		async function runSql() {
			$("error").textContent = "";
			try {
				const json = await post('/api/db/query', { sql: $("sql").value });
				renderRows('SQL result', json.rows || []);
			} catch (error) {
				$("error").textContent = error.message;
			}
		}

		function renderAnswer(json) {
			if (json.noKey) {
				$("answer").innerHTML = '<article class="result"><h3>No API key found. Prompt generated instead.</h3><pre class="prompt">' + escapeHtml('# SYSTEM\\n\\n' + json.prompt.system + '\\n\\n# USER\\n\\n' + json.prompt.user) + '</pre></article>';
			} else {
				$("answer").innerHTML = '<article class="result"><h3>Answer</h3><div class="meta">' + escapeHtml(json.model || '') + '</div><div class="answer">' + escapeHtml(json.answer || '') + '</div></article>';
			}
			renderHits(json.hits);
		}

		async function run(mode) {
			$("error").textContent = "";
			setBusy(true);
			try {
				if (mode === "search") {
					const json = await post("/api/search", payload());
					$("answer").innerHTML = "";
					renderHits(json.hits);
				} else if (mode === "prompt") {
					const json = await post("/api/prompt", payload());
					$("answer").innerHTML = '<article class="result"><h3>Prompt</h3><pre class="prompt">' + escapeHtml('# SYSTEM\\n\\n' + json.system + '\\n\\n# USER\\n\\n' + json.user) + '</pre></article>';
					renderHits(json.hits);
				} else {
					renderAnswer(await post("/api/ask", payload()));
				}
				await loadSidebars();
			} catch (error) {
				$("error").textContent = error.message;
			} finally {
				setBusy(false);
			}
		}

		async function loadSidebars() {
			const stats = await fetch("/api/stats").then((r) => r.json());
			$("stats").innerHTML = ['sources','chunks','runs'].map((key) => '<div class="stat"><span class="meta">' + key + '</span><strong>' + Number(stats[key] || 0).toLocaleString() + '</strong></div>').join("");
			const tables = await fetch("/api/db/tables").then((r) => r.json());
			$("tables").innerHTML = (tables.tables || []).map((table) => '<button class="table-button" data-table="' + escapeHtml(table.name) + '"><span>' + escapeHtml(table.name) + '</span><span class="meta">' + Number(table.count || 0).toLocaleString() + '</span></button>').join("");
			for (const button of document.querySelectorAll('[data-table]')) button.addEventListener('click', () => loadTable(button.dataset.table));
			const runs = await fetch("/api/runs").then((r) => r.json());
			$("runs").innerHTML = (runs.runs || []).map((run) => '<div class="run"><div class="meta">' + escapeHtml(run.mode + ' · ' + (run.model || 'prompt')) + '</div><div>' + escapeHtml(run.query) + '</div></div>').join("") || '<p>No runs yet.</p>';
		}

		function escapeHtml(value) {
			return String(value ?? "").replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
		}

		$("ask").addEventListener("click", () => run("ask"));
		$("search").addEventListener("click", () => run("search"));
		$("prompt").addEventListener("click", () => run("prompt"));
		$("runSql").addEventListener("click", runSql);
		$("clear").addEventListener("click", () => { $("answer").innerHTML = ""; $("results").innerHTML = ""; $("db").innerHTML = ""; $("error").textContent = ""; });
		$("query").addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") run("ask"); });
		loadSidebars();
	</script>
</body>
</html>`;
}

function escapeHtml(value: string | number) {
	return String(value).replace(/[&<>"']/g, (char) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[char] ?? char;
	});
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
