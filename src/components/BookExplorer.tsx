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
	read: "bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"currently-reading":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"to-read":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
};

const DECADE_COLORS: Record<string, string> = {
	"1890s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1930s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1940s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1950s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1960s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1970s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1980s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"1990s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"2000s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"2010s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
	"2020s":
		"bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10",
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
		<span class={sizeClass} role="img" aria-label={`${rating} out of 5 stars`}>
			{[1, 2, 3, 4, 5].map((star) => (
				<span
					key={star}
					class={star <= rating ? "text-yellow-400" : "text-gray-400"}
					aria-hidden="true"
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
		<div class="space-y-5">
			{/* Header Stats */}
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p class="text-pretty text-sm text-blue-900/70 dark:text-blue-100/65">
						{stats.totalPagesRead.toLocaleString()} pages from{" "}
						{stats.uniqueAuthors} authors
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowStats(!showStats)}
					class="w-fit rounded-md border border-blue-900/10 px-3 py-1 text-sm transition-colors hover:bg-white/25 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
				>
					{showStats ? "Hide details" : "Details"}
				</button>
			</div>

			{/* Stats Panel */}
			{showStats && (
				<div class="space-y-5 rounded-2xl border border-blue-900/10 bg-white/20 p-4 dark:border-blue-100/10 dark:bg-blue-950/10">
					{/* Rating Distribution */}
					<div>
						<h3 class="mb-2 text-sm font-medium text-blue-950 dark:text-blue-50">
							My Ratings
						</h3>
						<div class="flex h-20 items-end gap-2">
							{stats.ratingDistribution.map((count, i) => {
								const maxCount = Math.max(...stats.ratingDistribution, 1);
								const height = (count / maxCount) * 100;
								return (
									<div key={i} class="flex flex-1 flex-col items-center gap-1">
										<div
											class="w-full rounded-t bg-blue-500/35 dark:bg-blue-300/35"
											style={{
												height: `${height}%`,
												minHeight: count > 0 ? "4px" : "0",
											}}
										/>
										<span class="text-xs text-blue-900/55 dark:text-blue-100/50">
											{i + 1}★
										</span>
										<span class="text-xs tabular-nums text-blue-900/45 dark:text-blue-100/40">
											{count}
										</span>
									</div>
								);
							})}
						</div>
						<p class="mt-2 text-xs tabular-nums text-blue-900/55 dark:text-blue-100/50">
							Avg: {stats.avgMyRating.toFixed(1)}★ (Goodreads avg:{" "}
							{stats.avgGoodreadsRating.toFixed(2)})
						</p>
					</div>

					{/* Top Authors */}
					<div>
						<h3 class="mb-2 text-sm font-medium text-blue-950 dark:text-blue-50">
							Top Authors
						</h3>
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
							{stats.topAuthors.slice(0, 10).map((author) => (
								<div
									key={author.name}
									class="truncate rounded border border-blue-900/10 bg-white/25 px-2 py-1 text-sm dark:border-blue-100/10 dark:bg-blue-950/15"
									title={author.name}
								>
									<span class="font-medium">{author.name}</span>
									<span class="ml-1 tabular-nums text-blue-900/50 dark:text-blue-100/45">
										({author.count})
									</span>
								</div>
							))}
						</div>
					</div>

					{/* By Decade */}
					<div>
						<h3 class="mb-2 text-sm font-medium text-blue-950 dark:text-blue-50">
							By Decade
						</h3>
						<div class="space-y-1">
							{stats.decadeBreakdown.map((d) => {
								const percentage = (d.count / stats.totalBooks) * 100;
								return (
									<div key={d.decade} class="flex items-center gap-2">
										<span class="w-14 text-sm text-blue-900/65 dark:text-blue-100/60">
											{d.decade}
										</span>
										<div class="h-4 flex-1 overflow-hidden rounded bg-blue-500/10 dark:bg-blue-100/10">
											<div
												class={`h-full ${DECADE_COLORS[d.decade]?.split(" ")[0] || "bg-blue-500/35"}`}
												style={{ width: `${percentage}%` }}
											/>
										</div>
										<span class="w-16 text-right text-sm tabular-nums text-blue-900/55 dark:text-blue-100/50">
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
							<h3 class="mb-2 text-sm font-medium text-blue-950 dark:text-blue-50">
								Recommended By
							</h3>
							<div class="flex flex-wrap gap-2">
								{stats.topRecommenders.map((rec) => (
									<span
										key={rec.name}
										class="rounded border border-blue-900/10 bg-white/25 px-2 py-1 text-sm dark:border-blue-100/10 dark:bg-blue-950/15"
									>
										{rec.name}{" "}
										<span class="tabular-nums text-blue-900/50 dark:text-blue-100/45">
											({rec.count})
										</span>
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
					class="w-full rounded-xl border border-blue-900/10 bg-white/25 px-4 py-2 placeholder:text-blue-900/40 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-blue-100/10 dark:bg-blue-950/15 dark:placeholder:text-blue-100/35"
				/>
				{search && (
					<button
						type="button"
						onClick={() => handleSearchChange("")}
						class="absolute right-3 top-1/2 -translate-y-1/2 text-blue-900/45 hover:text-blue-900 dark:text-blue-100/45 dark:hover:text-blue-100"
						aria-label="Clear search"
					>
						&times;
					</button>
				)}
			</div>

			{/* Shelf Filters */}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm text-blue-900/60 dark:text-blue-100/55">
					Shelf:
				</span>
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
										? "bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10"
										: SHELF_COLORS[shelf]
									: "border-blue-900/10 hover:bg-white/25 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
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
				<span class="text-sm text-blue-900/60 dark:text-blue-100/55">
					Decades:
				</span>
				{decades.map((decade) => (
					<button
						type="button"
						key={decade}
						onClick={() => toggleDecade(decade)}
						class={`text-xs px-2 py-1 rounded-full border transition-colors ${
							selectedDecades.includes(decade)
								? DECADE_COLORS[decade] || "bg-blue-500/10 text-blue-900"
								: "border-blue-900/10 hover:bg-white/25 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
						}`}
					>
						{decade}
					</button>
				))}
			</div>

			{/* Recommender Filter */}
			{recommenders.length > 0 && (
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm text-blue-900/60 dark:text-blue-100/55">
						From:
					</span>
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
									? "bg-blue-500/10 text-blue-900 border-blue-900/10 dark:text-blue-100 dark:border-blue-100/10"
									: "border-blue-900/10 hover:bg-white/25 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
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
					class="text-xs text-blue-900/55 hover:text-blue-900 dark:text-blue-100/50 dark:hover:text-blue-100"
				>
					Clear filters
				</button>
			)}

			{/* Results and Sort */}
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
				<p class="text-sm text-blue-900/70 dark:text-blue-100/65">
					{filteredBooks.length.toLocaleString()} books
					{hasActiveFilters &&
						` (filtered from ${books.length.toLocaleString()})`}
				</p>
				<div class="flex items-center gap-2 flex-wrap">
					<span class="text-xs text-blue-900/55 dark:text-blue-100/50">
						Sort:
					</span>
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
									? "bg-blue-500/10 text-blue-900 dark:text-blue-100"
									: "text-blue-900/55 hover:text-blue-900 dark:text-blue-100/50 dark:hover:text-blue-100"
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
				<div class="mb-2 flex items-center gap-2">
					<button
						type="button"
						onClick={selectAllVisible}
						class="text-xs text-blue-900/65 hover:text-blue-900 dark:text-blue-100/60 dark:hover:text-blue-100"
					>
						Select page
					</button>
					{selectedIds.size > 0 && (
						<button
							type="button"
							onClick={clearSelection}
							class="text-xs text-blue-900/55 hover:text-blue-900 dark:text-blue-100/50 dark:hover:text-blue-100"
						>
							Clear selection ({selectedIds.size})
						</button>
					)}
				</div>

				{paginatedBooks.map((book) => (
					<div
						key={book.id}
						class={`flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/20 dark:hover:bg-blue-950/20 ${
							selectedIds.has(book.id) ? "bg-blue-500/10" : ""
						}`}
					>
						<input
							aria-label={`Select ${book.title}`}
							type="checkbox"
							checked={selectedIds.has(book.id)}
							onChange={() => toggleSelection(book.id)}
							class="size-4 rounded border-blue-900/20 text-blue-700 dark:border-blue-100/20"
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<a
									href={book.amazonSearchUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="truncate font-medium hover:text-blue-700 dark:hover:text-blue-200"
								>
									{book.title}
								</a>
								{book.myRating > 0 && <StarRating rating={book.myRating} />}
							</div>
							<div class="truncate text-sm text-blue-900/58 dark:text-blue-100/55">
								{book.author}
								{book.recommender && (
									<span class="ml-2 text-blue-900/60 dark:text-blue-100/55">
										via {book.recommender}
									</span>
								)}
							</div>
						</div>
						<div class="hidden w-12 text-right text-xs tabular-nums text-blue-900/42 dark:text-blue-100/40 sm:block">
							{book.pages > 0 ? `${book.pages}p` : ""}
						</div>
						<div class="w-12 text-right text-xs tabular-nums text-blue-900/42 dark:text-blue-100/40">
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
						class="rounded border border-blue-900/10 px-3 py-1 hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
					>
						Previous
					</button>
					<span class="text-sm tabular-nums text-blue-900/60 dark:text-blue-100/55">
						Page {page + 1} of {totalPages}
					</span>
					<button
						type="button"
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						disabled={page >= totalPages - 1}
						class="rounded border border-blue-900/10 px-3 py-1 hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
					>
						Next
					</button>
				</div>
			)}

			{/* Selection Panel */}
			{selectedIds.size > 0 && (
				<div class="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 w-11/12 max-w-2xl -translate-x-1/2 rounded-2xl border border-blue-900/10 bg-white p-4 shadow-lg dark:border-blue-100/10 dark:bg-blue-950">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="font-medium">{selectedIds.size} books selected</p>
							<p class="text-sm tabular-nums text-blue-900/60 dark:text-blue-100/55">
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
								class={`rounded border px-3 py-1 text-xs ${
									copySuccess === "JSON"
										? "border-blue-500/30 bg-blue-500/15 text-blue-900 dark:text-blue-100"
										: "border-blue-900/10 hover:bg-white/25 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
								}`}
							>
								{copySuccess === "JSON" ? "Copied!" : "Copy JSON"}
							</button>
							<button
								type="button"
								onClick={() =>
									copyToClipboard(exportAsText(selectedBooks), "Text")
								}
								class={`rounded border px-3 py-1 text-xs ${
									copySuccess === "Text"
										? "border-blue-500/30 bg-blue-500/15 text-blue-900 dark:text-blue-100"
										: "border-blue-900/10 hover:bg-white/25 dark:border-blue-100/10 dark:hover:bg-blue-950/20"
								}`}
							>
								{copySuccess === "Text" ? "Copied!" : "Copy List"}
							</button>
							<button
								type="button"
								onClick={clearSelection}
								class="rounded border border-blue-900/10 px-3 py-1 text-xs text-blue-900/65 hover:bg-white/25 dark:border-blue-100/10 dark:text-blue-100/60 dark:hover:bg-blue-950/20"
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
