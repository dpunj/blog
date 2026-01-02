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
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now')),
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
			created_at TEXT DEFAULT (datetime('now'))
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

	db.run(
		"CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status)",
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
	// Readwise-specific
	image_url?: string;
	reading_progress?: number;
	date_published?: string;
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

// Insert or update a resource
export function upsertResource(db: Database, resource: Resource): void {
	const stmt = db.prepare(`
		INSERT INTO resources (id, type, title, url, author, description, tags, source, source_id, metadata, 
			status, status_manual, platform_status, favorited, rating, queue_priority, image_url, date_published, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
			-- Only update status/priority if NOT manually curated
			status = CASE WHEN resources.status_manual = 1 THEN resources.status ELSE excluded.status END,
			queue_priority = CASE WHEN resources.status_manual = 1 THEN resources.queue_priority ELSE excluded.queue_priority END,
			favorited = COALESCE(excluded.favorited, resources.favorited),
			rating = COALESCE(excluded.rating, resources.rating),
			updated_at = datetime('now')
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
		"SELECT * FROM resources WHERE source IN ('readwise', 'zotero') ORDER BY created_at DESC",
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
