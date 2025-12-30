// ============================================================================
// Types
// ============================================================================

export type ResourceType =
	| "bookmark"
	| "article"
	| "paper"
	| "video"
	| "pdf"
	| "epub"
	| "tweet"
	| "other";

export type ResourceSource = "readwise" | "zotero";

export interface Resource {
	id: string;
	source: ResourceSource;
	type: ResourceType;
	title: string;
	url: string;
	author: string | null;
	description: string | null;
	dateAdded: string; // ISO 8601
	datePublished: string | null;
	tags: string[];
	imageUrl: string | null;
	// Readwise-specific
	readingProgress?: number;
	// Zotero-specific
	itemType?: string;
	publicationTitle?: string;
}

export interface LibraryData {
	fetchedAt: string;
	resources: Resource[];
}

// DB Resource type (from db.ts - snake_case fields)
export interface DbResource {
	id: string;
	type: string;
	title: string;
	url?: string;
	author?: string;
	description?: string;
	tags?: string[];
	source: string;
	source_id?: string;
	metadata?: Record<string, unknown>;
	created_at?: string;
	updated_at?: string;
	classified_at?: string;
	image_url?: string;
	reading_progress?: number;
	date_published?: string;
	item_type?: string;
	publication_title?: string;
}

// Transform DB resource to frontend Resource
export function transformDbResource(dbRes: DbResource): Resource {
	return {
		id: dbRes.id,
		source: dbRes.source as ResourceSource,
		type: dbRes.type as ResourceType,
		title: dbRes.title,
		url: dbRes.url || "",
		author: dbRes.author || null,
		description: dbRes.description || null,
		dateAdded: dbRes.created_at || new Date().toISOString(),
		datePublished: dbRes.date_published || null,
		tags: dbRes.tags || [],
		imageUrl: dbRes.image_url || null,
		readingProgress: dbRes.reading_progress,
		itemType: dbRes.item_type,
		publicationTitle: dbRes.publication_title,
	};
}

// Transform array of DB resources
export function transformDbResources(dbResources: DbResource[]): Resource[] {
	return dbResources.map(transformDbResource);
}

// Tag hierarchy types
export interface TagNodeConfig {
	displayName: string;
	aliases?: string[];
	children?: Record<string, TagNodeConfig>;
}

export interface TagHierarchyConfig {
	version?: number;
	description?: string;
	hierarchy: Record<string, TagNodeConfig>;
}

export interface TagNode {
	key: string;
	displayName: string;
	aliases: string[];
	children: TagNode[];
	resourceCount: number;
	resourceIds: Set<string>;
}

export interface TagHierarchy {
	roots: TagNode[];
	tagToNode: Map<string, TagNode>;
	uncategorizedTags: string[];
	uncategorizedCount: number;
}

export interface LibraryStats {
	totalResources: number;
	readwiseCount: number;
	zoteroCount: number;
	uniqueTags: number;
	dateRange: string;
	byType: { type: ResourceType; count: number }[];
}

export type SortBy = "dateAdded" | "datePublished" | "title";
export type SortOrder = "asc" | "desc";

// ============================================================================
// Tag Hierarchy Building
// ============================================================================

function normalizeTag(tag: string): string {
	return tag
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "");
}

function buildTagNodeFromConfig(key: string, config: TagNodeConfig): TagNode {
	const children = config.children
		? Object.entries(config.children).map(([childKey, childConfig]) =>
				buildTagNodeFromConfig(childKey, childConfig),
			)
		: [];

	return {
		key,
		displayName: config.displayName,
		aliases: (config.aliases || []).map(normalizeTag),
		children,
		resourceCount: 0,
		resourceIds: new Set(),
	};
}

function collectAllTagsInNode(node: TagNode): Set<string> {
	const tags = new Set<string>();
	tags.add(normalizeTag(node.key));
	for (const alias of node.aliases) {
		tags.add(alias);
	}
	for (const child of node.children) {
		for (const tag of collectAllTagsInNode(child)) {
			tags.add(tag);
		}
	}
	return tags;
}

function buildTagLookup(nodes: TagNode[]): Map<string, TagNode> {
	const lookup = new Map<string, TagNode>();

	function addNode(node: TagNode) {
		lookup.set(normalizeTag(node.key), node);
		for (const alias of node.aliases) {
			lookup.set(alias, node);
		}
		for (const child of node.children) {
			addNode(child);
		}
	}

	for (const node of nodes) {
		addNode(node);
	}

	return lookup;
}

function countResourcesInNode(
	node: TagNode,
	resources: Resource[],
	tagLookup: Map<string, TagNode>,
): void {
	// First, count children recursively
	for (const child of node.children) {
		countResourcesInNode(child, resources, tagLookup);
	}

	// Collect all tags that belong to this node and its descendants
	const allTags = collectAllTagsInNode(node);

	// Find resources that have any of these tags
	for (const resource of resources) {
		for (const tag of resource.tags) {
			if (allTags.has(normalizeTag(tag))) {
				node.resourceIds.add(resource.id);
				break;
			}
		}
	}

	node.resourceCount = node.resourceIds.size;
}

