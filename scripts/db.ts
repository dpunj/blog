import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = "./data/knowledge.db";

// Ensure data directory exists
function ensureDbDir() {
	const dir = dirname(DB_PATH);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

// Initialize database with schema
export function getDb(): Database {
	ensureDbDir();
	const db = new Database(DB_PATH);

	// Enable WAL mode for better concurrent access
	db.run("PRAGMA journal_mode = WAL");

	// Create tables
	db.run(`
		CREATE TABLE IF NOT EXISTS resources (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL, -- 'bookmark' | 'video' | 'paper' | 'book' | 'track'
			title TEXT NOT NULL,
			url TEXT,
			author TEXT,
			description TEXT,
			tags TEXT, -- JSON array
			source TEXT NOT NULL, -- 'readwise' | 'zotero' | 'goodreads' | 'spotify' | 'manual'
			source_id TEXT, -- ID from the source system
			metadata TEXT, -- JSON for source-specific data
			created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			classified_at TEXT,
			UNIQUE(source, source_id)
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			parent_id INTEGER REFERENCES tags(id),
			description TEXT,
			created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS resource_tags (
			resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
			tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
			confidence REAL, -- LLM classification confidence
			PRIMARY KEY (resource_id, tag_id)
		)
	`);

	// Indexes for common queries
	db.run("CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type)");
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_resources_source ON resources(source)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_resources_created ON resources(created_at)",
	);

	// Migration: Add Now queue columns (safe for existing DBs)
	const columns = db.prepare("PRAGMA table_info(resources)").all() as {
		name: string;
	}[];
	const columnNames = new Set(columns.map((c) => c.name));

	if (!columnNames.has("status")) {
		db.run("ALTER TABLE resources ADD COLUMN status TEXT");
	}
	if (!columnNames.has("status_manual")) {
		db.run("ALTER TABLE resources ADD COLUMN status_manual INTEGER DEFAULT 0");
	}
	if (!columnNames.has("platform_status")) {
		db.run("ALTER TABLE resources ADD COLUMN platform_status TEXT");
	}
	if (!columnNames.has("favorited")) {
		db.run("ALTER TABLE resources ADD COLUMN favorited INTEGER DEFAULT 0");
	}
	if (!columnNames.has("rating")) {
		db.run("ALTER TABLE resources ADD COLUMN rating INTEGER");
	}
	if (!columnNames.has("queue_priority")) {
		db.run("ALTER TABLE resources ADD COLUMN queue_priority INTEGER");
	}
	if (!columnNames.has("image_url")) {
		db.run("ALTER TABLE resources ADD COLUMN image_url TEXT");
	}
	if (!columnNames.has("date_published")) {
		db.run("ALTER TABLE resources ADD COLUMN date_published TEXT");
	}
	if (!columnNames.has("reading_progress")) {
		db.run("ALTER TABLE resources ADD COLUMN reading_progress REAL");
	}
	if (!columnNames.has("item_type")) {
		db.run("ALTER TABLE resources ADD COLUMN item_type TEXT");
	}
	if (!columnNames.has("publication_title")) {
		db.run("ALTER TABLE resources ADD COLUMN publication_title TEXT");
	}
	if (!columnNames.has("source_created_at")) {
		db.run("ALTER TABLE resources ADD COLUMN source_created_at TEXT");
	}
	if (!columnNames.has("source_updated_at")) {
		db.run("ALTER TABLE resources ADD COLUMN source_updated_at TEXT");
	}
	if (!columnNames.has("last_seen_at")) {
		db.run("ALTER TABLE resources ADD COLUMN last_seen_at TEXT");
	}

	db.run(`
		CREATE TABLE IF NOT EXISTS sync_state (
			source TEXT PRIMARY KEY,
			last_started_at TEXT,
			last_success_at TEXT,
			high_water_mark TEXT,
			version INTEGER,
			metadata TEXT,
			updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		)
	`);

	db.run(
		"CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_resources_source_created ON resources(source_created_at)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_resources_last_seen ON resources(last_seen_at)",
	);

	return db;
}

// Resource types
export type ResourceType =
	| "bookmark"
	| "article"
	| "video"
	| "paper"
	| "book"
	| "track"
	| "album"
	| "movie"
	| "game"
	| "pdf"
	| "epub"
	| "tweet"
	| "other";

export type ResourceSource =
	| "readwise"
	| "zotero"
	| "goodreads"
	| "spotify"
	| "letterboxd"
	| "rawg"
	| "tmdb"
	| "manual";

