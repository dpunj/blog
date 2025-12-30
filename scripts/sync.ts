import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { getDb, upsertResource, getStats, exportAsJson, getLibraryResources, type Resource, type ResourceType } from "./db";

// ============================================================================
// Environment & Rate Limiting
// ============================================================================

const READWISE_TOKEN = process.env.READWISE_TOKEN;
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;

const READWISE_DELAY_MS = 3500; // ~17 requests/minute (limit is 20)
const ZOTERO_DELAY_MS = 1100; // 1 request/sec per API guidance
const MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retries = MAX_RETRIES,
): Promise<Response> {
	const response = await fetch(url, options);

	if (response.status === 429 && retries > 0) {
		const retryAfter = response.headers.get("Retry-After");
		const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 60000;
		console.log(`  Rate limited, waiting ${waitMs / 1000}s...`);
		await delay(waitMs);
		return fetchWithRetry(url, options, retries - 1);
	}

	return response;
}

// Parse Goodreads CSV (reusing logic from src/scripts/books.ts)
async function syncBooks(db: ReturnType<typeof getDb>) {
	const csvPath = "./public/data/goodreads_library_export.csv";
	const file = Bun.file(csvPath);

	if (!(await file.exists())) {
		console.log("⚠️  No Goodreads CSV found at", csvPath);
		return 0;
	}

	const text = await file.text();
	const lines = text.split("\n").slice(1);
	let count = 0;

	for (const line of lines) {
		if (!line.trim()) continue;

		const fields = line.split(",").map((f) => f.replace(/^="(.*)"$/, "$1"));
		const [, title, author, , , , , rating, , , , , , , dateRead, , bookshelves, , , review] = fields;

		if (!title) continue;

		const resource: Resource = {
			id: `goodreads-${Buffer.from(title + author).toString("base64url").slice(0, 16)}`,
			type: "book",
			title,
			author,
			description: review || undefined,
			tags: bookshelves?.split(";").map((s) => s.trim()).filter(Boolean) || [],
			source: "goodreads",
			source_id: title, // Goodreads CSV doesn't include IDs
			metadata: {
				rating: Number.parseInt(rating) || 0,
				dateRead: dateRead || null,
			},
		};

		upsertResource(db, resource);
		count++;
	}

	return count;
}

// Parse Spotify JSON (reusing logic from src/scripts/music.ts)
async function syncMusic(db: ReturnType<typeof getDb>) {
	const jsonPath = "./public/data/wtm.json";
	const file = Bun.file(jsonPath);

	if (!(await file.exists())) {
		console.log("⚠️  No Spotify JSON found at", jsonPath);
		return 0;
	}

	const data = await file.json();
	let count = 0;

	for (const track of data.tracks || []) {
		const resource: Resource = {
			id: `spotify-${track.id}`,
			type: "track",
			title: track.name,
			author: track.artists?.map((a: { name: string }) => a.name).join(", "),
			url: `https://open.spotify.com/track/${track.id}`,
			source: "spotify",
			source_id: track.id,
			metadata: {
				albumName: track.album?.name,
				albumId: track.album?.id,
				releaseDate: track.album?.release_date,
				durationSecs: track.duration?.secs,
				explicit: track.explicit,
			},
		};

		upsertResource(db, resource);
		count++;
	}

	return count;
}

// ============================================================================
// Readwise API Types & Sync
// ============================================================================

interface ReadwiseTag {
	name: string;
}

interface ReadwiseDocument {
	id: string;
	url: string;
	title: string;
	author: string | null;
	summary: string | null;
	image_url: string | null;
	created_at: string;
	published_date: string | null;
	category: string;
	tags: ReadwiseTag[];
	reading_progress: number;
}

interface ReadwiseResponse {
	results: ReadwiseDocument[];
	nextPageCursor: string | null;
}

const READWISE_CATEGORY_MAP: Record<string, ResourceType> = {
	article: "article",
	highlight: "article",
	note: "article",
	pdf: "pdf",
	epub: "epub",
	tweet: "tweet",
	video: "video",
	email: "article",
	rss: "article",
};

