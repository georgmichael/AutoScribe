const BIBLE_BOOKS = [
  // Old Testament
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
  '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther',
  'Job', 'Psalms?', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
  'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  // New Testament
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians',
  'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter',
  '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

const booksPattern = BIBLE_BOOKS.join('|');

// Match three spoken patterns:
// 1. "John 3:16" or "John 3:16-18" (standard colon format)
// 2. "John chapter 3 verse 16" or "John chapter 3 verses 16 through 18"
// 3. "John 316" or "John 3 16" (no colon, digits together or space-separated)
const PATTERNS = [
  // Standard: "John 3:16", "John 3:16-18", "John 3:16-4:2"
  `((?:${booksPattern})\\s+\\d+:\\d+(?:\\s*-\\s*\\d+(?::\\d+)?)?)`,
  // Spoken: "John chapter 3 verse 16", "John chapter 3 verses 16 through 20"
  `((?:${booksPattern})\\s+chapter\\s+\\d+\\s+verses?\\s+\\d+(?:\\s+(?:through|to|-)\\s+\\d+)?)`,
  // No colon: "John 316" (2-4 digits, split as chapter+verse) or "John 3 16" (space-separated)
  `((?:${booksPattern})\\s+\\d{1,3}\\s+\\d{1,3}(?:\\s*-\\s*\\d+)?)`,
  `((?:${booksPattern})\\s+\\d{2,})`,
];

export const BIBLE_REF_REGEX = new RegExp(PATTERNS.join('|'), 'gi');

/**
 * Normalize a matched reference to standard "Book Chapter:Verse" format.
 */
function normalizeReference(raw: string): string {
  // Already has colon - standard format, return as-is
  if (raw.includes(':')) return raw;

  // "chapter X verse(s) Y (through Z)" pattern
  const chapterVerseMatch = raw.match(
    /^(.+?)\s+chapter\s+(\d+)\s+verses?\s+(\d+)(?:\s+(?:through|to|-)\s+(\d+))?$/i
  );
  if (chapterVerseMatch) {
    const [, book, ch, v, vEnd] = chapterVerseMatch;
    return vEnd ? `${book} ${ch}:${v}-${vEnd}` : `${book} ${ch}:${v}`;
  }

  // "Book X Y" - two separate numbers with space
  const twoNumbersMatch = raw.match(/^(.+?)\s+(\d{1,3})\s+(\d{1,3})(?:\s*-\s*(\d+))?$/);
  if (twoNumbersMatch) {
    const [, book, ch, v, vEnd] = twoNumbersMatch;
    return vEnd ? `${book} ${ch}:${v}-${vEnd}` : `${book} ${ch}:${v}`;
  }

  // "Book 316" - digits run together, try to split
  const runTogetherMatch = raw.match(/^(.+?)\s+(\d{2,})$/);
  if (runTogetherMatch) {
    const [, book, digits] = runTogetherMatch;
    // Try splitting: first 1-2 digits as chapter, rest as verse
    // Heuristic: if 2 digits, split 1:X (e.g. "16" is ambiguous, skip)
    // If 3 digits, split as X:YY (e.g. "316" → "3:16")
    // If 4 digits, split as XX:YY (e.g. "2316" → "23:16")
    if (digits.length === 3) {
      return `${book} ${digits[0]}:${digits.slice(1)}`;
    }
    if (digits.length === 4) {
      return `${book} ${digits.slice(0, 2)}:${digits.slice(2)}`;
    }
    // 2 digits or 5+ - too ambiguous, return as-is
    return raw;
  }

  return raw;
}

export interface TextPart {
  text: string;
  isReference: boolean;
}

/**
 * Split text into parts, identifying Bible references.
 * Normalizes spoken forms like "John 316" or "John chapter 3 verse 16"
 * into standard "John 3:16" format.
 */
export function parseBibleReferences(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let lastIndex = 0;

  // Reset regex state
  BIBLE_REF_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BIBLE_REF_REGEX.exec(text)) !== null) {
    // Find which capture group matched
    const matched = match[1] || match[2] || match[3] || match[4] || '';
    if (!matched) continue;

    // Text before the reference
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) {
        parts.push({ text: before, isReference: false });
      }
    }

    // Normalize and add the reference
    parts.push({ text: normalizeReference(matched.trim()), isReference: true });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last reference
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim();
    if (after) {
      parts.push({ text: after, isReference: false });
    }
  }

  // No references found - return original text
  if (parts.length === 0) {
    parts.push({ text, isReference: false });
  }

  return parts;
}