export type ConsumptionStatus = "now" | "next" | "done" | "dropped" | null;

export interface SyncState {
	source: ResourceSource;
	last_started_at?: string;
	last_success_at?: string;
	high_water_mark?: string;
	version?: number;
	metadata?: Record<string, unknown>;
	updated_at?: string;
}

export interface Resource {
	id: string;
	type: ResourceType;
	title: string;
	url?: string;
	author?: string;
	description?: string;
	tags?: string[];
	source: ResourceSource;
	source_id?: string;
	metadata?: Record<string, unknown>;
	created_at?: string;
	updated_at?: string;
	classified_at?: string;
	// Source/library metadata
	image_url?: string;
	reading_progress?: number;
	date_published?: string;
	source_created_at?: string;
	source_updated_at?: string;
	last_seen_at?: string;
	// Zotero-specific
	item_type?: string;
	publication_title?: string;
	// Now queue fields
	status?: ConsumptionStatus;
	status_manual?: number;
	platform_status?: string;
	favorited?: number;
	rating?: number;
	queue_priority?: number;
}

export function getSyncState(
	db: Database,
	source: ResourceSource,
): SyncState | undefined {
	const row = db
		.prepare("SELECT * FROM sync_state WHERE source = ?")
		.get(source) as Record<string, unknown> | undefined;

	if (!row) return undefined;

	return {
		source: row.source as ResourceSource,
		last_started_at: row.last_started_at as string | undefined,
		last_success_at: row.last_success_at as string | undefined,
		high_water_mark: row.high_water_mark as string | undefined,
		version:
			typeof row.version === "number"
				? row.version
				: row.version
					? Number(row.version)
					: undefined,
		metadata: row.metadata
			? (JSON.parse(row.metadata as string) as Record<string, unknown>)
			: undefined,
		updated_at: row.updated_at as string | undefined,
	};
}

export function saveSyncState(db: Database, state: SyncState): void {
	db.prepare(
		`
		INSERT INTO sync_state (source, last_started_at, last_success_at, high_water_mark, version, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		ON CONFLICT(source) DO UPDATE SET
			last_started_at = excluded.last_started_at,
			last_success_at = excluded.last_success_at,
			high_water_mark = excluded.high_water_mark,
			version = excluded.version,
			metadata = excluded.metadata,
			updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	`,
	).run(
		state.source,
		state.last_started_at ?? null,
		state.last_success_at ?? null,
		state.high_water_mark ?? null,
		state.version ?? null,
		state.metadata ? JSON.stringify(state.metadata) : null,
	);
}

// Insert or update a resource
export function upsertResource(db: Database, resource: Resource): void {
	const stmt = db.prepare(`
		INSERT INTO resources (id, type, title, url, author, description, tags, source, source_id, metadata, 
			status, status_manual, platform_status, favorited, rating, queue_priority, image_url, date_published,
			reading_progress, item_type, publication_title, source_created_at, source_updated_at, last_seen_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		ON CONFLICT(id) DO UPDATE SET
			type = excluded.type,
			title = excluded.title,
			url = excluded.url,
			author = excluded.author,
			description = excluded.description,
			tags = excluded.tags,
			source = excluded.source,
			source_id = excluded.source_id,
			metadata = excluded.metadata,
			platform_status = excluded.platform_status,
			image_url = COALESCE(excluded.image_url, resources.image_url),
			date_published = COALESCE(excluded.date_published, resources.date_published),
			reading_progress = COALESCE(excluded.reading_progress, resources.reading_progress),
			item_type = COALESCE(excluded.item_type, resources.item_type),
			publication_title = COALESCE(excluded.publication_title, resources.publication_title),
			source_created_at = COALESCE(excluded.source_created_at, resources.source_created_at),
			source_updated_at = COALESCE(excluded.source_updated_at, resources.source_updated_at),
			last_seen_at = COALESCE(excluded.last_seen_at, resources.last_seen_at),
			status_manual = MAX(resources.status_manual, excluded.status_manual),
			-- Only update status/priority if the existing row is not manually curated
			status = CASE WHEN resources.status_manual = 1 THEN resources.status ELSE excluded.status END,
			queue_priority = CASE WHEN resources.status_manual = 1 THEN resources.queue_priority ELSE excluded.queue_priority END,
			favorited = COALESCE(excluded.favorited, resources.favorited),
			rating = COALESCE(excluded.rating, resources.rating),
			updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	`);

	stmt.run(
		resource.id,
		resource.type,
		resource.title,
		resource.url ?? null,
		resource.author ?? null,
		resource.description ?? null,
		resource.tags ? JSON.stringify(resource.tags) : null,
		resource.source,
		resource.source_id ?? null,
		resource.metadata ? JSON.stringify(resource.metadata) : null,
		resource.status ?? null,
		resource.status_manual ?? 0,
		resource.platform_status ?? null,
		resource.favorited ?? 0,
		resource.rating ?? null,
		resource.queue_priority ?? null,
		resource.image_url ?? null,
		resource.date_published ?? null,
		resource.reading_progress ?? null,
		resource.item_type ?? null,
		resource.publication_title ?? null,
		resource.source_created_at ?? null,
		resource.source_updated_at ?? null,
		resource.last_seen_at ?? null,
	);
}

