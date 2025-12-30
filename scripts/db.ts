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
	db.run("CREATE INDEX IF NOT EXISTS idx_resources_source ON resources(source)");
	db.run("CREATE INDEX IF NOT EXISTS idx_resources_created ON resources(created_at)");

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
	| "pdf"
	| "epub"
	| "tweet"
	| "other";

export type ResourceSource =
	| "readwise"
	| "zotero"
	| "goodreads"
	| "spotify"
	| "manual";

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
}

// Insert or update a resource
export function upsertResource(db: Database, resource: Resource): void {
	const stmt = db.prepare(`
		INSERT INTO resources (id, type, title, url, author, description, tags, source, source_id, metadata, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
	);
}

// Get all resources of a type
export function getResourcesByType(db: Database, type: Resource["type"]): Resource[] {
	const stmt = db.prepare("SELECT * FROM resources WHERE type = ? ORDER BY created_at DESC");
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
		"SELECT * FROM resources WHERE source IN ('readwise', 'zotero') ORDER BY created_at DESC"
	);
	const rows = stmt.all() as Record<string, unknown>[];

	return rows.map((row) => ({
		...row,
		tags: row.tags ? JSON.parse(row.tags as string) : undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	})) as Resource[];
}

// Get resources by source
export function getResourcesBySource(db: Database, source: ResourceSource): Resource[] {
	const stmt = db.prepare("SELECT * FROM resources WHERE source = ? ORDER BY created_at DESC");
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

// CLI entry point
if (import.meta.main) {
	const db = getDb();
	const stats = getStats(db);
	console.log("📊 Database stats:");
	console.log(stats.length ? stats : "No resources yet");
	db.close();
}
