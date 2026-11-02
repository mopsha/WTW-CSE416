// Text other people will see (display names, group names, custom options, hang posts) must
// pass textFilter before it is stored (Razin, M4). Pure TS: runs in the Edge Function, Jest
// and the app. A word list, not a moderation service: it stops the obvious slurs and
// profanity, including common disguises (l33t, accents, repeated letters, s.p.a.c.i.n.g),
// and leaves the rest to reports.
//
// Server routes call requireCleanText (_shared/api/text.ts), which turns a rejection into a
// 400 TEXT_NOT_ALLOWED. The app may call textFilter too, to warn before sending.

export type TextFilterResult = { ok: true } | { ok: false; reason: 'blocked_word' };

/** Matched as a whole word (after normalizing), so "class" and "Scunthorpe" pass. */
const WORDS = [
  'asshole',
  'bastard',
  'bitch',
  'bitches',
  'chink',
  'cock',
  'cocksucker',
  'cunt',
  'dick',
  'dickhead',
  'dyke',
  'fag',
  'fags',
  'fuck',
  'fucked',
  'fucker',
  'fuckers',
  'fucking',
  'fuckoff',
  'kike',
  'kys',
  'motherfucker',
  'nazi',
  'pussy',
  'rape',
  'rapist',
  'retard',
  'retarded',
  'shit',
  'shitty',
  'slut',
  'spic',
  'tranny',
  'twat',
  'wanker',
  'wetback',
  'whore',
];

/** Matched anywhere, even inside a word: slurs no innocent word contains. */
const ANYWHERE = ['nigger', 'nigga', 'faggot'];
/** Real words that contain an ANYWHERE entry. */
const ALLOWED = new Set(['snigger', 'sniggers', 'sniggered', 'sniggering', 'niggard', 'niggardly']);

/** Whole phrases, matched on word boundaries. */
const PHRASES = ['kill yourself', 'kill urself', 'go die'];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
};

/** Lowercase, no accents, no zero-width characters; l33t decoded unless `leet` is false. */
export function normalizeForFilter(text: string, leet = true): string {
  const plain = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .toLowerCase();
  return leet ? plain.replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c) : plain;
}

/** "fuuuck" -> "fuck": runs of a letter become one. */
const squeeze = (word: string) => word.replace(/(.)\1+/g, '$1');

/**
 * "niiigggger" -> "nigger" but "Nigeria" stays: every ANYWHERE word's only double letter is
 * "gg", so runs squeeze to one letter except g, which squeezes to two.
 */
const looseSlur = (letters: string) =>
  letters.replace(/(.)\1+/g, (_run, c: string) => (c === 'g' ? 'gg' : c));

const WORD_SET = new Set(WORDS);
// Squeezed forms only for longer words: a short one like "fag" would squeeze too little to
// matter, and squeezing short innocent words ("too" -> "to") only adds false matches.
const SQUEEZED_SET = new Set(WORDS.filter((w) => w.length >= 4).map(squeeze));

function blockedWord(word: string): boolean {
  if (!word) return false;
  if (WORD_SET.has(word)) return true;
  return word.length >= 4 && SQUEEZED_SET.has(squeeze(word));
}

export function textFilter(text: string): TextFilterResult {
  // Both readings: "sh1t" needs l33t decoded, "bitch!" needs "!" left as punctuation.
  const blocked = matches(normalizeForFilter(text)) || matches(normalizeForFilter(text, false));
  return blocked ? { ok: false, reason: 'blocked_word' } : { ok: true };
}

function matches(normalized: string): boolean {
  const words = normalized.split(/[^a-z]+/).filter(Boolean);

  const letters = words.filter((w) => !ALLOWED.has(w)).join('');
  if (ANYWHERE.some((w) => looseSlur(letters).includes(w))) return true;
  if (words.some(blockedWord)) return true;

  // "f u c k", "f.u.c.k": runs of single letters read as one word.
  const runs = normalized.split(/[^a-z]*[a-z]{2,}[^a-z]*/);
  for (const run of runs) {
    const joined = run.replace(/[^a-z]/g, '');
    if (joined.length >= 3 && blockedWord(joined)) return true;
  }

  const spaced = ` ${words.join(' ')} `;
  return PHRASES.some((p) => spaced.includes(` ${p} `));
}