async function syncReadwise(db: ReturnType<typeof getDb>) {
	if (!READWISE_TOKEN) {
		console.log("📚 READWISE_TOKEN not set, skipping Readwise sync");
		return 0;
	}

	console.log("📚 Fetching Readwise documents...");
	const docs: ReadwiseDocument[] = [];
	let cursor: string | null = null;

	do {
		const url = new URL("https://readwise.io/api/v3/list/");
		if (cursor) url.searchParams.set("pageCursor", cursor);

		const response = await fetchWithRetry(url.toString(), {
			headers: { Authorization: `Token ${READWISE_TOKEN}` },
		});

		if (!response.ok) {
			throw new Error(`Readwise API error: ${response.status} ${response.statusText}`);
		}

		const data: ReadwiseResponse = await response.json();
		docs.push(...data.results);
		cursor = data.nextPageCursor;

		console.log(`  Fetched ${docs.length} documents...`);

		if (cursor) await delay(READWISE_DELAY_MS);
	} while (cursor);

	let count = 0;
	for (const doc of docs) {
		const tags = Array.isArray(doc.tags) ? doc.tags.map((t) => t.name).filter(Boolean) : [];

		const resource: Resource = {
			id: `rw-${doc.id}`,
			type: READWISE_CATEGORY_MAP[doc.category] || "bookmark",
			title: doc.title || "Untitled",
			url: doc.url || undefined,
			author: doc.author || undefined,
			description: doc.summary || undefined,
			tags,
			source: "readwise",
			source_id: doc.id,
			image_url: doc.image_url || undefined,
			reading_progress: doc.reading_progress,
			date_published: doc.published_date || undefined,
			metadata: {
				category: doc.category,
				created_at: doc.created_at,
			},
		};

		upsertResource(db, resource);
		count++;
	}

	return count;
}

// ============================================================================
// Zotero API Types & Sync
// ============================================================================

interface ZoteroCreator {
	creatorType: string;
	firstName?: string;
	lastName?: string;
	name?: string;
}

interface ZoteroTag {
	tag: string;
}

interface ZoteroItemData {
	key: string;
	itemType: string;
	title: string;
	url: string;
	creators: ZoteroCreator[];
	abstractNote: string;
	dateAdded: string;
	date: string;
	publicationTitle: string;
	tags: ZoteroTag[];
}

interface ZoteroItem {
	key: string;
	data: ZoteroItemData;
}

const ZOTERO_TYPE_MAP: Record<string, ResourceType> = {
	journalArticle: "paper",
	conferencePaper: "paper",
	book: "paper",
	bookSection: "paper",
	thesis: "paper",
	report: "paper",
	preprint: "paper",
	webpage: "bookmark",
	blogPost: "article",
	magazineArticle: "article",
	newspaperArticle: "article",
	videoRecording: "video",
	film: "video",
	podcast: "video",
	document: "pdf",
};

function formatZoteroCreators(creators: ZoteroCreator[]): string | undefined {
	if (!creators || creators.length === 0) return undefined;

	const names = creators
		.filter((c) => c.creatorType === "author")
		.map((c) => {
			if (c.name) return c.name;
			if (c.firstName && c.lastName) return `${c.firstName} ${c.lastName}`;
			if (c.lastName) return c.lastName;
			return null;
		})
		.filter(Boolean);

	return names.length > 0 ? names.join(", ") : undefined;
}

async function syncZotero(db: ReturnType<typeof getDb>) {
	if (!ZOTERO_API_KEY || !ZOTERO_USER_ID) {
		console.log("📄 ZOTERO_API_KEY or ZOTERO_USER_ID not set, skipping Zotero sync");
		return 0;
	}

	console.log("📄 Fetching Zotero items...");
	const items: ZoteroItem[] = [];
	let start = 0;
	const limit = 100;

	while (true) {
		const url = `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/top?limit=${limit}&start=${start}&format=json`;

		const response = await fetchWithRetry(url, {
			headers: {
				"Zotero-API-Key": ZOTERO_API_KEY,
				"Zotero-API-Version": "3",
			},
		});

		if (!response.ok) {
			throw new Error(`Zotero API error: ${response.status} ${response.statusText}`);
		}

		const data: ZoteroItem[] = await response.json();
		if (data.length === 0) break;

		items.push(...data);
		start += limit;

		const total = Number.parseInt(response.headers.get("Total-Results") || "0", 10);
		console.log(`  Fetched ${items.length}/${total} items...`);

		if (start >= total) break;
		await delay(ZOTERO_DELAY_MS);
	}

	let count = 0;
	for (const item of items) {
		const data = item.data;
		const itemUrl = data.url || `https://www.zotero.org/users/${ZOTERO_USER_ID}/items/${item.key}`;

		const resource: Resource = {
			id: `zot-${item.key}`,
			type: ZOTERO_TYPE_MAP[data.itemType] || "other",
			title: data.title || "Untitled",
			url: itemUrl,
			author: formatZoteroCreators(data.creators),
			description: data.abstractNote || undefined,
			tags: data.tags?.map((t) => t.tag) || [],
			source: "zotero",
			source_id: item.key,
			item_type: data.itemType,
			publication_title: data.publicationTitle || undefined,
			date_published: data.date || undefined,
			metadata: {
				dateAdded: data.dateAdded,
			},
		};

		upsertResource(db, resource);
		count++;
	}

	return count;
}

