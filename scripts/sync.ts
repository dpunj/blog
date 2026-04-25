import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
	exportAsJson,
	getDb,
	getLibraryResources,
	getNowResources,
	getStats,
	getSyncState,
	type Resource,
	type ResourceType,
	saveSyncState,
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
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const READWISE_DELAY_MS = 3500; // ~17 requests/minute (limit is 20)
const ZOTERO_DELAY_MS = 1100; // 1 request/sec per API guidance
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRY_WAIT_MS = 120_000;
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
	return new Date().toISOString();
}

function formatDuration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

function normalizeIsoDate(value?: string | null): string | undefined {
	if (!value) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function withOverlap(timestamp?: string): string | undefined {
	if (!timestamp) return undefined;
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return timestamp;
	return new Date(date.getTime() - INCREMENTAL_OVERLAP_MS).toISOString();
}

function sanitizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return url.split("?")[0];
	}
}

function parseRetryAfter(header: string | null): number | undefined {
	if (!header) return undefined;
	const seconds = Number.parseInt(header, 10);
	if (!Number.isNaN(seconds)) return seconds * 1000;

	const date = new Date(header);
	if (!Number.isNaN(date.getTime())) {
		return Math.max(0, date.getTime() - Date.now());
	}

	return undefined;
}

function getRetryWaitMs(
	response: Response | undefined,
	attempt: number,
): number {
	const retryAfter = parseRetryAfter(
		response?.headers.get("Retry-After") ?? null,
	);
	if (retryAfter !== undefined) return Math.min(retryAfter, MAX_RETRY_WAIT_MS);

	const exponential = Math.min(2 ** attempt * 1000, 30_000);
	const jitter = Math.floor(Math.random() * 1000);
	return Math.min(exponential + jitter, MAX_RETRY_WAIT_MS);
}

function isRetryableStatus(status: number): boolean {
	return [408, 429, 500, 502, 503, 504].includes(status);
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
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});

			if (!isRetryableStatus(response.status) || attempt === retries) {
				return response;
			}

			const waitMs = getRetryWaitMs(response, attempt);
			console.log(
				`  ${response.status} from ${sanitizeUrl(url)}; retry ${attempt + 1}/${retries} in ${formatDuration(waitMs)}`,
			);
			await delay(waitMs);
		} catch (error) {
			if (attempt === retries) throw error;

			const waitMs = getRetryWaitMs(undefined, attempt);
			const message = error instanceof Error ? error.message : String(error);
			console.log(
				`  Request failed for ${sanitizeUrl(url)} (${message}); retry ${attempt + 1}/${retries} in ${formatDuration(waitMs)}`,
			);
			await delay(waitMs);
		} finally {
			clearTimeout(timeout);
		}
	}

	throw new Error(
		`Request failed after ${retries + 1} attempts: ${sanitizeUrl(url)}`,
	);
}

async function requireOk(response: Response, source: string): Promise<void> {
	if (response.ok) return;

	const body = await response.text().catch(() => "");
	const detail = body ? ` — ${body.slice(0, 500)}` : "";
	throw new Error(
		`${source} API error: ${response.status} ${response.statusText}${detail}`,
	);
}

