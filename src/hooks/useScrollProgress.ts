import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export type ScrollProgress = {
	/** 0 = element just entered bottom of viewport, 1 = just left top */
	progress: number;
	/** Is the element currently in the viewport? */
	isInView: boolean;
};

/**
 * Tracks how far an element has scrolled through the viewport.
 *
 * - `start` (default 0): viewport ratio where tracking begins (0 = bottom edge)
 * - `end` (default 1): viewport ratio where tracking ends (1 = top edge)
 *
 * Returns a ref to attach + a progress object.
 */
export function useScrollProgress(
	options: { start?: number; end?: number } = {},
) {
	const { start = 0, end = 1 } = options;
	const ref = useRef<HTMLDivElement>(null);
	const [scroll, setScroll] = useState<ScrollProgress>({
		progress: 0,
		isInView: false,
	});
	const raf = useRef<number>(0);

	const update = useCallback(() => {
		const el = ref.current;
		if (!el) return;

		const rect = el.getBoundingClientRect();
		const vh = window.innerHeight;

		// Where the element top is relative to viewport (0 = bottom, 1 = top)
		const rawProgress = (vh - rect.top) / (vh + rect.height);
		const mapped = (rawProgress - start) / (end - start);
		const clamped = Math.min(1, Math.max(0, mapped));

		const isInView = rect.bottom > 0 && rect.top < vh;

		setScroll((prev) => {
			if (
				Math.abs(prev.progress - clamped) < 0.001 &&
				prev.isInView === isInView
			)
				return prev;
			return { progress: clamped, isInView };
		});
	}, [start, end]);

	useEffect(() => {
		const onScroll = () => {
			cancelAnimationFrame(raf.current);
			raf.current = requestAnimationFrame(update);
		};

		update();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(raf.current);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [update]);

	return { ref, ...scroll };
}

/**
 * Linearly interpolate between `from` and `to` based on `progress` (0–1).
 */
export function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}

/**
 * Map progress to a value within a sub-range.
 * E.g. `ranged(0.3, 0.7, progress)` returns 0 before 0.3, 1 after 0.7,
 * and a linear 0–1 in between.
 */
export function ranged(start: number, end: number, progress: number): number {
	return Math.min(1, Math.max(0, (progress - start) / (end - start)));
}
