// Types for Goodreads CSV data
export interface BookRaw {
	"Book Id": string;
	Title: string;
	Author: string;
	"Author l-f": string;
	"Additional Authors": string;
	ISBN: string;
	ISBN13: string;
	"My Rating": string;
	"Average Rating": string;
	Publisher: string;
	Binding: string;
	"Number of Pages": string;
	"Year Published": string;
	"Original Publication Year": string;
	"Date Read": string;
	"Date Added": string;
	Bookshelves: string;
	"Bookshelves with positions": string;
	"Exclusive Shelf": string;
	"My Review": string;
	Spoiler: string;
	"Private Notes": string;
	"Read Count": string;
	"Owned Copies": string;
}

// Display type for UI
export interface BookDisplay {
	id: string;
	title: string;
	author: string;
	additionalAuthors: string;
	myRating: number;
	avgRating: number;
	pages: number;
	yearPublished: number;
	originalYear: number;
	dateRead: string | null;
	dateAdded: string;
	shelves: string[];
	exclusiveShelf: "read" | "currently-reading" | "to-read";
	readCount: number;
	decade: string;
	recommender: string | null;
	amazonSearchUrl: string;
}

export type ShelfFilter = "all" | "read" | "currently-reading" | "to-read";
export type SortBy =
	| "title"
	| "author"
	| "myRating"
	| "avgRating"
	| "pages"
	| "year"
	| "dateRead"
	| "dateAdded";
export type SortOrder = "asc" | "desc";

// Parse CSV string to array of objects
export function parseCSV(csvText: string): BookRaw[] {
	const lines = csvText.split("\n");
	if (lines.length < 2) return [];

	// Parse header
	const headers = parseCSVLine(lines[0]);

	// Parse rows
	const books: BookRaw[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const values = parseCSVLine(line);
		const book: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			book[headers[j]] = values[j] || "";
		}
		books.push(book as unknown as BookRaw);
	}
	return books;
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
				i++; // Skip escaped quote
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

// Extract recommender from shelves (e.g., "from-naval" -> "Naval")
function extractRecommender(shelves: string[]): string | null {
	for (const shelf of shelves) {
		if (shelf.startsWith("from-")) {
			const name = shelf.replace("from-", "").replace(/-/g, " ");
			return name
				.split(" ")
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ");
		}
	}
	return null;
}

// Transform raw book to display format
export function transformBook(book: BookRaw): BookDisplay {
	const yearPublished = parseInt(book["Year Published"], 10) || 0;
	const originalYear = parseInt(book["Original Publication Year"], 10) || 0;
	const displayYear = originalYear || yearPublished;
	const decade = displayYear
		? `${Math.floor(displayYear / 10) * 10}s`
		: "Unknown";
	const shelves = book.Bookshelves
		? book.Bookshelves.split(",").map((s) => s.trim())
		: [];

	// Clean ISBN for Amazon search
	const cleanIsbn =
		book.ISBN13.replace(/[="]/g, "") || book.ISBN.replace(/[="]/g, "");

	return {
		id: book["Book Id"],
		title: book.Title,
		author: book.Author,
		additionalAuthors: book["Additional Authors"],
		myRating: parseInt(book["My Rating"], 10) || 0,
		avgRating: parseFloat(book["Average Rating"]) || 0,
		pages: parseInt(book["Number of Pages"], 10) || 0,
		yearPublished: displayYear,
		originalYear,
		dateRead: book["Date Read"] || null,
		dateAdded: book["Date Added"],
		shelves,
		exclusiveShelf: book["Exclusive Shelf"] as
			| "read"
			| "currently-reading"
			| "to-read",
		readCount: parseInt(book["Read Count"], 10) || 0,
		decade,
		recommender: extractRecommender(shelves),
		amazonSearchUrl: cleanIsbn
			? `https://www.amazon.com/dp/${cleanIsbn}`
			: `https://www.amazon.com/s?k=${encodeURIComponent(`${book.Title} ${book.Author}`)}`,
	};
}

// Parse and transform full dataset
export function parseGoodreadsData(csvText: string): BookDisplay[] {
	const rawBooks = parseCSV(csvText);
	return rawBooks.map(transformBook);
}

// Get unique decades
export function getDecades(books: BookDisplay[]): string[] {
	const decades = new Set(books.map((b) => b.decade));
	return Array.from(decades)
		.filter((d) => d !== "Unknown")
		.sort();
}

// Get unique recommenders
export function getRecommenders(books: BookDisplay[]): string[] {
	const recommenders = new Set<string>();
	for (const book of books) {
		if (book.recommender) {
			recommenders.add(book.recommender);
		}
	}
	return Array.from(recommenders).sort();
}

// Filter by search query
export function searchBooks(
	books: BookDisplay[],
	query: string,
): BookDisplay[] {
	if (!query.trim()) return books;
	const q = query.toLowerCase();
	return books.filter(
		(b) =>
			b.title.toLowerCase().includes(q) ||
			b.author.toLowerCase().includes(q) ||
			b.additionalAuthors.toLowerCase().includes(q),
	);
}

// Filter by shelf
export function filterByShelf(
	books: BookDisplay[],
	shelf: ShelfFilter,
): BookDisplay[] {
	if (shelf === "all") return books;
	return books.filter((b) => b.exclusiveShelf === shelf);
}

// Filter by decades
export function filterByDecades(
	books: BookDisplay[],
	decades: string[],
): BookDisplay[] {
	if (decades.length === 0) return books;
	return books.filter((b) => decades.includes(b.decade));
}

