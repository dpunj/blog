import type { Resource } from "../../lib/library";
import { formatDate } from "../../lib/library";

interface Props {
	resource: Resource;
}

const SOURCE_ICONS: Record<string, string> = {
	readwise: "R",
	zotero: "Z",
};

const TYPE_LABELS: Record<string, string> = {
	bookmark: "bookmark",
	article: "article",
	paper: "paper",
	video: "video",
	pdf: "pdf",
	epub: "epub",
	tweet: "tweet",
	other: "other",
};

export default function ResourceCard({ resource }: Props) {
	const sourceIcon = SOURCE_ICONS[resource.source] || "?";
	const typeLabel = TYPE_LABELS[resource.type] || resource.type;

	return (
		<article class="p-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
			<div class="flex items-start gap-3">
				{resource.imageUrl && (
					<img
						src={resource.imageUrl}
						alt=""
						class="w-16 h-16 object-cover rounded shrink-0 bg-gray-100 dark:bg-gray-800"
					/>
				)}

				<div class="flex-1 min-w-0">
					{/* Title */}
					<a
						href={resource.url}
						target="_blank"
						rel="noopener noreferrer"
						class="font-medium hover:text-blue-500 dark:hover:text-blue-400 line-clamp-2 transition-colors"
					>
						{resource.title}
					</a>

					{/* Meta line */}
					<div class="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
						<span
							class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800"
							title={resource.source}
						>
							<span class="font-mono font-semibold">{sourceIcon}</span>
							<span>{typeLabel}</span>
						</span>
						{resource.author && (
							<span class="truncate max-w-48">by {resource.author}</span>
						)}
						<span>Added {formatDate(resource.dateAdded)}</span>
					</div>

					{/* Description */}
					{resource.description && (
						<p class="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">
							{resource.description}
						</p>
					)}

					{/* Tags */}
					{resource.tags.length > 0 && (
						<div class="flex flex-wrap gap-1 mt-2">
							{resource.tags.slice(0, 5).map((tag) => (
								<span
									key={tag}
									class="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
								>
									{tag}
								</span>
							))}
							{resource.tags.length > 5 && (
								<span class="text-xs text-gray-400 dark:text-gray-500">
									+{resource.tags.length - 5} more
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</article>
	);
}
