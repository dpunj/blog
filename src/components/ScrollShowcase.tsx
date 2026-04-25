import { forwardRef } from "preact/compat";
import { lerp, ranged, useScrollProgress } from "../hooks/useScrollProgress";

/* ─── Section wrapper (supports ref forwarding) ─── */
const Section = forwardRef<
	HTMLElement,
	{
		children: preact.ComponentChildren;
		className?: string;
		height?: string;
	}
>(({ children, className = "", height = "150vh" }, ref) => {
	return (
		<section
			ref={ref}
			class={`relative ${className}`}
			style={{ minHeight: height }}
		>
			{children}
		</section>
	);
});

/* ━━━ 1. Hero — scale down + fade out as you scroll ━━━ */
function HeroSection() {
	const { ref, progress } = useScrollProgress({ start: 0.15, end: 0.65 });

	const scale = lerp(1, 0.7, progress);
	const opacity = lerp(1, 0, progress);
	const blur = lerp(0, 10, progress);

	return (
		<Section ref={ref} height="120vh">
			<div
				class="sticky top-0 flex h-screen items-center justify-center"
				style={{
					transform: `scale(${scale})`,
					opacity,
					filter: `blur(${blur}px)`,
					willChange: "transform, opacity, filter",
				}}
			>
				<div class="text-center px-4">
					<h1 class="text-6xl sm:text-8xl font-black tracking-tight bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 bg-clip-text text-transparent">
						Scroll Down
					</h1>
					<p class="mt-4 text-lg text-blue-300/70 dark:text-blue-300/70">
						↓ keep going ↓
					</p>
				</div>
			</div>
		</Section>
	);
}

/* ━━━ 2. Image reveal — pinned image that scales, rotates, un-clips ━━━ */
function ImageRevealSection() {
	const { ref, progress } = useScrollProgress({ start: 0.1, end: 0.75 });

	// Phase 1 (0–0.5): zoom in from small + rotate
	const p1 = ranged(0, 0.5, progress);
	const scale = lerp(0.4, 1, easeOut(p1));
	const rotate = lerp(-6, 0, easeOut(p1));

	// Phase 2 (0.4–1.0): clip circle opens up
	const p2 = ranged(0.4, 1, progress);
	const clipRadius = lerp(15, 75, easeOut(p2));

	// Continuous parallax on the image
	const translateY = lerp(30, -30, progress);

	return (
		<Section ref={ref} height="200vh">
			<div class="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
				<div
					class="relative w-[85vw] max-w-2xl aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl shadow-blue-500/20"
					style={{
						transform: `scale(${scale}) rotate(${rotate}deg)`,
						clipPath: `circle(${clipRadius}% at 50% 50%)`,
						willChange: "transform, clip-path",
					}}
				>
					{/* Gradient placeholder — swap for a real image! */}
					<div
						class="absolute inset-0 bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-600"
						style={{
							transform: `translateY(${translateY}px)`,
							willChange: "transform",
						}}
					/>
					<div
						class="absolute inset-0 flex items-center justify-center"
						style={{ transform: `translateY(${translateY}px)` }}
					>
						<span class="text-8xl select-none">🌊</span>
					</div>
				</div>

				{/* Progress indicator */}
				<div class="absolute bottom-8 left-1/2 -translate-x-1/2">
					<div class="w-32 h-1 rounded-full bg-blue-900/30 dark:bg-blue-100/20 overflow-hidden">
						<div
							class="h-full bg-sky-400 rounded-full"
							style={{ width: `${progress * 100}%` }}
						/>
					</div>
				</div>
			</div>
		</Section>
	);
}

