import { useMemo, useState } from "preact/hooks";
import type {
	Resource,
	ResourceSource,
	ResourceType,
	SortBy,
	SortOrder,
	TagHierarchy,
} from "../../lib/library";
import {
	computeLibraryStats,
	filterBySource,
	filterByTagNode,
	filterByType,
	getResourceTypes,
	searchResources,
	sortResources,
} from "../../lib/library";
import LibrarySearch from "./LibrarySearch";
import LibraryStats from "./LibraryStats";
import ResourceList from "./ResourceList";
import TagTree from "./TagTree";

interface Props {
	resources: Resource[];
	hierarchy: TagHierarchy;
	fetchedAt: string;
}

export default function LibraryExplorer({
	resources,
	hierarchy,
	fetchedAt,
}: Props) {
	// Filter state
	const [search, setSearch] = useState("");
	const [selectedTagKey, setSelectedTagKey] = useState<string | null>(null);
	const [sourceFilter, setSourceFilter] = useState<ResourceSource | "all">(
		"all",
	);
	const [typeFilter, setTypeFilter] = useState<ResourceType | "all">("all");

	// Sort state
	const [sortBy, setSortBy] = useState<SortBy>("dateAdded");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	// Available types
	const availableTypes = useMemo(
		() => getResourceTypes(resources),
		[resources],
	);

	// Filtered and sorted resources
	const filteredResources = useMemo(() => {
		let result = resources;
		if (search) result = searchResources(result, search);
		if (selectedTagKey)
			result = filterByTagNode(result, hierarchy, selectedTagKey);
		if (sourceFilter !== "all") result = filterBySource(result, sourceFilter);
		if (typeFilter !== "all") result = filterByType(result, typeFilter);
		result = sortResources(result, sortBy, sortOrder);
		return result;
	}, [
		resources,
		search,
		selectedTagKey,
		hierarchy,
		sourceFilter,
		typeFilter,
		sortBy,
		sortOrder,
	]);

	// Stats
	const stats = useMemo(
		() => computeLibraryStats(resources, hierarchy),
		[resources, hierarchy],
	);

	const hasActiveFilters =
		search || selectedTagKey || sourceFilter !== "all" || typeFilter !== "all";

	const clearAllFilters = () => {
		setSearch("");
		setSelectedTagKey(null);
		setSourceFilter("all");
		setTypeFilter("all");
	};

	const handleSort = (newSortBy: SortBy) => {
		if (sortBy === newSortBy) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(newSortBy);
			setSortOrder("desc");
		}
	};

	return (
		<div class="space-y-6">
			{/* Stats header */}
			<LibraryStats stats={stats} fetchedAt={fetchedAt} />

			{/* Description */}
			<p class="text-gray-600 dark:text-gray-400 text-sm">
				A collection of bookmarks, articles, and papers I've saved and
				organized. Each resource is classified within a hierarchical tag system.
			</p>

			{/* Search */}
			<LibrarySearch
				value={search}
				onChange={setSearch}
				placeholder="Search titles, authors, descriptions, tags..."
			/>

			{/* Main content */}
			<div class="flex flex-col lg:flex-row gap-6">
				{/* Sidebar: Tag Tree */}
				<aside class="lg:w-72 shrink-0">
					<TagTree
						hierarchy={hierarchy}
						selectedKey={selectedTagKey}
						onSelect={setSelectedTagKey}
					/>
				</aside>

				{/* Main: Filters + Resource List */}
				<main class="flex-1 min-w-0">
					{/* Filters row */}
					<div class="flex flex-wrap items-center gap-3 mb-4">
						{/* Source filter */}
						<div class="flex items-center gap-2">
							<span class="text-xs text-gray-500 dark:text-gray-400">
								Source:
							</span>
							{(["all", "readwise", "zotero"] as const).map((source) => (
								<button
									key={source}
									onClick={() => setSourceFilter(source)}
									class={`text-xs px-2 py-1 rounded transition-colors ${
										sourceFilter === source
											? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
											: "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
									}`}
								>
									{source === "all"
										? "All"
										: source.charAt(0).toUpperCase() + source.slice(1)}
								</button>
							))}
						</div>

						{/* Type filter */}
						<div class="flex items-center gap-2">
							<span class="text-xs text-gray-500 dark:text-gray-400">
								Type:
							</span>
							<select
								value={typeFilter}
								onChange={(e) =>
									setTypeFilter(
										(e.target as HTMLSelectElement).value as
											| ResourceType
											| "all",
									)
								}
								class="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
							>
								<option value="all">All</option>
								{availableTypes.map((type) => (
									<option key={type} value={type}>
										{type.charAt(0).toUpperCase() + type.slice(1)}
									</option>
								))}
							</select>
						</div>

						{/* Sort */}
						<div class="flex items-center gap-2 ml-auto">
							<span class="text-xs text-gray-500 dark:text-gray-400">
								Sort:
							</span>
							{(["dateAdded", "title"] as SortBy[]).map((s) => (
								<button
									key={s}
									onClick={() => handleSort(s)}
									class={`text-xs px-2 py-1 rounded transition-colors ${
										sortBy === s
											? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
											: "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
									}`}
								>
									{s === "dateAdded" ? "Date" : "Title"}
									{sortBy === s && (sortOrder === "asc" ? " ↑" : " ↓")}
								</button>
							))}
						</div>
					</div>

					{/* Active filters summary */}
					{hasActiveFilters && (
						<div class="flex items-center gap-2 mb-4 text-sm">
							<span class="text-gray-500 dark:text-gray-400">
								{filteredResources.length.toLocaleString()} results
								{resources.length !== filteredResources.length &&
									` (filtered from ${resources.length.toLocaleString()})`}
							</span>
							<button
								onClick={clearAllFilters}
								class="text-xs text-red-500 hover:text-red-400"
							>
								Clear all filters
							</button>
						</div>
					)}

					{/* Resource list */}
					<ResourceList resources={filteredResources} />
				</main>
			</div>
		</div>
	);
}
