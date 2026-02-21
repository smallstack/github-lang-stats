import { detectLanguage, isExcludedLanguage } from "./language-detector.js";
import type { AggregatedStats, CommitDetail, RepoStats } from "./types.js";

// We accept the cache data object directly for aggregation
export function aggregate(
	user: string,
	commitsByRepo: Record<string, string[]>,
	commitDetails: Record<string, CommitDetail | null>,
	excludeLanguages: string[] = [],
	includeCommitDates: boolean = true
): AggregatedStats {
	const totals: Record<string, number> = {};
	const byRepo: Record<string, RepoStats> = {};

	let totalCommitsProcessed = 0;

	for (const [repoKey, shas] of Object.entries(commitsByRepo)) {
		const repoLangs: Record<string, number> = {};
		const commitDates: string[] = [];

		for (const sha of shas) {
			const detail = commitDetails[sha];
			if (!detail) continue; // not yet fetched or errored

			totalCommitsProcessed++;

			// Collect commit date if requested
			if (includeCommitDates && detail.date) {
				const date = new Date(detail.date);
				const isoDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
				commitDates.push(isoDate);
			}

			for (const file of detail.files) {
				const lang = detectLanguage(file.filename);
				if (!lang) continue;
				if (isExcludedLanguage(lang)) continue;
				if (excludeLanguages.includes(lang)) continue;

				const lines = file.additions + file.deletions;
				repoLangs[lang] = (repoLangs[lang] ?? 0) + lines;
				totals[lang] = (totals[lang] ?? 0) + lines;
			}
		}

		if (Object.keys(repoLangs).length > 0) {
			byRepo[repoKey] = repoLangs;
			// Add commit dates if collected
			if (includeCommitDates && commitDates.length > 0) {
				byRepo[repoKey].commitDates = commitDates;
			}
		}
	}

	// Sort totals descending
	const sortedTotals = Object.fromEntries(
		Object.entries(totals).sort(([, a], [, b]) => b - a)
	);

	// Sort byRepo entries descending within each repo
	const sortedByRepo = Object.fromEntries(
		Object.entries(byRepo)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([repo, data]) => {
				// Extract commitDates if present
				const { commitDates, ...langs } = data;
				// Sort language entries
				const sortedLangs = Object.fromEntries(
					Object.entries(langs).sort(([, a], [, b]) => (b as number) - (a as number))
				);
				// Re-add commitDates if it existed
				return commitDates
					? [repo, { ...sortedLangs, commitDates }]
					: [repo, sortedLangs];
			})
	);

	return {
		totals: sortedTotals,
		byRepo: sortedByRepo,
		meta: {
			user,
			generatedAt: new Date().toISOString(),
			totalCommitsProcessed,
			totalRepos: Object.keys(byRepo).length,
			unit: "lines_changed"
		}
	};
}
