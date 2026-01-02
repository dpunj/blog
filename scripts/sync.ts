import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
	exportAsJson,
	getDb,
	getLibraryResources,
	getNowResources,
	getStats,
	type Resource,
	type ResourceType,
	upsertResource,
} from "./db";

// ============================================================================
// Environment & Rate Limiting
// ============================================================================

const READWISE_TOKEN = process.env.READWISE_TOKEN;
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;
const LETTERBOXD_USERNAME = process.env.LETTERBOXD_USERNAME;
const RAWG_API_KEY = process.env.RAWG_API_KEY;
const RAWG_USERNAME = process.env.RAWG_USERNAME;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const READWISE_DELAY_MS = 3500; // ~17 requests/minute (limit is 20)
const ZOTERO_DELAY_MS = 1100; // 1 request/sec per API guidance
const MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const nextChar = line[i + 1];

		if (char === '"' && !inQuotes) {
			inQuotes = true;
		} else if (char === '"' && inQuotes) {
			if (nextChar === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = false;
			}
		} else if (char === "," && !inQuotes) {
			result.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	result.push(current.trim());
	return result;
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
	const lines = text.split("\n");
	if (lines.length < 2) return 0;

	// Parse header to get column indices
	const headers = parseCSVLine(lines[0]);
	const colIndex = (name: string) => headers.indexOf(name);

	let count = 0;

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const fields = parseCSVLine(line);

		const title = fields[colIndex("Title")];
		const author = fields[colIndex("Author")];
		const rating = fields[colIndex("My Rating")];
		const dateRead = fields[colIndex("Date Read")];
		const bookshelves = fields[colIndex("Bookshelves")];
		const exclusiveShelf = fields[colIndex("Exclusive Shelf")];
		const review = fields[colIndex("My Review")];
		const bookId = fields[colIndex("Book Id")];

		if (!title) continue;

		// Use Exclusive Shelf for status (this is the primary shelf)
		let platformStatus: string | undefined;
		let status: Resource["status"];

		const shelf = exclusiveShelf?.toLowerCase().trim();
		if (shelf === "currently-reading") {
			platformStatus = "currently-reading";
			status = "now";
		} else if (shelf === "to-read") {
			platformStatus = "to-read";
			status = undefined;
		} else if (shelf === "read") {
			platformStatus = "read";
			status = "done";
		}

		const resource: Resource = {
			id: `goodreads-${bookId || Buffer.from(title + author).toString("base64url").slice(0, 16)}`,
			type: "book",
			title,
			author,
			description: review || undefined,
			tags:
				bookshelves
					?.split(",")
					.map((s) => s.trim())
					.filter(Boolean) || [],
			source: "goodreads",
			source_id: bookId || title,
			platform_status: platformStatus,
			status,
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
			throw new Error(
				`Readwise API error: ${response.status} ${response.statusText}`,
			);
		}

		const data: ReadwiseResponse = await response.json();
		docs.push(...data.results);
		cursor = data.nextPageCursor;

		console.log(`  Fetched ${docs.length} documents...`);

		if (cursor) await delay(READWISE_DELAY_MS);
	} while (cursor);

	let count = 0;
	for (const doc of docs) {
		const tags = Array.isArray(doc.tags)
			? doc.tags.map((t) => t.name).filter(Boolean)
			: [];

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
		console.log(
			"📄 ZOTERO_API_KEY or ZOTERO_USER_ID not set, skipping Zotero sync",
		);
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
			throw new Error(
				`Zotero API error: ${response.status} ${response.statusText}`,
			);
		}

		const data: ZoteroItem[] = await response.json();
		if (data.length === 0) break;

		items.push(...data);
		start += limit;

		const total = Number.parseInt(
			response.headers.get("Total-Results") || "0",
			10,
		);
		console.log(`  Fetched ${items.length}/${total} items...`);

		if (start >= total) break;
		await delay(ZOTERO_DELAY_MS);
	}

	let count = 0;
	for (const item of items) {
		const data = item.data;
		const itemUrl =
			data.url ||
			`https://www.zotero.org/users/${ZOTERO_USER_ID}/items/${item.key}`;

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

// ============================================================================
// Letterboxd RSS Sync
// ============================================================================

interface LetterboxdItem {
	title: string;
	link: string;
	filmTitle: string;
	filmYear: string;
	memberRating?: string;
	watchedDate?: string;
}

function parseLetterboxdRss(xml: string): LetterboxdItem[] {
	const items: LetterboxdItem[] = [];
	const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

	for (const itemXml of itemMatches) {
		const getTag = (tag: string) => {
			const match = itemXml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
			return match
				? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim()
				: "";
		};

		const getLetterboxdTag = (tag: string) => {
			const match = itemXml.match(
				new RegExp(`<letterboxd:${tag}>([\\s\\S]*?)</letterboxd:${tag}>`),
			);
			return match ? match[1].trim() : undefined;
		};

		items.push({
			title: getTag("title"),
			link: getTag("link"),
			filmTitle:
				getLetterboxdTag("filmTitle") ||
				getTag("title").replace(/, \d{4}.*$/, ""),
			filmYear: getLetterboxdTag("filmYear") || "",
			memberRating: getLetterboxdTag("memberRating"),
			watchedDate: getLetterboxdTag("watchedDate"),
		});
	}

	return items;
}

async function syncLetterboxd(db: ReturnType<typeof getDb>) {
	if (!LETTERBOXD_USERNAME) {
		console.log("🎬 LETTERBOXD_USERNAME not set, skipping Letterboxd sync");
		return 0;
	}

	console.log("🎬 Fetching Letterboxd data...");
	let count = 0;

	// Fetch diary (watched movies)
	const diaryUrl = `https://letterboxd.com/${LETTERBOXD_USERNAME}/rss/`;
	const diaryResponse = await fetch(diaryUrl);
	if (diaryResponse.ok) {
		const diaryXml = await diaryResponse.text();
		const diaryItems = parseLetterboxdRss(diaryXml);
		console.log(`  Fetched ${diaryItems.length} diary entries...`);

		for (const item of diaryItems) {
			const resource: Resource = {
				id: `lb-diary-${Buffer.from(item.filmTitle + item.filmYear)
					.toString("base64url")
					.slice(0, 16)}`,
				type: "movie",
				title: item.filmTitle,
				url: item.link,
				source: "letterboxd",
				source_id: item.link,
				platform_status: "watched",
				status: "done",
				metadata: {
					year: item.filmYear,
					rating: item.memberRating
						? Number.parseFloat(item.memberRating)
						: undefined,
					watchedDate: item.watchedDate,
				},
			};
			upsertResource(db, resource);
			count++;
		}
	}

	// Fetch watchlist
	const watchlistUrl = `https://letterboxd.com/${LETTERBOXD_USERNAME}/watchlist/rss/`;
	const watchlistResponse = await fetch(watchlistUrl);
	if (watchlistResponse.ok) {
		const watchlistXml = await watchlistResponse.text();
		const watchlistItems = parseLetterboxdRss(watchlistXml);
		console.log(`  Fetched ${watchlistItems.length} watchlist entries...`);

		for (const item of watchlistItems) {
			const resource: Resource = {
				id: `lb-wl-${Buffer.from(item.filmTitle + item.filmYear)
					.toString("base64url")
					.slice(0, 16)}`,
				type: "movie",
				title: item.filmTitle,
				url: item.link,
				source: "letterboxd",
				source_id: item.link,
				platform_status: "watchlist",
				status: undefined,
				metadata: {
					year: item.filmYear,
				},
			};
			upsertResource(db, resource);
			count++;
		}
	}

	return count;
}

// ============================================================================
// RAWG API Sync
// ============================================================================

interface RawgGame {
	id: number;
	slug: string;
	name: string;
	background_image: string | null;
	released: string | null;
	user_game: {
		status: string | null;
	} | null;
}

interface RawgResponse {
	count: number;
	next: string | null;
	results: RawgGame[];
}

const RAWG_STATUS_MAP: Record<string, Resource["status"]> = {
	playing: "now",
	owned: undefined,
	backlog: undefined,
	beaten: "done",
	completed: "done",
	dropped: "dropped",
};

async function syncRawg(db: ReturnType<typeof getDb>) {
	if (!RAWG_API_KEY || !RAWG_USERNAME) {
		console.log("🎮 RAWG_API_KEY or RAWG_USERNAME not set, skipping RAWG sync");
		return 0;
	}

	console.log("🎮 Fetching RAWG game collection...");
	const games: RawgGame[] = [];
	let nextUrl: string | null =
		`https://api.rawg.io/api/users/${RAWG_USERNAME}/games?key=${RAWG_API_KEY}`;

	while (nextUrl) {
		const response = await fetch(nextUrl);
		if (!response.ok) {
			throw new Error(
				`RAWG API error: ${response.status} ${response.statusText}`,
			);
		}

		const data: RawgResponse = await response.json();
		games.push(...data.results);
		nextUrl = data.next;

		console.log(`  Fetched ${games.length}/${data.count} games...`);

		if (nextUrl) await delay(500);
	}

	let count = 0;
	for (const game of games) {
		const platformStatus = game.user_game?.status || undefined;
		const status = platformStatus ? RAWG_STATUS_MAP[platformStatus] : undefined;

		const resource: Resource = {
			id: `rawg-${game.id}`,
			type: "game",
			title: game.name,
			url: `https://rawg.io/games/${game.slug}`,
			source: "rawg",
			source_id: String(game.id),
			image_url: game.background_image || undefined,
			platform_status: platformStatus,
			status,
			date_published: game.released || undefined,
			metadata: {},
		};

		upsertResource(db, resource);
		count++;
	}

	return count;
}

// ============================================================================
// TMDB API Types & Functions
// ============================================================================

interface TmdbMovie {
	id: number;
	title: string;
	overview: string;
	poster_path: string | null;
	backdrop_path: string | null;
	release_date: string;
	vote_average: number;
}

interface TmdbSearchResponse {
	results: TmdbMovie[];
	total_results: number;
}

async function tmdbSearch(query: string): Promise<TmdbMovie[]> {
	if (!TMDB_API_KEY) {
		console.log("❌ TMDB_API_KEY not set");
		return [];
	}

	const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
	}

	const data: TmdbSearchResponse = await response.json();
	return data.results.slice(0, 10);
}

