import { useCallback, useMemo, useState } from "preact/hooks";
import type {
	BookDisplay,
	ShelfFilter,
	SortBy,
	SortOrder,
	Stats,
} from "../lib/books";
import {
	computeStats,
	exportAsJson,
	exportAsText,
	filterByDecades,
	filterByRecommender,
	filterByShelf,
	getDecades,
	getRecommenders,
	searchBooks,
	sortBooks,
} from "../lib/books";

interface Props {
	books: BookDisplay[];
}

const PAGE_SIZE = 25;

const SHELF_COLORS: Record<string, string> = {
	read: "bg-green-500/20 text-green-400 border-green-500/30",
	"currently-reading": "bg-blue-500/20 text-blue-400 border-blue-500/30",
	"to-read": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const DECADE_COLORS: Record<string, string> = {
	"1890s": "bg-stone-500/20 text-stone-400 border-stone-500/30",
	"1930s": "bg-amber-500/20 text-amber-400 border-amber-500/30",
	"1940s": "bg-orange-500/20 text-orange-400 border-orange-500/30",
	"1950s": "bg-red-500/20 text-red-400 border-red-500/30",
	"1960s": "bg-rose-500/20 text-rose-400 border-rose-500/30",
	"1970s": "bg-pink-500/20 text-pink-400 border-pink-500/30",
	"1980s": "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
	"1990s": "bg-purple-500/20 text-purple-400 border-purple-500/30",
	"2000s": "bg-violet-500/20 text-violet-400 border-violet-500/30",
	"2010s": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
	"2020s": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

function StarRating({
	rating,
	size = "sm",
}: {
	rating: number;
	size?: "sm" | "md";
}) {
	const sizeClass = size === "sm" ? "text-xs" : "text-sm";
	return (
		<span class={`${sizeClass} tracking-tight`}>
			{[1, 2, 3, 4, 5].map((star) => (
				<span
					key={star}
					class={star <= rating ? "text-yellow-400" : "text-gray-400"}
				>
					{star <= rating ? "★" : "☆"}
				</span>
			))}
		</span>
	);
}

export default function BookExplorer({ books }: Props) {
	// Filter state
	const [search, setSearch] = useState("");
	const [shelfFilter, setShelfFilter] = useState<ShelfFilter>("all");
	const [selectedDecades, setSelectedDecades] = useState<string[]>([]);
	const [selectedRecommender, setSelectedRecommender] = useState<string | null>(
		null,
	);

	// Sort state
	const [sortBy, setSortBy] = useState<SortBy>("dateAdded");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	// Pagination
	const [page, setPage] = useState(0);

	// Selection state
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// UI state
	const [showStats, setShowStats] = useState(false);
	const [copySuccess, setCopySuccess] = useState<string | null>(null);

	// Derived data
	const decades = useMemo(() => getDecades(books), [books]);
	const recommenders = useMemo(() => getRecommenders(books), [books]);

	// Filtered and sorted books
	const filteredBooks = useMemo(() => {
		let result = books;
		result = searchBooks(result, search);
		result = filterByShelf(result, shelfFilter);
		result = filterByDecades(result, selectedDecades);
		result = filterByRecommender(result, selectedRecommender);
		result = sortBooks(result, sortBy, sortOrder);
		return result;
	}, [
		books,
		search,
		shelfFilter,
		selectedDecades,
		selectedRecommender,
		sortBy,
		sortOrder,
	]);

	// Paginated books
	const paginatedBooks = useMemo(() => {
		const start = page * PAGE_SIZE;
		return filteredBooks.slice(start, start + PAGE_SIZE);
	}, [filteredBooks, page]);

	const totalPages = Math.ceil(filteredBooks.length / PAGE_SIZE);

	// Selected books
	const selectedBooks = useMemo(
		() => books.filter((b) => selectedIds.has(b.id)),
		[books, selectedIds],
	);

	// Stats
	const stats: Stats = useMemo(() => computeStats(books), [books]);

	// Handlers
	const handleSearchChange = (value: string) => {
		setSearch(value);
		setPage(0);
	};

	const toggleDecade = (decade: string) => {
		setSelectedDecades((prev) =>
			prev.includes(decade)
				? prev.filter((d) => d !== decade)
				: [...prev, decade],
		);
		setPage(0);
	};

	const clearFilters = () => {
		setSearch("");
		setShelfFilter("all");
		setSelectedDecades([]);
		setSelectedRecommender(null);
		setPage(0);
	};

	const handleSort = (newSortBy: SortBy) => {
		if (sortBy === newSortBy) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(newSortBy);
			setSortOrder(
				newSortBy === "title" || newSortBy === "author" ? "asc" : "desc",
			);
		}
		setPage(0);
	};

	const toggleSelection = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const selectAllVisible = () => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			for (const book of paginatedBooks) {
				next.add(book.id);
			}
			return next;
		});
	};

	const clearSelection = () => {
		setSelectedIds(new Set());
	};

	const copyToClipboard = useCallback(async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopySuccess(label);
			setTimeout(() => setCopySuccess(null), 2000);
		} catch {
			console.error("Failed to copy");
		}
	}, []);

	const hasActiveFilters =
		search ||
		shelfFilter !== "all" ||
		selectedDecades.length > 0 ||
		selectedRecommender;

	return (
		<div class="space-y-6">
			{/* Header Stats */}
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<p class="text-sm text-gray-500 dark:text-gray-400">
						{stats.booksRead} read, {stats.currentlyReading} reading,{" "}
						{stats.booksToRead} to read
					</p>
					<p class="text-xs text-gray-400 dark:text-gray-500">
						{stats.totalPagesRead.toLocaleString()} pages from{" "}
						{stats.uniqueAuthors} authors
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowStats(!showStats)}
					class="text-sm px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
				>
					{showStats ? "Hide Stats" : "Show Stats"}
				</button>
			</div>

			{/* Stats Panel */}
			{showStats && (
				<div class="p-4 rounded-lg bg-gray-100 dark:bg-gray-800 space-y-4">
					{/* Rating Distribution */}
					<div>
						<h3 class="font-semibold text-lg mb-2">My Ratings</h3>
						<div class="flex items-end gap-2 h-20">
							{stats.ratingDistribution.map((count, i) => {
								const maxCount = Math.max(...stats.ratingDistribution, 1);
								const height = (count / maxCount) * 100;
								return (
									<div key={i} class="flex-1 flex flex-col items-center gap-1">
										<div
											class="w-full bg-yellow-400 rounded-t"
											style={{
												height: `${height}%`,
												minHeight: count > 0 ? "4px" : "0",
											}}
										/>
										<span class="text-xs text-gray-500">{i + 1}★</span>
										<span class="text-xs text-gray-400">{count}</span>
									</div>
								);
							})}
						</div>
						<p class="text-xs text-gray-500 mt-2">
							Avg: {stats.avgMyRating.toFixed(1)}★ (Goodreads avg:{" "}
							{stats.avgGoodreadsRating.toFixed(2)})
						</p>
					</div>

					{/* Top Authors */}
					<div>
						<h3 class="font-semibold text-lg mb-2">Top Authors</h3>
						<div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
							{stats.topAuthors.slice(0, 10).map((author) => (
								<div
									key={author.name}
									class="text-sm px-2 py-1 rounded bg-white dark:bg-gray-700 truncate"
									title={author.name}
								>
									<span class="font-medium">{author.name}</span>
									<span class="text-gray-500 dark:text-gray-400 ml-1">
										({author.count})
									</span>
								</div>
							))}
						</div>
					</div>

					{/* By Decade */}
					<div>
						<h3 class="font-semibold text-lg mb-2">By Decade</h3>
						<div class="space-y-1">
							{stats.decadeBreakdown.map((d) => {
								const percentage = (d.count / stats.totalBooks) * 100;
								return (
									<div key={d.decade} class="flex items-center gap-2">
										<span class="text-sm w-14">{d.decade}</span>
										<div class="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
											<div
												class={`h-full ${DECADE_COLORS[d.decade]?.split(" ")[0] || "bg-gray-500"}`}
												style={{ width: `${percentage}%` }}
											/>
										</div>
										<span class="text-sm text-gray-500 w-16 text-right">
											{d.count} ({percentage.toFixed(0)}%)
										</span>
									</div>
								);
							})}
						</div>
					</div>

					{/* Recommenders */}
					{stats.topRecommenders.length > 0 && (
						<div>
							<h3 class="font-semibold text-lg mb-2">Recommended By</h3>
							<div class="flex flex-wrap gap-2">
								{stats.topRecommenders.map((rec) => (
									<span
										key={rec.name}
										class="text-sm px-2 py-1 rounded bg-white dark:bg-gray-700"
									>
										{rec.name} <span class="text-gray-500">({rec.count})</span>
									</span>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Search */}
			<div class="relative">
				<input
					type="text"
					value={search}
					onInput={(e) =>
						handleSearchChange((e.target as HTMLInputElement).value)
					}
					placeholder="Search books or authors..."
					class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
				{search && (
					<button
						type="button"
						onClick={() => handleSearchChange("")}
						class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
					>
						&times;
					</button>
				)}
			</div>

			{/* Shelf Filters */}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm text-gray-500 dark:text-gray-400">Shelf:</span>
				{(["all", "read", "currently-reading", "to-read"] as ShelfFilter[]).map(
					(shelf) => (
						<button
							type="button"
							key={shelf}
							onClick={() => {
								setShelfFilter(shelf);
								setPage(0);
							}}
							class={`text-xs px-2 py-1 rounded-full border transition-colors ${
								shelfFilter === shelf
									? shelf === "all"
										? "bg-gray-500/20 text-gray-400 border-gray-500/30"
										: SHELF_COLORS[shelf]
									: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							{shelf === "all"
								? "All"
								: shelf === "currently-reading"
									? "Reading"
									: shelf.charAt(0).toUpperCase() + shelf.slice(1)}
						</button>
					),
				)}
			</div>

			{/* Decade Filters */}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm text-gray-500 dark:text-gray-400">Decades:</span>
				{decades.map((decade) => (
					<button
						type="button"
						key={decade}
						onClick={() => toggleDecade(decade)}
						class={`text-xs px-2 py-1 rounded-full border transition-colors ${
							selectedDecades.includes(decade)
								? DECADE_COLORS[decade] || "bg-gray-500/20 text-gray-400"
								: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
						}`}
					>
						{decade}
					</button>
				))}
			</div>

			{/* Recommender Filter */}
			{recommenders.length > 0 && (
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm text-gray-500 dark:text-gray-400">From:</span>
					{recommenders.map((rec) => (
						<button
							type="button"
							key={rec}
							onClick={() => {
								setSelectedRecommender(
									selectedRecommender === rec ? null : rec,
								);
								setPage(0);
							}}
							class={`text-xs px-2 py-1 rounded-full border transition-colors ${
								selectedRecommender === rec
									? "bg-purple-500/20 text-purple-400 border-purple-500/30"
									: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							{rec}
						</button>
					))}
				</div>
			)}

			{hasActiveFilters && (
				<button
					type="button"
					onClick={clearFilters}
					class="text-xs text-red-500 hover:text-red-400"
				>
					Clear filters
				</button>
			)}

			{/* Results and Sort */}
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
				<p class="text-sm text-gray-600 dark:text-gray-400">
					{filteredBooks.length.toLocaleString()} books
					{hasActiveFilters &&
						` (filtered from ${books.length.toLocaleString()})`}
				</p>
				<div class="flex items-center gap-2 flex-wrap">
					<span class="text-xs text-gray-500">Sort:</span>
					{(
						[
							"title",
							"author",
							"myRating",
							"year",
							"pages",
							"dateAdded",
						] as SortBy[]
					).map((s) => (
						<button
							type="button"
							key={s}
							onClick={() => handleSort(s)}
							class={`text-xs px-2 py-1 rounded ${
								sortBy === s
									? "bg-blue-500/20 text-blue-400"
									: "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
							}`}
						>
							{s === "myRating"
								? "Rating"
								: s === "dateAdded"
									? "Added"
									: s.charAt(0).toUpperCase() + s.slice(1)}
							{sortBy === s && (sortOrder === "asc" ? " ↑" : " ↓")}
						</button>
					))}
				</div>
			</div>

			{/* Book List */}
			<div class="space-y-1">
				<div class="flex items-center gap-2 mb-2">
					<button
						type="button"
						onClick={selectAllVisible}
						class="text-xs text-blue-500 hover:text-blue-400"
					>
						Select page
					</button>
					{selectedIds.size > 0 && (
						<button
							type="button"
							onClick={clearSelection}
							class="text-xs text-red-500 hover:text-red-400"
						>
							Clear selection ({selectedIds.size})
						</button>
					)}
				</div>

				{paginatedBooks.map((book) => (
					<div
						key={book.id}
						class={`flex items-center gap-3 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
							selectedIds.has(book.id) ? "bg-blue-500/10" : ""
						}`}
					>
						<input
							type="checkbox"
							checked={selectedIds.has(book.id)}
							onChange={() => toggleSelection(book.id)}
							class="w-4 h-4 rounded border-gray-300 dark:border-gray-600"
						/>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<a
									href={book.amazonSearchUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="font-medium truncate hover:text-blue-500"
								>
									{book.title}
								</a>
								{book.myRating > 0 && <StarRating rating={book.myRating} />}
							</div>
							<div class="text-sm text-gray-500 dark:text-gray-400 truncate">
								{book.author}
								{book.recommender && (
									<span class="text-purple-400 ml-2">
										via {book.recommender}
									</span>
								)}
							</div>
						</div>
						<div class="hidden sm:block text-xs text-gray-400 dark:text-gray-500 w-12 text-right">
							{book.pages > 0 ? `${book.pages}p` : ""}
						</div>
						<div class="text-xs text-gray-400 dark:text-gray-500 w-12 text-right">
							{book.yearPublished || ""}
						</div>
						<span
							class={`hidden sm:inline-block text-xs px-2 py-0.5 rounded-full border ${
								SHELF_COLORS[book.exclusiveShelf] || ""
							}`}
						>
							{book.exclusiveShelf === "currently-reading"
								? "reading"
								: book.exclusiveShelf}
						</span>
					</div>
				))}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div class="flex items-center justify-center gap-4">
					<button
						type="button"
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						disabled={page === 0}
						class="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
					>
						Previous
					</button>
					<span class="text-sm text-gray-500">
						Page {page + 1} of {totalPages}
					</span>
					<button
						type="button"
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						disabled={page >= totalPages - 1}
						class="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
					>
						Next
					</button>
				</div>
			)}

			{/* Selection Panel */}
			{selectedIds.size > 0 && (
				<div class="fixed bottom-4 left-1/2 -translate-x-1/2 w-11/12 max-w-2xl p-4 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg">
					<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
						<div>
							<p class="font-medium">{selectedIds.size} books selected</p>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								{selectedBooks
									.reduce((sum, b) => sum + b.pages, 0)
									.toLocaleString()}{" "}
								pages total
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() =>
									copyToClipboard(exportAsJson(selectedBooks), "JSON")
								}
								class={`text-xs px-3 py-1 rounded border ${
									copySuccess === "JSON"
										? "bg-green-500/20 text-green-400 border-green-500/30"
										: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
								}`}
							>
								{copySuccess === "JSON" ? "Copied!" : "Copy JSON"}
							</button>
							<button
								type="button"
								onClick={() =>
									copyToClipboard(exportAsText(selectedBooks), "Text")
								}
								class={`text-xs px-3 py-1 rounded border ${
									copySuccess === "Text"
										? "bg-green-500/20 text-green-400 border-green-500/30"
										: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
								}`}
							>
								{copySuccess === "Text" ? "Copied!" : "Copy List"}
							</button>
							<button
								type="button"
								onClick={clearSelection}
								class="text-xs px-3 py-1 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
							>
								Clear
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
