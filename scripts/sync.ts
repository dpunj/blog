import { parseArgs } from "node:util";
import { getDb, upsertResource, getStats, exportAsJson, type Resource } from "./db";

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

// Placeholder for future API syncs
async function syncReadwise(_db: ReturnType<typeof getDb>) {
	console.log("📚 Readwise sync not yet implemented");
	console.log("   Set READWISE_TOKEN env var and implement API calls");
	return 0;
}

async function syncZotero(_db: ReturnType<typeof getDb>) {
	console.log("📄 Zotero sync not yet implemented");
	console.log("   Set ZOTERO_API_KEY env var and implement API calls");
	return 0;
}

// CLI
const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		help: { type: "boolean", short: "h" },
		export: { type: "string", short: "e" },
		stats: { type: "boolean", short: "s" },
	},
	allowPositionals: true,
});

function printHelp() {
	console.log(`
📦 Knowledge Base Sync CLI

Usage: bun scripts/sync.ts [command] [options]

Commands:
  all         Sync all sources
  books       Sync Goodreads books
  music       Sync Spotify tracks
  readwise    Sync Readwise highlights (TODO)
  zotero      Sync Zotero papers (TODO)

Options:
  -s, --stats         Show database stats
  -e, --export TYPE   Export resources as JSON (book|track|all)
  -h, --help          Show this help

Examples:
  bun scripts/sync.ts all
  bun scripts/sync.ts books
  bun scripts/sync.ts --stats
  bun scripts/sync.ts --export book > books.json
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

	const command = positionals[0] || "all";

	console.log("🔄 Starting sync...\n");

	let total = 0;

	switch (command) {
		case "all":
			total += await syncBooks(db);
			console.log(`✅ Books: ${total} synced`);
			const musicCount = await syncMusic(db);
			total += musicCount;
			console.log(`✅ Music: ${musicCount} synced`);
			await syncReadwise(db);
			await syncZotero(db);
			break;
		case "books":
			total = await syncBooks(db);
			console.log(`✅ Books: ${total} synced`);
			break;
		case "music":
			total = await syncMusic(db);
			console.log(`✅ Music: ${total} synced`);
			break;
		case "readwise":
			await syncReadwise(db);
			break;
		case "zotero":
			await syncZotero(db);
			break;
		default:
			console.log(`Unknown command: ${command}`);
			printHelp();
	}

	console.log(`\n📊 Total: ${total} resources synced`);
	db.close();
}

main();