// Filter by recommender
export function filterByRecommender(
	books: BookDisplay[],
	recommender: string | null,
): BookDisplay[] {
	if (!recommender) return books;
	return books.filter((b) => b.recommender === recommender);
}

// Filter by rating
export function filterByRating(
	books: BookDisplay[],
	minRating: number,
): BookDisplay[] {
	if (minRating === 0) return books;
	return books.filter((b) => b.myRating >= minRating);
}

// Sort books
export function sortBooks(
	books: BookDisplay[],
	sortBy: SortBy,
	order: SortOrder,
): BookDisplay[] {
	const sorted = [...books].sort((a, b) => {
		switch (sortBy) {
			case "title":
				return a.title.localeCompare(b.title);
			case "author":
				return a.author.localeCompare(b.author);
			case "myRating":
				return a.myRating - b.myRating;
			case "avgRating":
				return a.avgRating - b.avgRating;
			case "pages":
				return a.pages - b.pages;
			case "year":
				return a.yearPublished - b.yearPublished;
			case "dateRead":
				if (!a.dateRead && !b.dateRead) return 0;
				if (!a.dateRead) return 1;
				if (!b.dateRead) return -1;
				return a.dateRead.localeCompare(b.dateRead);
			case "dateAdded":
				return a.dateAdded.localeCompare(b.dateAdded);
			default:
				return 0;
		}
	});
	return order === "desc" ? sorted.reverse() : sorted;
}

// Stats types and computation
export interface AuthorCount {
	name: string;
	count: number;
}

export interface DecadeCount {
	decade: string;
	count: number;
}

export interface RecommenderCount {
	name: string;
	count: number;
}

export interface Stats {
	totalBooks: number;
	booksRead: number;
	booksToRead: number;
	currentlyReading: number;
	totalPagesRead: number;
	avgMyRating: number;
	avgGoodreadsRating: number;
	uniqueAuthors: number;
	topAuthors: AuthorCount[];
	decadeBreakdown: DecadeCount[];
	topRecommenders: RecommenderCount[];
	booksReadThisYear: number;
	ratingDistribution: number[];
}

export function computeStats(books: BookDisplay[]): Stats {
	const readBooks = books.filter((b) => b.exclusiveShelf === "read");
	const currentYear = new Date().getFullYear();

	// Count authors
	const authorCounts = new Map<string, number>();
	for (const book of books) {
		authorCounts.set(book.author, (authorCounts.get(book.author) || 0) + 1);
	}
	const topAuthors = Array.from(authorCounts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);

	// Count decades
	const decadeCounts = new Map<string, number>();
	for (const book of books) {
		decadeCounts.set(book.decade, (decadeCounts.get(book.decade) || 0) + 1);
	}
	const decadeBreakdown = Array.from(decadeCounts.entries())
		.map(([decade, count]) => ({ decade, count }))
		.filter(({ decade }) => decade !== "Unknown")
		.sort((a, b) => a.decade.localeCompare(b.decade));

	// Count recommenders
	const recommenderCounts = new Map<string, number>();
	for (const book of books) {
		if (book.recommender) {
			recommenderCounts.set(
				book.recommender,
				(recommenderCounts.get(book.recommender) || 0) + 1,
			);
		}
	}
	const topRecommenders = Array.from(recommenderCounts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);

	// Rating distribution (1-5 stars)
	const ratingDistribution = [0, 0, 0, 0, 0];
	const ratedBooks = readBooks.filter((b) => b.myRating > 0);
	for (const book of ratedBooks) {
		if (book.myRating >= 1 && book.myRating <= 5) {
			ratingDistribution[book.myRating - 1]++;
		}
	}

	// Avg ratings
	const avgMyRating =
		ratedBooks.length > 0
			? ratedBooks.reduce((sum, b) => sum + b.myRating, 0) / ratedBooks.length
			: 0;
	const avgGoodreadsRating =
		books.length > 0
			? books.reduce((sum, b) => sum + b.avgRating, 0) / books.length
			: 0;

	// Books read this year
	const booksReadThisYear = readBooks.filter((b) =>
		b.dateRead?.startsWith(String(currentYear)),
	).length;

	// Total pages read
	const totalPagesRead = readBooks.reduce((sum, b) => sum + b.pages, 0);

	return {
		totalBooks: books.length,
		booksRead: readBooks.length,
		booksToRead: books.filter((b) => b.exclusiveShelf === "to-read").length,
		currentlyReading: books.filter(
			(b) => b.exclusiveShelf === "currently-reading",
		).length,
		totalPagesRead,
		avgMyRating,
		avgGoodreadsRating,
		uniqueAuthors: authorCounts.size,
		topAuthors,
		decadeBreakdown,
		topRecommenders,
		booksReadThisYear,
		ratingDistribution,
	};
}

// Export helpers
export function exportAsJson(books: BookDisplay[]): string {
	return JSON.stringify(
		books.map((b) => ({
			title: b.title,
			author: b.author,
			myRating: b.myRating,
			avgRating: b.avgRating,
			year: b.yearPublished,
			pages: b.pages,
			shelf: b.exclusiveShelf,
		})),
		null,
		2,
	);
}

export function exportAsText(books: BookDisplay[]): string {
	return books.map((b) => `${b.title} - ${b.author}`).join("\n");
}

// Render star rating
export function renderStars(rating: number): string {
	const filled = Math.round(rating);
	return "★".repeat(filled) + "☆".repeat(5 - filled);
}
