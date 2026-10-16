export interface CatalogEntry {
  id: string;
  name: string;
  nameAm: string | null;
  category: string;
  description: string | null;
  documents: string[];
}

export interface KeywordMatch {
  id: string;
  score: number;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'need', 'want', 'how', 'can', 'get',
  'you', 'are', 'not', 'was', 'but', 'what', 'when', 'where', 'who', 'will', 'would', 'could',
  'should', 'been', 'has', 'had', 'its', 'our', 'your', 'their', 'about', 'into', 'please', 'help', 'new', 'one',
]);


function stems(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const isAscii = /^[\u0000-\u007f]+$/.test(word);
    if (word.length < (isAscii ? 3 : 2) || STOPWORDS.has(word)) continue;
    result.add(isAscii && word.length > 5 ? word.slice(0, 5) : word);
  }
  return result;
}

export function rankServices(query: string, entries: CatalogEntry[]): KeywordMatch[] {
  const queryStems = stems(query);

  return entries
    .map((entry) => {
      const weights = new Map<string, number>();
      const add = (text: string | null, weight: number): void => {
        if (!text) return;
        for (const stem of stems(text)) weights.set(stem, Math.max(weights.get(stem) ?? 0, weight));
      };
      add(entry.name, 3);
      add(entry.nameAm, 3);
      add(entry.category, 2);
      add(entry.description, 1);
      for (const document of entry.documents) add(document, 1);

      let score = 0;
      for (const stem of queryStems) score += weights.get(stem) ?? 0;
      return { id: entry.id, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}