// Get all resources of a type
export function getResourcesByType(
	db: Database,
	type: Resource["type"],
): Resource[] {
	const stmt = db.prepare(
		"SELECT * FROM resources WHERE type = ? ORDER BY created_at DESC",
	);
	const rows = stmt.all(type) as Record<string, unknown>[];

	return rows.map((row) => ({
		...row,
		tags: row.tags ? JSON.parse(row.tags as string) : undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	})) as Resource[];
}

// Get all resources
export function getAllResources(db: Database): Resource[] {
	const stmt = db.prepare("SELECT * FROM resources ORDER BY created_at DESC");
	const rows = stmt.all() as Record<string, unknown>[];

	return rows.map((row) => ({
		...row,
		tags: row.tags ? JSON.parse(row.tags as string) : undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	})) as Resource[];
}

// Get library resources (readwise + zotero)
export function getLibraryResources(db: Database): Resource[] {
	const stmt = db.prepare(
		`SELECT * FROM resources
		WHERE source IN ('readwise', 'zotero')
		ORDER BY COALESCE(source_created_at, created_at) DESC, id ASC`,
	);
	const rows = stmt.all() as Record<string, unknown>[];

	return rows.map((row) => ({
		...row,
		tags: row.tags ? JSON.parse(row.tags as string) : undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	})) as Resource[];
}

// Get resources by source
export function getResourcesBySource(
	db: Database,
	source: ResourceSource,
): Resource[] {
	const stmt = db.prepare(
		"SELECT * FROM resources WHERE source = ? ORDER BY created_at DESC",
	);
	const rows = stmt.all(source) as Record<string, unknown>[];

	return rows.map((row) => ({
		...row,
		tags: row.tags ? JSON.parse(row.tags as string) : undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	})) as Resource[];
}

// Export resources as JSON
export function exportAsJson(db: Database, type?: Resource["type"]): string {
	const resources = type ? getResourcesByType(db, type) : getAllResources(db);
	return JSON.stringify(resources, null, 2);
}

// Stats
export function getStats(db: Database) {
	const stmt = db.prepare(`
		SELECT type, COUNT(*) as count 
		FROM resources 
		GROUP BY type
	`);
	return stmt.all();
}

// Get resources in the Now queue (status = 'now' or 'next')
export function getNowResources(db: Database): Resource[] {
	const stmt = db.prepare(`
		SELECT * FROM resources 
		WHERE status IN ('now', 'next')
		ORDER BY 
			CASE status WHEN 'now' THEN 0 WHEN 'next' THEN 1 END,
			queue_priority ASC NULLS LAST,
			created_at DESC
	`);
	const rows = stmt.all() as Record<string, unknown>[];

	return rows.map((row) => ({
		...row,
		tags: row.tags ? JSON.parse(row.tags as string) : undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	})) as Resource[];
}

// Update resource status (manual curation)
export function updateResourceStatus(
	db: Database,
	id: string,
	status: ConsumptionStatus,
	priority?: number,
): void {
	const stmt = db.prepare(`
		UPDATE resources 
		SET status = ?, 
			status_manual = 1, 
			queue_priority = COALESCE(?, queue_priority),
			updated_at = datetime('now')
		WHERE id = ?
	`);
	stmt.run(status, priority ?? null, id);
}

// CLI entry point
if (import.meta.main) {
	const db = getDb();
	const stats = getStats(db);
	console.log("📊 Database stats:");
	console.log(stats.length ? stats : "No resources yet");
	db.close();
}