function upsertResourceBatch(
	db: ReturnType<typeof getDb>,
	resources: Resource[],
): void {
	const insertMany = db.transaction((batch: Resource[]) => {
		for (const resource of batch) upsertResource(db, resource);
	});
	insertMany(resources);
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
		const isbn = fields[colIndex("ISBN")]?.replace(/[="]/g, "");
		const isbn13 = fields[colIndex("ISBN13")]?.replace(/[="]/g, "");

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

		// Get book cover from Open Library (ISBN-based, free API)
		const coverIsbn = isbn13 || isbn;
		const imageUrl = coverIsbn
			? `https://covers.openlibrary.org/b/isbn/${coverIsbn}-L.jpg`
			: undefined;

		const resource: Resource = {
			id: `goodreads-${
				bookId ||
				Buffer.from(title + author)
					.toString("base64url")
					.slice(0, 16)
			}`,
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
			image_url: imageUrl,
			metadata: {
				rating: Number.parseInt(rating, 10) || 0,
				dateRead: dateRead || null,
				isbn: coverIsbn || null,
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
	updated_at?: string | null;
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

interface ReadwiseSyncOptions {
	full?: boolean;
	since?: string;
}

function readwiseDocToResource(
	doc: ReadwiseDocument,
	seenAt: string,
): Resource {
	const tags = Array.isArray(doc.tags)
		? doc.tags.map((t) => t.name).filter(Boolean)
		: [];

	return {
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
		date_published: normalizeIsoDate(doc.published_date),
		source_created_at: normalizeIsoDate(doc.created_at),
		source_updated_at: normalizeIsoDate(doc.updated_at),
		last_seen_at: seenAt,
		metadata: {
			category: doc.category,
			created_at: doc.created_at,
			updated_at: doc.updated_at ?? null,
		},
	};
}

async function syncReadwise(
	db: ReturnType<typeof getDb>,
	options: ReadwiseSyncOptions = {},
) {
	if (!READWISE_TOKEN) {
		console.log("📚 READWISE_TOKEN not set, skipping Readwise sync");
		return 0;
	}

	const startedAt = nowIso();
	const startedMs = Date.now();
	const state = getSyncState(db, "readwise");
	const incrementalSince = options.full
		? undefined
		: withOverlap(
				options.since || state?.high_water_mark || state?.last_success_at,
			);

	console.log("📚 Fetching Readwise documents...");
	console.log(
		incrementalSince
			? `  Mode: incremental since ${incrementalSince}`
			: "  Mode: full sync",
	);

	let cursor: string | null = null;
	let count = 0;
	let page = 0;
	let latestSourceUpdate: string | undefined;

	do {
		const url = new URL("https://readwise.io/api/v3/list/");
		if (cursor) url.searchParams.set("pageCursor", cursor);
		if (incrementalSince)
			url.searchParams.set("updatedAfter", incrementalSince);

		const response = await fetchWithRetry(url.toString(), {
			headers: { Authorization: `Token ${READWISE_TOKEN}` },
		});
		await requireOk(response, "Readwise");

		const data: ReadwiseResponse = await response.json();
		const resources = data.results.map((doc) => {
			const updatedAt =
				normalizeIsoDate(doc.updated_at) || normalizeIsoDate(doc.created_at);
			if (
				updatedAt &&
				(!latestSourceUpdate || updatedAt > latestSourceUpdate)
			) {
				latestSourceUpdate = updatedAt;
			}
			return readwiseDocToResource(doc, startedAt);
		});

		if (resources.length > 0) upsertResourceBatch(db, resources);

		cursor = data.nextPageCursor;
		count += resources.length;
		page++;

		console.log(
			`  Page ${page}: ${resources.length} docs (${count} total, ${formatDuration(Date.now() - startedMs)}, ${cursor ? "more" : "done"})`,
		);

		if (cursor) await delay(READWISE_DELAY_MS);
	} while (cursor);

	saveSyncState(db, {
		source: "readwise",
		last_started_at: startedAt,
		last_success_at: nowIso(),
		high_water_mark: startedAt,
		metadata: {
			count,
			full: !incrementalSince,
			latestSourceUpdate: latestSourceUpdate ?? null,
			durationMs: Date.now() - startedMs,
		},
	});

	console.log(
		`  Saved Readwise sync state (${count} docs, ${formatDuration(Date.now() - startedMs)})`,
	);
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
	dateModified?: string;
	date: string;
	publicationTitle: string;
	contentType?: string;
	filename?: string;
	tags: ZoteroTag[];
}

interface ZoteroItem {
	key: string;
	version?: number;
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

function formatZoteroCreatorName(creator: ZoteroCreator): string | null {
	if (creator.name) return creator.name;
	if (creator.firstName && creator.lastName) {
		return `${creator.firstName} ${creator.lastName}`;
	}
	if (creator.lastName) return creator.lastName;
	return null;
}

function formatZoteroCreators(creators: ZoteroCreator[]): string | undefined {
	if (!creators || creators.length === 0) return undefined;

	const authors = creators
		.filter((c) => c.creatorType === "author")
		.map(formatZoteroCreatorName)
		.filter(Boolean);
	const fallbackCreators = creators
		.map(formatZoteroCreatorName)
		.filter(Boolean);
	const names = authors.length > 0 ? authors : fallbackCreators;

	return names.length > 0 ? names.join(", ") : undefined;
}

interface ZoteroSyncOptions {
	full?: boolean;
}

function getZoteroResourceType(data: ZoteroItemData): ResourceType {
	if (
		data.itemType === "attachment" &&
		data.contentType === "application/pdf"
	) {
		return "pdf";
	}

	return ZOTERO_TYPE_MAP[data.itemType] || "other";
}

function zoteroItemToResource(item: ZoteroItem, seenAt: string): Resource {
	const data = item.data;
	const itemUrl =
		data.url ||
		`https://www.zotero.org/users/${ZOTERO_USER_ID}/items/${item.key}`;

	return {
		id: `zot-${item.key}`,
		type: getZoteroResourceType(data),
		title: data.title || data.filename || "Untitled",
		url: itemUrl,
		author: formatZoteroCreators(data.creators),
		description: data.abstractNote || undefined,
		tags: data.tags?.map((t) => t.tag).filter(Boolean) || [],
		source: "zotero",
		source_id: item.key,
		item_type: data.itemType,
		publication_title: data.publicationTitle || undefined,
		date_published: normalizeIsoDate(data.date),
		source_created_at: normalizeIsoDate(data.dateAdded),
		source_updated_at: normalizeIsoDate(data.dateModified),
		last_seen_at: seenAt,
		metadata: {
			dateAdded: data.dateAdded,
			dateModified: data.dateModified ?? null,
			version: item.version ?? null,
			contentType: data.contentType ?? null,
			filename: data.filename ?? null,
		},
	};
}

async function syncZotero(
	db: ReturnType<typeof getDb>,
	options: ZoteroSyncOptions = {},
) {
	if (!ZOTERO_API_KEY || !ZOTERO_USER_ID) {
		console.log(
			"📄 ZOTERO_API_KEY or ZOTERO_USER_ID not set, skipping Zotero sync",
		);
		return 0;
	}

	const startedAt = nowIso();
	const startedMs = Date.now();
	const state = getSyncState(db, "zotero");
	const sinceVersion = options.full ? undefined : state?.version;

	console.log("📄 Fetching Zotero items...");
	console.log(
		sinceVersion
			? `  Mode: incremental since library version ${sinceVersion}`
			: "  Mode: full sync",
	);

	let start = 0;
	const limit = 100;
	let count = 0;
	let latestVersion = sinceVersion;

	while (true) {
		const url = new URL(
			`https://api.zotero.org/users/${ZOTERO_USER_ID}/items/top`,
		);
		url.searchParams.set("limit", String(limit));
		url.searchParams.set("start", String(start));
		url.searchParams.set("format", "json");
		if (sinceVersion) url.searchParams.set("since", String(sinceVersion));

		const response = await fetchWithRetry(url.toString(), {
			headers: {
				"Zotero-API-Key": ZOTERO_API_KEY,
				"Zotero-API-Version": "3",
			},
		});
		await requireOk(response, "Zotero");

		const headerVersion = Number.parseInt(
			response.headers.get("Last-Modified-Version") || "",
			10,
		);
		if (!Number.isNaN(headerVersion)) latestVersion = headerVersion;

		const total = Number.parseInt(
			response.headers.get("Total-Results") || "0",
			10,
		);
		const data: ZoteroItem[] = await response.json();
		if (data.length === 0) {
			console.log(
				`  No Zotero changes (${formatDuration(Date.now() - startedMs)})`,
			);
			break;
		}

		const resources = data.map((item) => zoteroItemToResource(item, startedAt));
		upsertResourceBatch(db, resources);

		count += resources.length;
		start += limit;
		console.log(
			`  Fetched ${count}/${total} items (version ${latestVersion ?? "unknown"}, ${formatDuration(Date.now() - startedMs)})`,
		);

		if (start >= total) break;
		await delay(ZOTERO_DELAY_MS);
	}

	saveSyncState(db, {
		source: "zotero",
		last_started_at: startedAt,
		last_success_at: nowIso(),
		version: latestVersion,
		metadata: {
			count,
			full: !sinceVersion,
			durationMs: Date.now() - startedMs,
		},
	});

	console.log(
		`  Saved Zotero sync state (${count} items, ${formatDuration(Date.now() - startedMs)})`,
	);
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
		throw new Error(
			`TMDB API error: ${response.status} ${response.statusText}`,
		);
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
		throw new Error(
			`TMDB API error: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

function tmdbMovieToResource(
	movie: TmdbMovie,
	status: "now" | "next" = "next",
): Resource {
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

async function tmdbSearchAndAdd(
	_db: ReturnType<typeof getDb>,
	query: string,
	_status: "now" | "next" = "next",
) {
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

async function tmdbAddById(
	db: ReturnType<typeof getDb>,
	id: number,
	status: "now" | "next" = "next",
) {
	console.log(`🎬 Fetching movie ${id} from TMDB...`);
	const movie = await tmdbGetMovie(id);

	if (!movie) {
		console.log(`  Movie with ID ${id} not found.`);
		return;
	}

	const resource = tmdbMovieToResource(movie, status);
	upsertResource(db, resource);

	const year = movie.release_date?.split("-")[0] || "????";
	console.log(
		`✅ Added "${movie.title}" (${year}) to queue with status: ${status}`,
	);
}

// ============================================================================
// Spotify API Types & Functions (Albums)
// ============================================================================

interface SpotifyAlbum {
	id: string;
	name: string;
	artists: { name: string }[];
	images: { url: string; width: number }[];
	release_date: string;
	total_tracks: number;
	external_urls: { spotify: string };
}

interface SpotifySearchResponse {
	albums: {
		items: SpotifyAlbum[];
	};
}

let spotifyAccessToken: string | null = null;

async function getSpotifyToken(): Promise<string | null> {
	if (spotifyAccessToken) return spotifyAccessToken;

	if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
		console.log("❌ SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set");
		return null;
	}

	const response = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
		},
		body: "grant_type=client_credentials",
	});

	if (!response.ok) {
		throw new Error(
			`Spotify auth error: ${response.status} ${response.statusText}`,
		);
	}

	const data = await response.json();
	spotifyAccessToken = data.access_token;
	return spotifyAccessToken;
}

async function spotifySearchAlbums(query: string): Promise<SpotifyAlbum[]> {
	const token = await getSpotifyToken();
	if (!token) return [];

	const url = `https://api.spotify.com/v1/search?type=album&limit=10&q=${encodeURIComponent(query)}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		throw new Error(
			`Spotify API error: ${response.status} ${response.statusText}`,
		);
	}

	const data: SpotifySearchResponse = await response.json();
	return data.albums.items;
}

async function spotifyGetAlbum(id: string): Promise<SpotifyAlbum | null> {
	const token = await getSpotifyToken();
	if (!token) return null;

	const url = `https://api.spotify.com/v1/albums/${id}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		if (response.status === 404) return null;
		throw new Error(
			`Spotify API error: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

function spotifyAlbumToResource(
	album: SpotifyAlbum,
	status: "now" | "next" = "next",
): Resource {
	const imageUrl =
		album.images.find((img) => img.width === 300)?.url ||
		album.images[0]?.url ||
		undefined;

	return {
		id: `spotify-album-${album.id}`,
		type: "album",
		title: album.name,
		author: album.artists.map((a) => a.name).join(", "),
		url: album.external_urls.spotify,
		source: "spotify",
		source_id: album.id,
		image_url: imageUrl,
		platform_status: undefined,
		status,
		status_manual: 1,
		date_published: album.release_date || undefined,
		metadata: {
			total_tracks: album.total_tracks,
		},
	};
}

async function albumSearch(_db: ReturnType<typeof getDb>, query: string) {
	console.log(`🔍 Searching Spotify for "${query}"...`);
	const results = await spotifySearchAlbums(query);

	if (results.length === 0) {
		console.log("  No results found.");
		return;
	}

	console.log("\n  Results:");
	for (let i = 0; i < results.length; i++) {
		const a = results[i];
		const year = a.release_date?.split("-")[0] || "????";
		const artists = a.artists.map((x) => x.name).join(", ");
		console.log(`  ${i + 1}. ${a.name} — ${artists} (${year}) - ID: ${a.id}`);
	}

	console.log(`\n  To add an album, run: bun sync album add <id>`);
	console.log(`  Example: bun sync album add ${results[0].id}`);
}

async function albumAddById(
	db: ReturnType<typeof getDb>,
	id: string,
	status: "now" | "next" = "next",
) {
	console.log(`🎵 Fetching album ${id} from Spotify...`);
	const album = await spotifyGetAlbum(id);

	if (!album) {
		console.log(`  Album with ID ${id} not found.`);
		return;
	}

	const resource = spotifyAlbumToResource(album, status);
	upsertResource(db, resource);

	const year = album.release_date?.split("-")[0] || "????";
	const artists = album.artists.map((a) => a.name).join(", ");
	console.log(
		`✅ Added "${album.name}" by ${artists} (${year}) to queue with status: ${status}`,
	);
}

// ============================================================================
// Export helpers
// ============================================================================

function atomicWriteJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
	renameSync(tempPath, path);
}

function exportLibrary(db: ReturnType<typeof getDb>): number {
	const resources = getLibraryResources(db);

	const frontendResources = resources.map((r) => ({
		id: r.id,
		source: r.source,
		type: r.type,
		title: r.title,
		url: r.url || "",
		author: r.author || null,
		description: r.description || null,
		dateAdded:
			normalizeIsoDate(r.source_created_at) ||
			normalizeIsoDate(r.created_at) ||
			nowIso(),
		datePublished: normalizeIsoDate(r.date_published) || null,
		tags: r.tags || [],
		imageUrl: r.image_url || null,
		readingProgress: r.reading_progress,
		itemType: r.item_type,
		publicationTitle: r.publication_title,
	}));

	atomicWriteJson("./public/data/library.json", {
		fetchedAt: nowIso(),
		resources: frontendResources,
	});
	console.log(
		`📚 Exported ${resources.length} library resources to ./public/data/library.json`,
	);
	return resources.length;
}

function exportNow(db: ReturnType<typeof getDb>): number {
	const resources = getNowResources(db);

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

	atomicWriteJson("./public/data/now.json", {
		exportedAt: nowIso(),
		resources: frontendResources,
	});
	console.log(
		`🎯 Exported ${resources.length} now queue resources to ./public/data/now.json`,
	);
	return resources.length;
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
		full: { type: "boolean" },
		since: { type: "string" },
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

  album search "query"    Search Spotify for albums
  album add <id>          Add album to queue (status: next)
  album add <id> now      Add album as currently listening

Options:
  -s, --stats           Show database stats
  -e, --export TYPE     Export resources as JSON to stdout (book|track|movie|game|article|paper|all)
  --export-library      Export library (readwise+zotero) to public/data/library.json
  --export-now          Export now queue to public/data/now.json
  --full                Ignore saved sync state and fetch all Readwise/Zotero records
  --since ISO_DATE      Override Readwise incremental start timestamp
  -h, --help            Show this help

Examples:
  bun sync local                         # fast, no API calls
  bun sync api --export-library          # sync APIs, then regenerate library.json
  bun sync readwise                      # incremental Readwise sync after first successful run
  bun sync readwise --full               # full Readwise backfill
  bun sync readwise --since 2026-04-01   # Readwise changes since a timestamp/date
  bun sync zotero                        # incremental Zotero sync after first successful run
  bun sync letterboxd                    # just Letterboxd
  bun sync --stats                       # show what's in the DB
  bun sync --export-library              # export only, no sync
`);
}

async function main() {
	if (values.help) {
		printHelp();
		return;
	}

	const db = getDb();
	const hasCommand = positionals.length > 0;
	const command = positionals[0] || "all";

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

	if (values["export-library"] && !hasCommand) {
		exportLibrary(db);
		db.close();
		return;
	}

	if (values["export-now"] && !hasCommand) {
		exportNow(db);
		db.close();
		return;
	}

	console.log("🔄 Starting sync...\n");

	const fullSync = values.full === true;
	const since = typeof values.since === "string" ? values.since : undefined;
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
			const rwCount = await syncReadwise(db, { full: fullSync, since });
			console.log(`✅ Readwise: ${rwCount} synced`);
			total += rwCount;
			const zotCount = await syncZotero(db, { full: fullSync });
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
			const rwCount = await syncReadwise(db, { full: fullSync, since });
			console.log(`✅ Readwise: ${rwCount} synced`);
			total += rwCount;
			const zotCount = await syncZotero(db, { full: fullSync });
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
			total = await syncReadwise(db, { full: fullSync, since });
			console.log(`✅ Readwise: ${total} synced`);
			break;
		}
		case "zotero": {
			total = await syncZotero(db, { full: fullSync });
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
					console.log('Usage: bun sync tmdb search "movie title"');
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
		case "album": {
			const subcommand = positionals[1];
			if (subcommand === "search") {
				const query = positionals.slice(2).join(" ");
				if (!query) {
					console.log('Usage: bun sync album search "album name"');
					break;
				}
				await albumSearch(db, query);
			} else if (subcommand === "add") {
				const id = positionals[2];
				if (!id) {
					console.log("Usage: bun sync album add <spotify_id> [now|next]");
					break;
				}
				const status = positionals[3] === "now" ? "now" : "next";
				await albumAddById(db, id, status);
			} else {
				console.log("Album commands:");
				console.log('  bun sync album search "album name"');
				console.log("  bun sync album add <spotify_id> [now|next]");
			}
			db.close();
			return;
		}
		default:
			console.log(`Unknown command: ${command}`);
			printHelp();
	}

	if (values["export-library"]) {
		exportLibrary(db);
	}
	if (values["export-now"]) {
		exportNow(db);
	}

	console.log(`\n📊 Total: ${total} resources synced`);
	db.close();
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\n❌ Sync failed: ${message}`);
	process.exitCode = 1;
});
