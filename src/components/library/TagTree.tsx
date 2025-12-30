import { useState } from "preact/hooks";
import type { TagHierarchy } from "../../lib/library";
import TagNode from "./TagNode";

interface Props {
	hierarchy: TagHierarchy;
	selectedKey: string | null;
	onSelect: (key: string | null) => void;
}

export default function TagTree({ hierarchy, selectedKey, onSelect }: Props) {
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
	const [showUncategorized, setShowUncategorized] = useState(false);

	const toggleExpand = (key: string) => {
		setExpandedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	const expandAll = () => {
		const allKeys = new Set<string>();
		const collectKeys = (nodes: typeof hierarchy.roots) => {
			for (const node of nodes) {
				if (node.children.length > 0) {
					allKeys.add(node.key);
					collectKeys(node.children);
				}
			}
		};
		collectKeys(hierarchy.roots);
		setExpandedKeys(allKeys);
	};

	const collapseAll = () => {
		setExpandedKeys(new Set());
	};

	return (
		<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
			{/* Header */}
			<div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
				<h3 class="font-semibold text-sm">Tags</h3>
				<div class="flex items-center gap-2">
					{selectedKey && (
						<button
							type="button"
							onClick={() => onSelect(null)}
							class="text-xs text-red-500 hover:text-red-400"
						>
							Clear
						</button>
					)}
					<button
						type="button"
						onClick={expandAll}
						class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
						title="Expand all"
					>
						[+]
					</button>
					<button
						type="button"
						onClick={collapseAll}
						class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
						title="Collapse all"
					>
						[-]
					</button>
				</div>
			</div>

			{/* Tag tree */}
			<div class="p-2 max-h-96 overflow-y-auto">
				{hierarchy.roots.map((node) => (
					<TagNode
						key={node.key}
						node={node}
						depth={0}
						expandedKeys={expandedKeys}
						selectedKey={selectedKey}
						onToggleExpand={toggleExpand}
						onSelect={onSelect}
					/>
				))}

				{/* Uncategorized section */}
				{hierarchy.uncategorizedTags.length > 0 && (
					<div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
						<button
							type="button"
							onClick={() => setShowUncategorized(!showUncategorized)}
							class="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 w-full px-2"
						>
							<span class="w-5 text-xs font-mono">
								{showUncategorized ? "[-]" : "[+]"}
							</span>
							<span>
								Uncategorized ({hierarchy.uncategorizedTags.length} tags)
							</span>
						</button>

						{showUncategorized && (
							<div class="mt-2 px-2 flex flex-wrap gap-1">
								{hierarchy.uncategorizedTags.map((tag) => (
									<span
										key={tag}
										class="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
									>
										{tag}
									</span>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
