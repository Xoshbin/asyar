/**
 * Field accessors that project an arbitrary item onto the shape the
 * tiered fuzzy ranker understands. `title` is the primary match target;
 * `subtitle` and `keywords` are secondary. Only `id` and `title` are required.
 */
export interface RankableFields<T> {
  id: (item: T) => string;
  title: (item: T) => string;
  subtitle?: (item: T) => string | undefined;
  keywords?: (item: T) => string[];
}

export enum MatchTier {
  ExactTitle = 1,
  TitlePrefix = 2,
  TitleFuzzy = 3,
  SubtitleOrKeyword = 4,
}

/**
 * Fast, allocation-efficient subsequence fuzzy match.
 * Returns a numerical score if `query` is a subsequence of `target`, or null if not.
 * Higher scores indicate better matches.
 */
export function fuzzyMatchScore(target: string, query: string): number | null {
  const tLen = target.length;
  const qLen = query.length;
  if (qLen === 0) return 0;
  if (qLen > tLen) return null;

  const tLower = target.toLowerCase();
  const qLower = query.toLowerCase();

  let qIdx = 0;
  let score = 0;
  let consecutive = 0;
  let prevMatchIdx = -1;

  for (let tIdx = 0; tIdx < tLen; tIdx++) {
    if (tLower[tIdx] === qLower[qIdx]) {
      let matchScore = 10;

      // Bonus for consecutive matching characters
      if (prevMatchIdx === tIdx - 1) {
        consecutive++;
        matchScore += consecutive * 6;
      } else {
        consecutive = 0;
      }

      // Bonus for word boundaries (start of string, whitespace, hyphen, underscore, slash, dot)
      if (tIdx === 0) {
        matchScore += 18;
      } else {
        const prevChar = target[tIdx - 1];
        if (
          prevChar === ' ' ||
          prevChar === '_' ||
          prevChar === '-' ||
          prevChar === '/' ||
          prevChar === '.'
        ) {
          matchScore += 14;
        } else if (
          target[tIdx] !== target[tIdx].toLowerCase() &&
          prevChar === prevChar.toLowerCase()
        ) {
          // CamelCase boundary bonus
          matchScore += 10;
        }
      }

      // Proximity to start bonus
      matchScore += Math.max(0, 8 - tIdx);

      score += matchScore;
      prevMatchIdx = tIdx;
      qIdx++;

      if (qIdx === qLen) {
        // Full query matched. Slight penalty for unmatched trailing length.
        score -= tLen - qLen;
        return score;
      }
    }
  }

  return null;
}

interface ClassifiedMatch<T> {
  item: T;
  id: string;
  tier: MatchTier;
  fuzzyScore: number;
  nameLower: string;
}

/**
 * Rank a list against a query using the Zero-IPC Fast Path in-memory tiered ranker.
 *
 * Implements the Data-Affinity Principle:
 * For data already resident in frontend memory (snippets, walkthrough, settings, store),
 * filtering and ranking execute directly in JavaScript with zero serialization and
 * zero IPC overhead across the Tauri bridge.
 *
 * - Empty or whitespace-only query: returns the list unchanged immediately.
 * - Non-empty query: classifies into tiers (ExactTitle → TitlePrefix → TitleFuzzy → SubtitleOrKeyword),
 *   sorts by best match first, and drops non-matches.
 */
export async function rankItems<T>(
  query: string,
  items: T[],
  fields: RankableFields<T>,
): Promise<T[]> {
  const trimmed = query.trim();
  if (!trimmed || items.length === 0) return items;

  return classifyRankItems(trimmed, items, fields).map((match) => match.item);
}

/** Classify and sort non-empty queries; numeric scores remain engine-specific. */
export function classifyRankItems<T>(
  query: string,
  items: T[],
  fields: RankableFields<T>,
): ClassifiedMatch<T>[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const qLower = trimmed.toLowerCase();
  const matches: ClassifiedMatch<T>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = fields.id(item);
    const title = fields.title(item);
    const titleLower = title.toLowerCase();

    // Tier 1: Exact Title Match
    if (titleLower === qLower) {
      matches.push({
        item,
        id,
        tier: MatchTier.ExactTitle,
        fuzzyScore: 1000,
        nameLower: titleLower,
      });
      continue;
    }

    // Tier 2: Title Prefix Match
    if (titleLower.startsWith(qLower)) {
      matches.push({
        item,
        id,
        tier: MatchTier.TitlePrefix,
        fuzzyScore: 500 + Math.max(0, 100 - titleLower.length),
        nameLower: titleLower,
      });
      continue;
    }

    // Tier 3: Title Fuzzy Match
    const titleFuzzy = fuzzyMatchScore(title, trimmed);
    if (titleFuzzy !== null) {
      matches.push({
        item,
        id,
        tier: MatchTier.TitleFuzzy,
        fuzzyScore: titleFuzzy,
        nameLower: titleLower,
      });
      continue;
    }

    // Tier 4: Subtitle or Keyword Match
    const subtitle = fields.subtitle?.(item);
    const keywords = fields.keywords?.(item) ?? [];
    // Shared fixture enforces Rust/TS membership and tiers, not numeric scores.
    const haystack = [subtitle, ...keywords].filter(Boolean).join(' ');
    const bestSecondaryScore = fuzzyMatchScore(haystack, trimmed);

    if (bestSecondaryScore !== null) {
      matches.push({
        item,
        id,
        tier: MatchTier.SubtitleOrKeyword,
        fuzzyScore: bestSecondaryScore,
        nameLower: titleLower,
      });
      continue;
    }

    // Non-matches are dropped
  }

  // Sort best matches first:
  // 1. Tier ascending (lower tier number is higher priority)
  // 2. Fuzzy score descending (higher score is better)
  // 3. Lowercase name alphabetical
  matches.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.fuzzyScore !== a.fuzzyScore) return b.fuzzyScore - a.fuzzyScore;
    return a.nameLower.localeCompare(b.nameLower);
  });

  return matches;
}