// CLI
const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		help: { type: "boolean", short: "h" },
		export: { type: "string", short: "e" },
		stats: { type: "boolean", short: "s" },
		"export-library": { type: "boolean" },
	},
	allowPositionals: true,
});

function printHelp() {
	console.log(`
📦 Knowledge Base Sync CLI

Usage: bun scripts/sync.ts [command] [options]

Commands:
  local       Sync local sources only (books + music) - fast
  api         Sync API sources only (readwise + zotero) - slow, rate limited
  all         Sync everything (local + api)
  
  books       Sync Goodreads books (from CSV)
  music       Sync Spotify tracks (from JSON)
  readwise    Sync Readwise bookmarks/articles (API)
  zotero      Sync Zotero papers (API)

Options:
  -s, --stats           Show database stats
  -e, --export TYPE     Export resources as JSON to stdout (book|track|article|paper|all)
  --export-library      Export library (readwise+zotero) to public/data/library.json
  -h, --help            Show this help

Examples:
  bun sync local              # fast, no API calls
  bun sync api                # slow, hits Readwise + Zotero APIs
  bun sync readwise           # just Readwise
  bun sync --stats            # show what's in the DB
  bun sync --export-library   # regenerate library.json for Astro build
`);
}

async function main() {
	if (values.help) {
		printHelp();
		return;
	}

	const db = getDb();

	if (values.stats) {
		console.log("📊 Database stats:");
		console.table(getStats(db));
		db.close();
		return;
	}

	if (values.export) {
		const type = values.export === "all" ? undefined : (values.export as Resource["type"]);
		console.log(exportAsJson(db, type));
		db.close();
		return;
	}

	if (values["export-library"]) {
		const resources = getLibraryResources(db);
		
		// Transform to frontend format (snake_case → camelCase)
		const frontendResources = resources.map((r) => ({
			id: r.id,
			source: r.source,
			type: r.type,
			title: r.title,
			url: r.url || "",
			author: r.author || null,
			description: r.description || null,
			dateAdded: r.created_at || new Date().toISOString(),
			datePublished: r.date_published || null,
			tags: r.tags || [],
			imageUrl: r.image_url || null,
			readingProgress: r.reading_progress,
			itemType: r.item_type,
			publicationTitle: r.publication_title,
		}));

		const output = {
			fetchedAt: new Date().toISOString(),
			resources: frontendResources,
		};

		const outputPath = "./public/data/library.json";
		writeFileSync(outputPath, JSON.stringify(output, null, 2));
		console.log(`📚 Exported ${resources.length} library resources to ${outputPath}`);
		db.close();
		return;
	}

	const command = positionals[0] || "all";

	console.log("🔄 Starting sync...\n");

	let total = 0;

	switch (command) {
		case "local": {
			const booksCount = await syncBooks(db);
			console.log(`✅ Books: ${booksCount} synced`);
			total += booksCount;
			const musicCount = await syncMusic(db);
			console.log(`✅ Music: ${musicCount} synced`);
			total += musicCount;
			break;
		}
		case "api": {
			const rwCount = await syncReadwise(db);
			console.log(`✅ Readwise: ${rwCount} synced`);
			total += rwCount;
			const zotCount = await syncZotero(db);
			console.log(`✅ Zotero: ${zotCount} synced`);
			total += zotCount;
			break;
		}
		case "all": {
			const booksCount = await syncBooks(db);
			console.log(`✅ Books: ${booksCount} synced`);
			total += booksCount;
			const musicCount = await syncMusic(db);
			console.log(`✅ Music: ${musicCount} synced`);
			total += musicCount;
			const rwCount = await syncReadwise(db);
			console.log(`✅ Readwise: ${rwCount} synced`);
			total += rwCount;
			const zotCount = await syncZotero(db);
			console.log(`✅ Zotero: ${zotCount} synced`);
			total += zotCount;
			break;
		}
		case "books": {
			total = await syncBooks(db);
			console.log(`✅ Books: ${total} synced`);
			break;
		}
		case "music": {
			total = await syncMusic(db);
			console.log(`✅ Music: ${total} synced`);
			break;
		}
		case "readwise": {
			total = await syncReadwise(db);
			console.log(`✅ Readwise: ${total} synced`);
			break;
		}
		case "zotero": {
			total = await syncZotero(db);
			console.log(`✅ Zotero: ${total} synced`);
			break;
		}
		default:
			console.log(`Unknown command: ${command}`);
			printHelp();
	}

	console.log(`\n📊 Total: ${total} resources synced`);
	db.close();
}

main();