async function tmdbGetMovie(id: number): Promise<TmdbMovie | null> {
	if (!TMDB_API_KEY) {
		console.log("❌ TMDB_API_KEY not set");
		return null;
	}

	const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`;
	const response = await fetch(url);

	if (!response.ok) {
		if (response.status === 404) return null;
		throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
	}

	return response.json();
}

function tmdbMovieToResource(movie: TmdbMovie, status: "now" | "next" = "next"): Resource {
	const posterUrl = movie.poster_path
		? `https://image.tmdb.org/t/p/w200${movie.poster_path}`
		: undefined;

	return {
		id: `tmdb-${movie.id}`,
		type: "movie",
		title: movie.title,
		url: `https://www.themoviedb.org/movie/${movie.id}`,
		description: movie.overview || undefined,
		source: "tmdb",
		source_id: String(movie.id),
		image_url: posterUrl,
		platform_status: undefined,
		status,
		status_manual: 1,
		date_published: movie.release_date || undefined,
		metadata: {
			vote_average: movie.vote_average,
		},
	};
}

async function tmdbSearchAndAdd(db: ReturnType<typeof getDb>, query: string, status: "now" | "next" = "next") {
	console.log(`🔍 Searching TMDB for "${query}"...`);
	const results = await tmdbSearch(query);

	if (results.length === 0) {
		console.log("  No results found.");
		return;
	}

	console.log("\n  Results:");
	for (let i = 0; i < results.length; i++) {
		const m = results[i];
		const year = m.release_date?.split("-")[0] || "????";
		console.log(`  ${i + 1}. ${m.title} (${year}) - ID: ${m.id}`);
	}

	console.log(`\n  To add a movie, run: bun sync tmdb add <id>`);
	console.log(`  Example: bun sync tmdb add ${results[0].id}`);
}