/* ━━━ iPhone mockup frame (pure CSS) ━━━ */
function IPhoneFrame({
	children,
	className = "",
	style = {},
}: {
	children: preact.ComponentChildren;
	className?: string;
	style?: Record<string, string | number>;
}) {
	return (
		<div
			class={`relative ${className}`}
			style={{
				width: 280,
				height: 580,
				...style,
			}}
		>
			{/* Outer shell */}
			<div class="absolute inset-0 rounded-[50px] bg-gradient-to-b from-[#2a2a2e] to-[#1a1a1e] shadow-2xl shadow-black/50 border border-[#3a3a3e]">
				{/* Side button (right) */}
				<div class="absolute -right-[2px] top-[120px] w-[3px] h-[60px] rounded-r-sm bg-[#2a2a2e]" />
				{/* Volume buttons (left) */}
				<div class="absolute -left-[2px] top-[100px] w-[3px] h-[30px] rounded-l-sm bg-[#2a2a2e]" />
				<div class="absolute -left-[2px] top-[145px] w-[3px] h-[50px] rounded-l-sm bg-[#2a2a2e]" />
				<div class="absolute -left-[2px] top-[205px] w-[3px] h-[50px] rounded-l-sm bg-[#2a2a2e]" />
			</div>

			{/* Screen area */}
			<div class="absolute inset-[4px] rounded-[46px] overflow-hidden bg-black">
				{/* Dynamic Island */}
				<div class="absolute top-[10px] left-1/2 -translate-x-1/2 z-20 w-[100px] h-[30px] rounded-full bg-black" />

				{/* Home indicator */}
				<div class="absolute bottom-[8px] left-1/2 -translate-x-1/2 z-20 w-[120px] h-[4px] rounded-full bg-white/30" />

				{/* Screen content */}
				<div class="absolute inset-0 overflow-hidden">{children}</div>
			</div>

			{/* Screen glass reflection */}
			<div
				class="absolute inset-[4px] rounded-[46px] pointer-events-none z-10"
				style={{
					background:
						"linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, transparent 100%)",
				}}
			/>
		</div>
	);
}

/* ━━━ Screen content slides for the phone ━━━ */
function PhoneScreen({
	active,
	children,
}: {
	active: boolean;
	children: preact.ComponentChildren;
}) {
	return (
		<div
			class="absolute inset-0 flex flex-col items-center justify-center transition-none"
			style={{
				opacity: active ? 1 : 0,
				transform: active ? "scale(1)" : "scale(0.92)",
				willChange: "opacity, transform",
			}}
		>
			{children}
		</div>
	);
}

