// "Did you mean" ranking, after git's help.c: an edit distance weighted for
// typing errors, with prefix matches ranked first and only tied-best results shown.

const SWAP = 0, SUBSTITUTE = 2, MISSING = 1, EXTRA = 3;
// Scores at or above this are noise, not typos (git's SIMILARITY_FLOOR).
const FLOOR = 7;
const LIMIT = 5;

/** Cost of turning what was typed into `candidate`. Letters the user left out are cheap, extra ones dear. */
export function typoDistance(typed: string, candidate: string): number {
  let before = new Array<number>(candidate.length + 1).fill(0);
  let previous = Array.from({ length: candidate.length + 1 }, (_, j) => j * MISSING);
  for (let i = 0; i < typed.length; i++) {
    const current = [(i + 1) * EXTRA];
    for (let j = 0; j < candidate.length; j++) {
      let cost = previous[j]! + (typed[i] === candidate[j] ? 0 : SUBSTITUTE);
      if (i > 0 && j > 0 && typed[i - 1] === candidate[j] && typed[i] === candidate[j - 1]) cost = Math.min(cost, before[j - 1]! + SWAP);
      current.push(Math.min(cost, previous[j + 1]! + EXTRA, current[j]! + MISSING));
    }
    [before, previous] = [previous, current];
  }
  return previous[candidate.length]!;
}

// Git's floor alone lets short words match anything ("foo" → "doctor", "x" → "ls"): also bound the
// distance by word length and require half the typed letters to appear in the candidate.
function plausible(typed: string, candidate: string, distance: number) {
  if (distance > Math.max(3, Math.ceil(Math.max(typed.length, candidate.length) / 2))) return false;
  const pool = [...candidate];
  let shared = 0;
  for (const letter of typed) {
    const at = pool.indexOf(letter);
    if (at >= 0) { shared++; pool.splice(at, 1); }
  }
  return shared * 2 >= typed.length;
}

/**
 * Candidates the user most likely meant by `typed`, best first; empty when nothing is close.
 * `synonyms` maps words no typo explains ("list") to the candidate they should suggest ("ls").
 */
export function suggest(typed: string, candidates: readonly string[], synonyms: Readonly<Record<string, string>> = {}): string[] {
  const input = typed.toLowerCase();
  if (!input) return [];
  if (Object.hasOwn(synonyms, input) && candidates.includes(synonyms[input]!)) return [synonyms[input]!];
  const words = [...new Set([...candidates, ...Object.keys(synonyms).filter(word => candidates.includes(synonyms[word]!))])];
  const scored = words.filter(candidate => candidate !== typed).map(candidate => {
    const word = candidate.toLowerCase();
    const distance = typoDistance(input, word);
    if (input.length >= 2 && word.startsWith(input)) return { candidate, score: 0, distance, close: true };
    return { candidate, score: distance + 1, distance, close: distance + 1 < FLOOR && plausible(input, word, distance) };
  }).filter(entry => entry.close);
  const best = Math.min(...scored.map(entry => entry.score));
  let tied = scored.filter(entry => entry.score === best);
  // "log" is one letter short of "logs"; that beats being a prefix of "login" and "logout".
  if (tied.some(entry => entry.distance <= MISSING)) tied = tied.filter(entry => entry.distance <= MISSING);
  return [...new Set(tied.map(entry => synonyms[entry.candidate] ?? entry.candidate))].slice(0, LIMIT);
}