export function buildTagHierarchy(
	config: TagHierarchyConfig,
	resources: Resource[],
): TagHierarchy {
	// Build tree structure from config
	const roots = Object.entries(config.hierarchy).map(([key, nodeConfig]) =>
		buildTagNodeFromConfig(key, nodeConfig),
	);

	// Build lookup map
	const tagToNode = buildTagLookup(roots);

	// Count resources for each node
	for (const root of roots) {
		countResourcesInNode(root, resources, tagToNode);
	}

	// Find uncategorized tags
	const allConfiguredTags = new Set<string>();
	for (const key of tagToNode.keys()) {
		allConfiguredTags.add(key);
	}

	const uncategorizedTagsSet = new Set<string>();
	for (const resource of resources) {
		for (const tag of resource.tags) {
			const normalized = normalizeTag(tag);
			if (!allConfiguredTags.has(normalized)) {
				uncategorizedTagsSet.add(tag);
			}
		}
	}

	const uncategorizedTags = Array.from(uncategorizedTagsSet).sort();

	// Count uncategorized resources (resources with at least one uncategorized tag)
	let uncategorizedCount = 0;
	for (const resource of resources) {
		const hasUncategorized = resource.tags.some(
			(tag) => !allConfiguredTags.has(normalizeTag(tag)),
		);
		if (hasUncategorized) {
			uncategorizedCount++;
		}
	}

	return {
		roots,
		tagToNode,
		uncategorizedTags,
		uncategorizedCount,
	};
}

// ============================================================================
// Filtering
// ============================================================================

export function searchResources(
	resources: Resource[],
	query: string,
): Resource[] {
	if (!query.trim()) return resources;
	const q = query.toLowerCase();
	return resources.filter(
		(r) =>
			r.title.toLowerCase().includes(q) ||
			r.author?.toLowerCase().includes(q) ||
			r.description?.toLowerCase().includes(q) ||
			r.tags.some((t) => t.toLowerCase().includes(q)),
	);
}

export function filterBySource(
	resources: Resource[],
	source: ResourceSource | "all",
): Resource[] {
	if (source === "all") return resources;
	return resources.filter((r) => r.source === source);
}

export function filterByType(
	resources: Resource[],
	type: ResourceType | "all",
): Resource[] {
	if (type === "all") return resources;
	return resources.filter((r) => r.type === type);
}

export function filterByTagNode(
	resources: Resource[],
	hierarchy: TagHierarchy,
	tagKey: string | null,
): Resource[] {
	if (!tagKey) return resources;

	const node = hierarchy.tagToNode.get(normalizeTag(tagKey));
	if (!node) return resources;

	return resources.filter((r) => node.resourceIds.has(r.id));
}

export function filterByUncategorized(
	resources: Resource[],
	hierarchy: TagHierarchy,
): Resource[] {
	const configuredTags = new Set(hierarchy.tagToNode.keys());
	return resources.filter((r) =>
		r.tags.some((tag) => !configuredTags.has(normalizeTag(tag))),
	);
}

// ============================================================================
// Sorting
// ============================================================================

export function sortResources(
	resources: Resource[],
	sortBy: SortBy,
	order: SortOrder,
): Resource[] {
	const sorted = [...resources].sort((a, b) => {
		switch (sortBy) {
			case "dateAdded":
				return (
					new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
				);
			case "datePublished": {
				const aDate = a.datePublished ? new Date(a.datePublished).getTime() : 0;
				const bDate = b.datePublished ? new Date(b.datePublished).getTime() : 0;
				return aDate - bDate;
			}
			case "title":
				return a.title.localeCompare(b.title);
			default:
				return 0;
		}
	});
	return order === "desc" ? sorted.reverse() : sorted;
}

// ============================================================================
// Stats
// ============================================================================

export function computeLibraryStats(
	resources: Resource[],
	_hierarchy: TagHierarchy,
): LibraryStats {
	const readwiseCount = resources.filter((r) => r.source === "readwise").length;
	const zoteroCount = resources.filter((r) => r.source === "zotero").length;

	// Count unique tags
	const allTags = new Set<string>();
	for (const resource of resources) {
		for (const tag of resource.tags) {
			allTags.add(normalizeTag(tag));
		}
	}

	// Date range
	let minDate = "";
	let maxDate = "";
	for (const resource of resources) {
		if (!minDate || resource.dateAdded < minDate) {
			minDate = resource.dateAdded;
		}
		if (!maxDate || resource.dateAdded > maxDate) {
			maxDate = resource.dateAdded;
		}
	}

	const formatDateShort = (iso: string) => {
		if (!iso) return "";
		const d = new Date(iso);
		return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
	};

	const dateRange =
		minDate && maxDate
			? `${formatDateShort(minDate)} - ${formatDateShort(maxDate)}`
			: "";

	// By type
	const typeCounts = new Map<ResourceType, number>();
	for (const resource of resources) {
		typeCounts.set(resource.type, (typeCounts.get(resource.type) || 0) + 1);
	}
	const byType = Array.from(typeCounts.entries())
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => b.count - a.count);

	return {
		totalResources: resources.length,
		readwiseCount,
		zoteroCount,
		uniqueTags: allTags.size,
		dateRange,
		byType,
	};
}

// ============================================================================
// Utilities
// ============================================================================

export function formatDate(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function formatDateTime(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function getResourceTypes(resources: Resource[]): ResourceType[] {
	const types = new Set<ResourceType>();
	for (const r of resources) {
		types.add(r.type);
	}
	return Array.from(types).sort();
}