async function tmdbAddById(db: ReturnType<typeof getDb>, id: number, status: "now" | "next" = "next") {
	console.log(`🎬 Fetching movie ${id} from TMDB...`);
	const movie = await tmdbGetMovie(id);

	if (!movie) {
		console.log(`  Movie with ID ${id} not found.`);
		return;
	}

	const resource = tmdbMovieToResource(movie, status);
	upsertResource(db, resource);

	const year = movie.release_date?.split("-")[0] || "????";
	console.log(`✅ Added "${movie.title}" (${year}) to queue with status: ${status}`);
}

// CLI
const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		help: { type: "boolean", short: "h" },
		export: { type: "string", short: "e" },
		stats: { type: "boolean", short: "s" },
		"export-library": { type: "boolean" },
		"export-now": { type: "boolean" },
	},
	allowPositionals: true,
});

function printHelp() {
	console.log(`
📦 Knowledge Base Sync CLI

Usage: bun scripts/sync.ts [command] [options]

Commands:
  local       Sync local sources only (books + music) - fast
  api         Sync API sources only (readwise + zotero + letterboxd + rawg) - slow, rate limited
  all         Sync everything (local + api)
  
  books       Sync Goodreads books (from CSV)
  music       Sync Spotify tracks (from JSON)
  readwise    Sync Readwise bookmarks/articles (API)
  zotero      Sync Zotero papers (API)
  letterboxd  Sync Letterboxd movies (RSS)
  rawg        Sync RAWG games (API)

  tmdb search "query"     Search TMDB for movies
  tmdb add <id>           Add movie to queue (status: next)
  tmdb add <id> now       Add movie as currently watching

Options:
  -s, --stats           Show database stats
  -e, --export TYPE     Export resources as JSON to stdout (book|track|movie|game|article|paper|all)
  --export-library      Export library (readwise+zotero) to public/data/library.json
  --export-now          Export now queue to public/data/now.json
  -h, --help            Show this help

Examples:
  bun sync local              # fast, no API calls
  bun sync api                # slow, hits Readwise + Zotero + Letterboxd + RAWG APIs
  bun sync readwise           # just Readwise
  bun sync letterboxd         # just Letterboxd
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
		const type =
			values.export === "all" ? undefined : (values.export as Resource["type"]);
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
		console.log(
			`📚 Exported ${resources.length} library resources to ${outputPath}`,
		);
		db.close();
		return;
	}

	if (values["export-now"]) {
		const resources = getNowResources(db);

		// Transform to frontend format
		const frontendResources = resources.map((r) => ({
			id: r.id,
			source: r.source,
			type: r.type,
			title: r.title,
			url: r.url || "",
			author: r.author || null,
			description: r.description || null,
			imageUrl: r.image_url || null,
			status: r.status,
			queuePriority: r.queue_priority,
			platformStatus: r.platform_status,
			favorited: r.favorited === 1,
			rating: r.rating || null,
		}));

		const output = {
			exportedAt: new Date().toISOString(),
			resources: frontendResources,
		};

		const outputPath = "./public/data/now.json";
		writeFileSync(outputPath, JSON.stringify(output, null, 2));
		console.log(
			`🎯 Exported ${resources.length} now queue resources to ${outputPath}`,
		);
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
			const lbCount = await syncLetterboxd(db);
			console.log(`✅ Letterboxd: ${lbCount} synced`);
			total += lbCount;
			const rawgCount = await syncRawg(db);
			console.log(`✅ RAWG: ${rawgCount} synced`);
			total += rawgCount;
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
			const lbCount = await syncLetterboxd(db);
			console.log(`✅ Letterboxd: ${lbCount} synced`);
			total += lbCount;
			const rawgCount = await syncRawg(db);
			console.log(`✅ RAWG: ${rawgCount} synced`);
			total += rawgCount;
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
		case "letterboxd": {
			total = await syncLetterboxd(db);
			console.log(`✅ Letterboxd: ${total} synced`);
			break;
		}
		case "rawg": {
			total = await syncRawg(db);
			console.log(`✅ RAWG: ${total} synced`);
			break;
		}
		case "tmdb": {
			const subcommand = positionals[1];
			if (subcommand === "search") {
				const query = positionals.slice(2).join(" ");
				if (!query) {
					console.log("Usage: bun sync tmdb search \"movie title\"");
					break;
				}
				await tmdbSearchAndAdd(db, query);
			} else if (subcommand === "add") {
				const id = Number.parseInt(positionals[2], 10);
				if (Number.isNaN(id)) {
					console.log("Usage: bun sync tmdb add <id> [now|next]");
					break;
				}
				const status = positionals[3] === "now" ? "now" : "next";
				await tmdbAddById(db, id, status);
			} else {
				console.log("TMDB commands:");
				console.log('  bun sync tmdb search "movie title"');
				console.log("  bun sync tmdb add <id> [now|next]");
			}
			db.close();
			return;
		}
		default:
			console.log(`Unknown command: ${command}`);
			printHelp();
	}

	console.log(`\n📊 Total: ${total} resources synced`);
	db.close();
}

main();