/* ━━━ 3. iPhone Preview — 3D rotate + screen cycling ━━━ */
function IPhoneSection() {
	const { ref, progress } = useScrollProgress({ start: 0.05, end: 0.85 });

	// Phase 1 (0–0.3): Phone rises + rotates from 3D perspective to face-on
	const p1 = ranged(0, 0.3, progress);
	const rotateX = lerp(40, 0, easeOut(p1));
	const rotateY = lerp(-15, 0, easeOut(p1));
	const phoneScale = lerp(0.7, 1, easeOut(p1));
	const phoneY = lerp(80, 0, easeOut(p1));

	// Phase 2 (0.25–0.85): Screen content cycles through
	const screenProgress = ranged(0.25, 0.85, progress);
	const activeScreen = Math.min(3, Math.floor(screenProgress * 4));

	// Phase 3 (0.7–1.0): Phone tilts away
	const p3 = ranged(0.75, 1, progress);
	const exitRotateY = lerp(0, 20, easeOut(p3));
	const exitScale = lerp(1, 0.85, easeOut(p3));
	const exitOpacity = lerp(1, 0, p3);

	// Feature labels that appear alongside
	const features = [
		{ icon: "📱", title: "Responsive", desc: "Adapts to any screen" },
		{ icon: "⚡", title: "Lightning Fast", desc: "60fps scroll animations" },
		{ icon: "🎨", title: "Pixel Perfect", desc: "Every detail matters" },
		{ icon: "✨", title: "Delightful", desc: "Interactions that spark joy" },
	];

	const screens = [
		// Screen 0: App grid
		<div class="w-full h-full bg-gradient-to-b from-[#1c1c2e] to-[#0f0f1a] p-6 pt-14">
			<p class="text-white/50 text-xs font-medium mb-4 mt-2">FAVORITES</p>
			<div class="grid grid-cols-4 gap-3">
				{["📸", "🎵", "💬", "📧", "🗺️", "⚙️", "📝", "🎮"].map((e, i) => (
					<div
						key={i}
						class="aspect-square rounded-2xl bg-white/10 flex items-center justify-center text-2xl"
					>
						{e}
					</div>
				))}
			</div>
			<div class="mt-6 rounded-2xl bg-white/5 p-3">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-sky-500/30 flex items-center justify-center text-lg">
						🌊
					</div>
					<div>
						<p class="text-white text-sm font-medium">divesh.gg</p>
						<p class="text-white/40 text-xs">Now playing</p>
					</div>
				</div>
			</div>
		</div>,

		// Screen 1: Notification / feed
		<div class="w-full h-full bg-gradient-to-b from-[#0f172a] to-[#1e1b4b] p-5 pt-14">
			<p class="text-white text-lg font-bold mb-4 mt-2">Activity</p>
			{[
				{ t: "New wave published", s: "2m ago", e: "🌊" },
				{ t: "Library updated", s: "1h ago", e: "📚" },
				{ t: "3 new bookmarks", s: "3h ago", e: "🔖" },
			].map((n, i) => (
				<div
					key={i}
					class="flex items-center gap-3 py-3 border-b border-white/5"
				>
					<div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-lg">
						{n.e}
					</div>
					<div class="flex-1">
						<p class="text-white text-sm">{n.t}</p>
						<p class="text-white/30 text-xs">{n.s}</p>
					</div>
				</div>
			))}
		</div>,

		// Screen 2: Stats / dashboard
		<div class="w-full h-full bg-gradient-to-b from-[#0c0a1d] to-[#1a0f2e] p-5 pt-14">
			<p class="text-white text-lg font-bold mb-4 mt-2">Insights</p>
			<div class="grid grid-cols-2 gap-3">
				{[
					{ v: "2.4k", l: "Visitors", c: "from-sky-500 to-blue-600" },
					{ v: "142", l: "Posts", c: "from-purple-500 to-indigo-600" },
					{ v: "89%", l: "Uptime", c: "from-emerald-500 to-teal-600" },
					{ v: "1.2s", l: "Load", c: "from-amber-500 to-orange-600" },
				].map((s, i) => (
					<div key={i} class={`rounded-2xl bg-gradient-to-br ${s.c} p-4`}>
						<p class="text-white text-2xl font-bold">{s.v}</p>
						<p class="text-white/60 text-xs mt-1">{s.l}</p>
					</div>
				))}
			</div>
			{/* Mini chart */}
			<div class="mt-4 rounded-2xl bg-white/5 p-4">
				<div class="flex items-end gap-1 h-16">
					{[40, 65, 45, 80, 55, 90, 70, 95, 60, 85, 75, 100].map((h, i) => (
						<div
							key={i}
							class="flex-1 rounded-t bg-gradient-to-t from-sky-500 to-indigo-400"
							style={{ height: `${h}%` }}
						/>
					))}
				</div>
			</div>
		</div>,

		// Screen 3: Profile
		<div class="w-full h-full bg-gradient-to-b from-[#0a0a1a] to-[#111128] flex flex-col items-center justify-center">
			<div class="w-20 h-20 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-4xl mb-4">
				🧑‍💻
			</div>
			<p class="text-white text-xl font-bold">Divesh</p>
			<p class="text-white/40 text-sm mt-1">divesh.gg</p>
			<div class="flex gap-6 mt-6">
				{[
					{ v: "42", l: "Waves" },
					{ v: "12", l: "Depths" },
					{ v: "∞", l: "Ideas" },
				].map((s, i) => (
					<div key={i} class="text-center">
						<p class="text-white text-lg font-bold">{s.v}</p>
						<p class="text-white/30 text-xs">{s.l}</p>
					</div>
				))}
			</div>
			<div class="mt-6 px-6 py-2 rounded-full bg-sky-500/20 border border-sky-400/30">
				<p class="text-sky-300 text-sm font-medium">Follow</p>
			</div>
		</div>,
	];

	return (
		<Section ref={ref} height="250vh">
			<div class="sticky top-0 h-screen flex items-center justify-center overflow-hidden">
				<div class="flex flex-col lg:flex-row items-center gap-8 lg:gap-16 px-6">
					{/* Phone */}
					<div
						style={{
							perspective: "1200px",
							perspectiveOrigin: "50% 50%",
						}}
					>
						<div
							style={{
								transform: `translateY(${phoneY}px) scale(${phoneScale * exitScale}) rotateX(${rotateX}deg) rotateY(${rotateY + exitRotateY}deg)`,
								opacity: exitOpacity,
								transformStyle: "preserve-3d",
								willChange: "transform, opacity",
							}}
						>
							<IPhoneFrame>
								{screens.map((screen, i) => (
									<PhoneScreen key={i} active={i === activeScreen}>
										{screen}
									</PhoneScreen>
								))}
							</IPhoneFrame>
						</div>
					</div>

					{/* Feature labels */}
					<div class="flex flex-col gap-4 max-w-xs">
						{features.map((f, i) => {
							const fProgress = ranged(
								0.2 + i * 0.15,
								0.35 + i * 0.15,
								progress,
							);
							return (
								<div
									key={i}
									class="flex items-center gap-4"
									style={{
										opacity: lerp(0, 1, easeOut(fProgress)),
										transform: `translateX(${lerp(30, 0, easeOut(fProgress))}px)`,
										willChange: "transform, opacity",
									}}
								>
									<div
										class="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
										style={{
											background:
												i === activeScreen
													? "rgba(56, 189, 248, 0.15)"
													: "rgba(56, 189, 248, 0.05)",
											borderWidth: 1,
											borderStyle: "solid",
											borderColor:
												i === activeScreen
													? "rgba(56, 189, 248, 0.3)"
													: "rgba(56, 189, 248, 0.1)",
											transition: "background 0.3s, border-color 0.3s",
										}}
									>
										{f.icon}
									</div>
									<div>
										<p
											class="font-semibold text-sm"
											style={{
												color:
													i === activeScreen
														? "rgb(125, 211, 252)"
														: "rgb(148, 163, 184)",
												transition: "color 0.3s",
											}}
										>
											{f.title}
										</p>
										<p class="text-xs text-blue-300/40 dark:text-blue-300/40">
											{f.desc}
										</p>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Screen dots indicator */}
				<div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2">
					{[0, 1, 2, 3].map((i) => (
						<div
							key={i}
							class="rounded-full transition-all duration-300"
							style={{
								width: i === activeScreen ? 24 : 8,
								height: 8,
								background:
									i === activeScreen
										? "rgb(56, 189, 248)"
										: "rgba(56, 189, 248, 0.2)",
							}}
						/>
					))}
				</div>
			</div>
		</Section>
	);
}

/* ━━━ 3. Text reveal — words fade in one by one ━━━ */
function TextRevealSection() {
	const { ref, progress } = useScrollProgress({ start: 0.05, end: 0.85 });

	const words =
		"Every great product is built on a foundation of obsessive attention to detail and the courage to ship anyway".split(
			" ",
		);

	return (
		<Section ref={ref} height="180vh">
			<div class="sticky top-0 flex h-screen items-center justify-center px-6">
				<p class="text-3xl sm:text-5xl font-bold leading-tight max-w-3xl text-center">
					{words.map((word, i) => {
						const wordProgress = ranged(
							i / words.length,
							(i + 1) / words.length,
							progress,
						);
						return (
							<span
								key={i}
								class="inline-block mr-[0.3em] transition-none"
								style={{
									opacity: lerp(0.12, 1, easeOut(wordProgress)),
									filter: `blur(${lerp(4, 0, easeOut(wordProgress))}px)`,
									transform: `translateY(${lerp(8, 0, easeOut(wordProgress))}px)`,
								}}
							>
								{word}
							</span>
						);
					})}
				</p>
			</div>
		</Section>
	);
}

/* ━━━ 4. Cards — stacked cards that fan out ━━━ */
function CardsSection() {
	const { ref, progress } = useScrollProgress({ start: 0.05, end: 0.8 });

	const cards = [
		{ emoji: "⚡", label: "Fast", color: "from-amber-400 to-orange-500" },
		{ emoji: "🎨", label: "Beautiful", color: "from-pink-400 to-rose-500" },
		{ emoji: "🔒", label: "Secure", color: "from-emerald-400 to-teal-500" },
		{ emoji: "🌍", label: "Global", color: "from-sky-400 to-blue-500" },
	];

	return (
		<Section ref={ref} height="180vh">
			<div class="sticky top-0 flex h-screen items-center justify-center">
				<div class="relative w-64 h-80">
					{cards.map((card, i) => {
						const cardProgress = ranged(0, 0.7, progress);
						const spread = lerp(0, 1, easeOut(cardProgress));

						// Fan out from center
						const angle = lerp(0, (i - 1.5) * 12, spread);
						const x = lerp(0, (i - 1.5) * 70, spread);
						const y = lerp(i * -3, 0, spread);
						const cardScale = lerp(1 - i * 0.02, 1, spread);

						// Fade in
						const fadeP = ranged(i * 0.05, i * 0.05 + 0.3, progress);

						return (
							<div
								key={i}
								class={`absolute inset-0 rounded-2xl bg-gradient-to-br ${card.color} shadow-xl flex flex-col items-center justify-center text-white`}
								style={{
									transform: `translateX(${x}px) translateY(${y}px) rotate(${angle}deg) scale(${cardScale})`,
									opacity: lerp(0.5, 1, easeOut(fadeP)),
									zIndex: cards.length - i,
									willChange: "transform, opacity",
								}}
							>
								<span class="text-5xl mb-3">{card.emoji}</span>
								<span class="text-xl font-semibold">{card.label}</span>
							</div>
						);
					})}
				</div>
			</div>
		</Section>
	);
}

/* ━━━ 5. Horizontal scroll — translate X on scroll ━━━ */
function HorizontalSection() {
	const { ref, progress } = useScrollProgress({ start: 0.05, end: 0.9 });

	const items = ["Design", "Develop", "Deploy", "Delight"];
	const translateX = lerp(10, -70, easeInOut(progress));

	return (
		<Section ref={ref} height="200vh">
			<div class="sticky top-0 h-screen flex items-center overflow-hidden">
				<div
					class="flex gap-8 px-8"
					style={{
						transform: `translateX(${translateX}%)`,
						willChange: "transform",
					}}
				>
					{items.map((item, i) => (
						<div
							key={i}
							class="flex-shrink-0 w-[70vw] max-w-lg h-[50vh] rounded-3xl bg-gradient-to-br from-blue-800/50 to-indigo-900/50 dark:from-blue-800/30 dark:to-indigo-900/30 backdrop-blur border border-blue-300/20 dark:border-blue-500/20 flex items-center justify-center"
						>
							<div class="text-center">
								<span class="text-6xl sm:text-8xl font-black bg-gradient-to-r from-sky-300 to-blue-400 bg-clip-text text-transparent">
									{String(i + 1).padStart(2, "0")}
								</span>
								<p class="mt-4 text-2xl font-semibold text-blue-200">{item}</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</Section>
	);
}

/* ━━━ Easing helpers ━━━ */
function easeOut(t: number): number {
	return 1 - (1 - t) ** 3;
}
function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/* ━━━ Main showcase ━━━ */
export default function ScrollShowcase() {
	return (
		<div class="relative">
			<HeroSection />
			<ImageRevealSection />
			<IPhoneSection />
			<TextRevealSection />
			<CardsSection />
			<HorizontalSection />

			{/* End card */}
			<div class="flex items-center justify-center h-[50vh]">
				<div class="text-center">
					<p class="text-4xl font-bold bg-gradient-to-r from-sky-400 to-indigo-500 bg-clip-text text-transparent">
						That's the vibe ✨
					</p>
					<p class="mt-2 text-blue-400/60 text-sm">
						Zero dependencies. Just scroll events + transforms.
					</p>
				</div>
			</div>
		</div>
	);
}
