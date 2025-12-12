import { useCallback, useMemo, useState } from "preact/hooks";
import type { SortBy, SortOrder, Stats, TrackDisplay } from "../scripts/music";
import {
	computeStats,
	exportAsJson,
	exportAsSpotifyUris,
	exportAsText,
	filterByDecades,
	formatDuration,
	getDecades,
	searchTracks,
	sortTracks,
} from "../scripts/music";

interface Props {
	tracks: TrackDisplay[];
	playlistName: string;
}

const PAGE_SIZE = 50;

const DECADE_COLORS: Record<string, string> = {
	"1960s": "bg-red-500/20 text-red-400 border-red-500/30",
	"1970s": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
	"1980s": "bg-green-500/20 text-green-400 border-green-500/30",
	"1990s": "bg-blue-500/20 text-blue-400 border-blue-500/30",
	"2000s": "bg-purple-500/20 text-purple-400 border-purple-500/30",
	"2010s": "bg-pink-500/20 text-pink-400 border-pink-500/30",
	"2020s": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

export default function MusicExplorer({ tracks }: Props) {
	// Filter state
	const [search, setSearch] = useState("");
	const [selectedDecades, setSelectedDecades] = useState<string[]>([]);

	// Sort state
	const [sortBy, setSortBy] = useState<SortBy>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

	// Pagination state
	const [page, setPage] = useState(0);

	// Selection state
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// UI state
	const [showStats, setShowStats] = useState(false);
	const [copySuccess, setCopySuccess] = useState<string | null>(null);

	// Available decades
	const decades = useMemo(() => getDecades(tracks), [tracks]);

	// Filtered and sorted tracks
	const filteredTracks = useMemo(() => {
		let result = tracks;
		result = searchTracks(result, search);
		result = filterByDecades(result, selectedDecades);
		result = sortTracks(result, sortBy, sortOrder);
		return result;
	}, [tracks, search, selectedDecades, sortBy, sortOrder]);

	// Paginated tracks
	const paginatedTracks = useMemo(() => {
		const start = page * PAGE_SIZE;
		return filteredTracks.slice(start, start + PAGE_SIZE);
	}, [filteredTracks, page]);

	const totalPages = Math.ceil(filteredTracks.length / PAGE_SIZE);

	// Selected tracks
	const selectedTracks = useMemo(
		() => tracks.filter((t) => selectedIds.has(t.id)),
		[tracks, selectedIds],
	);

	// Stats
	const stats: Stats = useMemo(() => computeStats(tracks), [tracks]);

	// Reset page when filters change
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
		setSelectedDecades([]);
		setPage(0);
	};

	const handleSort = (newSortBy: SortBy) => {
		if (sortBy === newSortBy) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(newSortBy);
			setSortOrder("asc");
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
			for (const track of paginatedTracks) {
				next.add(track.id);
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

	const selectedDuration = selectedTracks.reduce(
		(sum, t) => sum + t.durationSecs,
		0,
	);

	const hasActiveFilters = search || selectedDecades.length > 0;

	return (
		<div class="space-y-6">
			{/* Header */}
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<p class="text-sm text-gray-500 dark:text-gray-400">
						{stats.totalTracks.toLocaleString()} tracks from{" "}
						{stats.uniqueArtists.toLocaleString()} artists
					</p>
					<p class="text-xs text-gray-400 dark:text-gray-500">
						Total playtime: {stats.totalDurationDisplay}
					</p>
				</div>
				<button
					onClick={() => setShowStats(!showStats)}
					class="text-sm px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
				>
					{showStats ? "Hide Stats" : "Show Stats"}
				</button>
			</div>

			{/* Stats Panel */}
			{showStats && (
				<div class="p-4 rounded-lg bg-gray-100 dark:bg-gray-800 space-y-4">
					<h3 class="font-semibold text-lg">Top Artists</h3>
					<div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
						{stats.topArtists.map((artist) => (
							<div
								key={artist.name}
								class="text-sm px-2 py-1 rounded bg-white dark:bg-gray-700"
							>
								<span class="font-medium">{artist.name}</span>
								<span class="text-gray-500 dark:text-gray-400 ml-1">
									({artist.count})
								</span>
							</div>
						))}
					</div>

					<h3 class="font-semibold text-lg mt-4">By Decade</h3>
					<div class="space-y-2">
						{stats.decadeBreakdown.map((d) => {
							const percentage = (d.count / stats.totalTracks) * 100;
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
			)}

			{/* Search */}
			<div class="relative">
				<input
					type="text"
					value={search}
					onInput={(e) =>
						handleSearchChange((e.target as HTMLInputElement).value)
					}
					placeholder="Search tracks, artists, albums..."
					class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
				{search && (
					<button
						onClick={() => handleSearchChange("")}
						class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
					>
						&times;
					</button>
				)}
			</div>

			{/* Filters */}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm text-gray-500 dark:text-gray-400">Decades:</span>
				{decades.map((decade) => (
					<button
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

			{hasActiveFilters && (
				<button
					onClick={clearFilters}
					class="text-xs text-red-500 hover:text-red-400"
				>
					Clear filters
				</button>
			)}

			{/* Results count and sort */}
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
				<p class="text-sm text-gray-600 dark:text-gray-400">
					{filteredTracks.length.toLocaleString()} results
					{hasActiveFilters &&
						` (filtered from ${tracks.length.toLocaleString()})`}
				</p>
				<div class="flex items-center gap-2">
					<span class="text-xs text-gray-500">Sort:</span>
					{(["name", "artist", "year", "duration"] as SortBy[]).map((s) => (
						<button
							key={s}
							onClick={() => handleSort(s)}
							class={`text-xs px-2 py-1 rounded ${
								sortBy === s
									? "bg-blue-500/20 text-blue-400"
									: "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
							}`}
						>
							{s.charAt(0).toUpperCase() + s.slice(1)}
							{sortBy === s && (sortOrder === "asc" ? " ↑" : " ↓")}
						</button>
					))}
				</div>
			</div>

			{/* Track List */}
			<div class="space-y-1">
				<div class="flex items-center gap-2 mb-2">
					<button
						onClick={selectAllVisible}
						class="text-xs text-blue-500 hover:text-blue-400"
					>
						Select page
					</button>
					{selectedIds.size > 0 && (
						<button
							onClick={clearSelection}
							class="text-xs text-red-500 hover:text-red-400"
						>
							Clear selection ({selectedIds.size})
						</button>
					)}
				</div>

				{paginatedTracks.map((track) => (
					<div
						key={track.id}
						class={`flex items-center gap-3 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
							selectedIds.has(track.id) ? "bg-blue-500/10" : ""
						}`}
					>
						<input
							type="checkbox"
							checked={selectedIds.has(track.id)}
							onChange={() => toggleSelection(track.id)}
							class="w-4 h-4 rounded border-gray-300 dark:border-gray-600"
						/>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium truncate">{track.name}</span>
								{track.explicit && (
									<span class="text-xs px-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
										E
									</span>
								)}
							</div>
							<div class="text-sm text-gray-500 dark:text-gray-400 truncate">
								{track.artistNames}
							</div>
						</div>
						<div class="hidden sm:block text-xs text-gray-400 dark:text-gray-500 truncate max-w-32">
							{track.albumName}
						</div>
						<div class="text-xs text-gray-400 dark:text-gray-500 w-10 text-right">
							{track.releaseYear}
						</div>
						<div class="text-xs text-gray-400 dark:text-gray-500 w-12 text-right">
							{track.durationDisplay}
						</div>
						<a
							href={track.spotifyUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="text-green-500 hover:text-green-400 text-sm"
							title="Open in Spotify"
						>
							&#9654;
						</a>
					</div>
				))}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div class="flex items-center justify-center gap-4">
					<button
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
							<p class="font-medium">{selectedIds.size} tracks selected</p>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								{formatDuration(selectedDuration)} total
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<button
								onClick={() =>
									copyToClipboard(exportAsJson(selectedTracks), "JSON")
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
								onClick={() =>
									copyToClipboard(exportAsText(selectedTracks), "Text")
								}
								class={`text-xs px-3 py-1 rounded border ${
									copySuccess === "Text"
										? "bg-green-500/20 text-green-400 border-green-500/30"
										: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
								}`}
							>
								{copySuccess === "Text" ? "Copied!" : "Copy Names"}
							</button>
							<button
								onClick={() =>
									copyToClipboard(exportAsSpotifyUris(selectedTracks), "URIs")
								}
								class={`text-xs px-3 py-1 rounded border ${
									copySuccess === "URIs"
										? "bg-green-500/20 text-green-400 border-green-500/30"
										: "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
								}`}
							>
								{copySuccess === "URIs" ? "Copied!" : "Copy Spotify URIs"}
							</button>
							<button
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
