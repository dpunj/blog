import type { LibraryStats as Stats } from "../../lib/library";
import { formatDateTime } from "../../lib/library";

interface Props {
	stats: Stats;
	fetchedAt: string;
}

export default function LibraryStats({ stats, fetchedAt }: Props) {
	return (
		<div class="text-sm text-gray-500 dark:text-gray-400 space-y-1">
			<div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
				{stats.dateRange && <span>{stats.dateRange}</span>}
				<span class="hidden sm:inline">|</span>
				<span>
					resources:{" "}
					<strong class="text-gray-700 dark:text-gray-300">
						{stats.totalResources.toLocaleString()}
					</strong>
				</span>
				<span class="hidden sm:inline">|</span>
				<span>
					tags:{" "}
					<strong class="text-gray-700 dark:text-gray-300">
						{stats.uniqueTags}
					</strong>
				</span>
				<span class="hidden sm:inline">|</span>
				<span>
					last sync:{" "}
					<strong class="text-gray-700 dark:text-gray-300">
						{formatDateTime(fetchedAt)}
					</strong>
				</span>
			</div>

			{/* Source breakdown */}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
				<span>Readwise: {stats.readwiseCount.toLocaleString()}</span>
				<span>Zotero: {stats.zoteroCount.toLocaleString()}</span>
			</div>
		</div>
	);
}
