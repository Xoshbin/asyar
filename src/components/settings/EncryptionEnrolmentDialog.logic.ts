const MIN_LEN = 12;
const MAX_LEN = 256;
const MIN_STRENGTH_SCORE = 3;

export function evaluatePassphraseStrength(p: string): {
  accepted: boolean;
  score: number; // 0..4
  reason?: string;
} {
  // Use Unicode char count (not byte length).
  const charCount = [...p].length;
  if (charCount === 0) {
    return { accepted: false, score: 0, reason: 'Passphrase cannot be empty.' };
  }
  if (charCount < MIN_LEN) {
    return { accepted: false, score: 0, reason: `Minimum ${MIN_LEN} characters.` };
  }
  if (charCount > MAX_LEN) {
    return { accepted: false, score: 0, reason: `Maximum ${MAX_LEN} characters.` };
  }
  const score = quickScore(p);
  if (score < MIN_STRENGTH_SCORE) {
    return {
      accepted: false,
      score,
      reason: 'Too predictable. Try a passphrase with multiple unrelated words.',
    };
  }
  return { accepted: true, score };
}

// Length + character-class diversity heuristic. Substitute for zxcvbn until
// (or unless) the implementer decides to add the dep — the spec allows either.
function quickScore(p: string): number {
  const len = [...p].length;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/]
    .filter((re) => re.test(p)).length;
  const wordish = p.split(/[\s_-]+/).filter((w) => w.length >= 3).length;
  let score = 0;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  if (classes >= 2) score += 1;
  if (wordish >= 3) score += 1;
  return Math.min(score, 4);
}

export function pickWordVerificationIndices(): readonly [number, number, number] {
  // Three distinct indices in [0, 23].
  const all = Array.from({ length: 24 }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return [all[0], all[1], all[2]] as const;
}

export function shuffleAndSplitPhrase(phrase: string): readonly string[] {
  return phrase.trim().split(/\s+/);
}
