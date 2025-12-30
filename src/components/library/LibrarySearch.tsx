interface Props {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}

export default function LibrarySearch({
	value,
	onChange,
	placeholder = "Search resources...",
}: Props) {
	return (
		<div class="relative">
			<input
				type="text"
				value={value}
				onInput={(e) => onChange((e.target as HTMLInputElement).value)}
				placeholder={placeholder}
				class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition-shadow"
			/>
			{value && (
				<button
					onClick={() => onChange("")}
					class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
					title="Clear search"
				>
					&times;
				</button>
			)}
		</div>
	);
}
