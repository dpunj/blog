import { useMemo, useState } from "preact/hooks";
import type { Resource } from "../../scripts/library";
import ResourceCard from "./ResourceCard";

interface Props {
	resources: Resource[];
	pageSize?: number;
}

export default function ResourceList({ resources, pageSize = 50 }: Props) {
	const [page, setPage] = useState(0);

	const totalPages = Math.ceil(resources.length / pageSize);

	const paginatedResources = useMemo(() => {
		const start = page * pageSize;
		return resources.slice(start, start + pageSize);
	}, [resources, page, pageSize]);

	// Reset to first page when resources change
	useMemo(() => {
		if (page >= totalPages && totalPages > 0) {
			setPage(0);
		}
	}, [resources.length]);

	if (resources.length === 0) {
		return (
			<div class="text-center py-12 text-gray-500 dark:text-gray-400">
				<p>No resources found</p>
			</div>
		);
	}

	return (
		<div>
			{/* Resource list */}
			<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
				{paginatedResources.map((resource) => (
					<ResourceCard key={resource.id} resource={resource} />
				))}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div class="flex items-center justify-center gap-4 mt-4">
					<button
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						disabled={page === 0}
						class="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
					>
						Previous
					</button>
					<span class="text-sm text-gray-500 dark:text-gray-400">
						Page {page + 1} of {totalPages}
					</span>
					<button
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						disabled={page >= totalPages - 1}
						class="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
					>
						Next
					</button>
				</div>
			)}

			{/* Results summary */}
			<p class="text-xs text-gray-400 dark:text-gray-500 text-center mt-2">
				Showing {page * pageSize + 1}-
				{Math.min((page + 1) * pageSize, resources.length)} of{" "}
				{resources.length.toLocaleString()} resources
			</p>
		</div>
	);
}
