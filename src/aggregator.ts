import { detectLanguage, isExcludedLanguage } from "./language-detector.js";
import type { AggregatedStats, CommitDetail } from "./types.js";

// We accept the cache data object directly for aggregation
export function aggregate(
	user: string,
	commitsByRepo: Record<string, string[]>,
	commitDetails: Record<string, CommitDetail | null>,
	excludeLanguages: string[] = []
): AggregatedStats {
	const totals: Record<string, number> = {};
	const byRepo: Record<string, Record<string, number>> = {};

	let totalCommitsProcessed = 0;

	for (const [repoKey, shas] of Object.entries(commitsByRepo)) {
		const repoLangs: Record<string, number> = {};

		for (const sha of shas) {
			const detail = commitDetails[sha];
			if (!detail) continue; // not yet fetched or errored

			totalCommitsProcessed++;

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
			.map(([repo, langs]) => [
				repo,
				Object.fromEntries(Object.entries(langs).sort(([, a], [, b]) => b - a))
			])
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
