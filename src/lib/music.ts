// Raw types from wtm.json
export interface Artist {
	id: string;
	name: string;
}

export interface Album {
	id: string;
	name: string;
	release_date: string;
	artists: Artist[];
	typ: string;
	added_at: number;
}

export interface Duration {
	secs: number;
	nanos: number;
}

export interface Track {
	id: string;
	name: string;
	artists: Artist[];
	album: Album;
	duration: Duration;
	explicit: boolean;
}

export interface PlaylistMeta {
	id: string;
	collaborative: boolean;
	name: string;
	owner: string[];
	desc: string;
	snapshot_id: string;
}

export interface SpotifyData {
	playlist: PlaylistMeta;
	tracks: Track[];
}

// Derived types for UI
export interface TrackDisplay {
	id: string;
	name: string;
	artistNames: string;
	artistIds: string[];
	albumName: string;
	albumId: string;
	releaseYear: number;
	decade: string;
	durationSecs: number;
	durationDisplay: string;
	explicit: boolean;
	spotifyUrl: string;
}

export type SortBy = "name" | "artist" | "year" | "duration";
export type SortOrder = "asc" | "desc";

// Transform raw track to display format
export function transformTrack(track: Track): TrackDisplay {
	const releaseYear =
		parseInt(track.album.release_date.substring(0, 4), 10) || 0;
	const decade = `${Math.floor(releaseYear / 10) * 10}s`;
	const durationSecs = track.duration.secs;
	const minutes = Math.floor(durationSecs / 60);
	const seconds = durationSecs % 60;

	return {
		id: track.id,
		name: track.name,
		artistNames: track.artists.map((a) => a.name).join(", "),
		artistIds: track.artists.map((a) => a.id),
		albumName: track.album.name,
		albumId: track.album.id,
		releaseYear,
		decade,
		durationSecs,
		durationDisplay: `${minutes}:${seconds.toString().padStart(2, "0")}`,
		explicit: track.explicit,
		spotifyUrl: `https://open.spotify.com/track/${track.id}`,
	};
}

// Parse and transform full dataset
export function parseSpotifyData(data: SpotifyData): TrackDisplay[] {
	return data.tracks.map(transformTrack);
}

// Get unique decades from tracks
export function getDecades(tracks: TrackDisplay[]): string[] {
	const decades = new Set(tracks.map((t) => t.decade));
	return Array.from(decades).sort();
}

// Filter tracks by search query
export function searchTracks(
	tracks: TrackDisplay[],
	query: string,
): TrackDisplay[] {
	if (!query.trim()) return tracks;
	const q = query.toLowerCase();
	return tracks.filter(
		(t) =>
			t.name.toLowerCase().includes(q) ||
			t.artistNames.toLowerCase().includes(q) ||
			t.albumName.toLowerCase().includes(q),
	);
}

// Filter by decades
export function filterByDecades(
	tracks: TrackDisplay[],
	decades: string[],
): TrackDisplay[] {
	if (decades.length === 0) return tracks;
	return tracks.filter((t) => decades.includes(t.decade));
}

// Filter by explicit
export function filterByExplicit(
	tracks: TrackDisplay[],
	explicitFilter: "all" | "explicit" | "clean",
): TrackDisplay[] {
	if (explicitFilter === "all") return tracks;
	if (explicitFilter === "explicit") return tracks.filter((t) => t.explicit);
	return tracks.filter((t) => !t.explicit);
}

// Sort tracks
export function sortTracks(
	tracks: TrackDisplay[],
	sortBy: SortBy,
	order: SortOrder,
): TrackDisplay[] {
	const sorted = [...tracks].sort((a, b) => {
		switch (sortBy) {
			case "name":
				return a.name.localeCompare(b.name);
			case "artist":
				return a.artistNames.localeCompare(b.artistNames);
			case "year":
				return a.releaseYear - b.releaseYear;
			case "duration":
				return a.durationSecs - b.durationSecs;
			default:
				return 0;
		}
	});
	return order === "desc" ? sorted.reverse() : sorted;
}

// Stats types and functions
export interface ArtistCount {
	name: string;
	count: number;
}

export interface DecadeCount {
	decade: string;
	count: number;
}

export interface Stats {
	totalTracks: number;
	uniqueArtists: number;
	totalDurationSecs: number;
	totalDurationDisplay: string;
	topArtists: ArtistCount[];
	decadeBreakdown: DecadeCount[];
	explicitCount: number;
	cleanCount: number;
}

export function computeStats(tracks: TrackDisplay[]): Stats {
	// Count artists
	const artistCounts = new Map<string, number>();
	for (const track of tracks) {
		for (const name of track.artistNames.split(", ")) {
			artistCounts.set(name, (artistCounts.get(name) || 0) + 1);
		}
	}
	const topArtists = Array.from(artistCounts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);

	// Count decades
	const decadeCounts = new Map<string, number>();
	for (const track of tracks) {
		decadeCounts.set(track.decade, (decadeCounts.get(track.decade) || 0) + 1);
	}
	const decadeBreakdown = Array.from(decadeCounts.entries())
		.map(([decade, count]) => ({ decade, count }))
		.sort((a, b) => a.decade.localeCompare(b.decade));

	// Total duration
	const totalDurationSecs = tracks.reduce((sum, t) => sum + t.durationSecs, 0);
	const hours = Math.floor(totalDurationSecs / 3600);
	const minutes = Math.floor((totalDurationSecs % 3600) / 60);
	const totalDurationDisplay = `${hours}h ${minutes}m`;

	// Explicit counts
	const explicitCount = tracks.filter((t) => t.explicit).length;
	const cleanCount = tracks.length - explicitCount;

	return {
		totalTracks: tracks.length,
		uniqueArtists: artistCounts.size,
		totalDurationSecs,
		totalDurationDisplay,
		topArtists,
		decadeBreakdown,
		explicitCount,
		cleanCount,
	};
}

// Format duration from seconds
export function formatDuration(secs: number): string {
	const hours = Math.floor(secs / 3600);
	const minutes = Math.floor((secs % 3600) / 60);
	const seconds = secs % 60;
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Export helpers
export function exportAsJson(tracks: TrackDisplay[]): string {
	return JSON.stringify(
		tracks.map((t) => ({
			name: t.name,
			artist: t.artistNames,
			album: t.albumName,
			year: t.releaseYear,
			duration: t.durationDisplay,
			spotifyUrl: t.spotifyUrl,
		})),
		null,
		2,
	);
}

export function exportAsText(tracks: TrackDisplay[]): string {
	return tracks.map((t) => `${t.name} - ${t.artistNames}`).join("\n");
}

export function exportAsSpotifyUris(tracks: TrackDisplay[]): string {
	return tracks.map((t) => `spotify:track:${t.id}`).join("\n");
}
