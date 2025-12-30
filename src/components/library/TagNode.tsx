import type { TagNode as TagNodeType } from "../../scripts/library";

interface Props {
	node: TagNodeType;
	depth: number;
	expandedKeys: Set<string>;
	selectedKey: string | null;
	onToggleExpand: (key: string) => void;
	onSelect: (key: string) => void;
}

export default function TagNode({
	node,
	depth,
	expandedKeys,
	selectedKey,
	onToggleExpand,
	onSelect,
}: Props) {
	const hasChildren = node.children.length > 0;
	const isExpanded = expandedKeys.has(node.key);
	const isSelected = selectedKey === node.key;

	return (
		<div>
			<div
				class={`
					flex items-center gap-1 py-1 px-2 rounded cursor-pointer transition-colors
					${isSelected ? "bg-blue-500/20 text-blue-600 dark:text-blue-400" : "hover:bg-gray-100 dark:hover:bg-gray-800"}
				`}
				style={{ paddingLeft: `${depth * 16 + 8}px` }}
			>
				{/* Expand/Collapse indicator */}
				{hasChildren ? (
					<button
						onClick={(e) => {
							e.stopPropagation();
							onToggleExpand(node.key);
						}}
						class="w-5 h-5 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-mono shrink-0"
					>
						{isExpanded ? "[-]" : "[+]"}
					</button>
				) : (
					<span class="w-5 shrink-0" />
				)}

				{/* Tag name and count */}
				<button
					onClick={() => onSelect(node.key)}
					class="flex-1 text-left text-sm truncate"
				>
					<span class={isSelected ? "font-medium" : ""}>
						{node.displayName}
					</span>
					<span class="text-gray-400 dark:text-gray-500 ml-1">
						({node.resourceCount})
					</span>
				</button>
			</div>

			{/* Children */}
			{hasChildren && isExpanded && (
				<div>
					{node.children.map((child) => (
						<TagNode
							key={child.key}
							node={child}
							depth={depth + 1}
							expandedKeys={expandedKeys}
							selectedKey={selectedKey}
							onToggleExpand={onToggleExpand}
							onSelect={onSelect}
						/>
					))}
				</div>
			)}
		</div>
	);
}
