import { isValidReference } from './bibleData';

const BIBLE_BOOKS = [
  // Old Testament
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
  '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther',
  'Job', 'Psalms', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
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

// Sort longest first so "Song of Solomon" matches before "Song", "1 John" before "John", etc.
const SORTED_BOOKS = [...BIBLE_BOOKS].sort((a, b) => b.length - a.length);

/**
 * Try all ways to split a digit string into chapter:verse,
 * preferring the split with the largest valid chapter number.
 */
function splitDigitsValidated(book: string, digits: string): string | null {
  let best: { ch: number; v: number } | null = null;
  for (let i = 1; i < digits.length; i++) {
    const ch = parseInt(digits.slice(0, i), 10);
    const v = parseInt(digits.slice(i), 10);
    if (v > 0 && isValidReference(book, ch, v)) {
      if (!best || ch > best.ch) {
        best = { ch, v };
      }
    }
  }
  return best ? `${book} ${best.ch}:${best.v}` : null;
}

export interface TextPart {
  text: string;
  isReference: boolean;
}

/**
 * Find a Bible book name starting at position `start` in the text.
 * Returns the matched book name or null.
 */
function findBookAt(text: string, start: number): string | null {
  const sub = text.slice(start);
  for (const book of SORTED_BOOKS) {
    if (sub.length < book.length) continue;
    const candidate = sub.slice(0, book.length);
    if (candidate.toLowerCase() === book.toLowerCase()) {
      // Make sure it's not a partial word match (e.g., "Joshua" inside "Joshuary")
      const afterChar = sub[book.length];
      if (!afterChar || afterChar === ' ' || afterChar === '\t') {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Parse the reference portion after a book name.
 * Returns { ref: normalized string, length: chars consumed } or null.
 */
function parseRefAfterBook(book: string, text: string): { ref: string; length: number } | null {
  const trimmed = text.trimStart();
  const leadingSpaces = text.length - trimmed.length;
  if (leadingSpaces === 0) return null; // no space after book name

  // Pattern 1: "chapter X verse(s) Y (through/to Z)"
  const chapterMatch = trimmed.match(
    /^chapter\s+(\d+)\s+verses?\s+(\d+)(?:\s+(?:through|to|-)\s+(\d+))?/i
  );
  if (chapterMatch) {
    const [full, ch, v, vEnd] = chapterMatch;
    const ref = vEnd ? `${book} ${ch}:${v}-${vEnd}` : `${book} ${ch}:${v}`;
    return { ref, length: leadingSpaces + full.length };
  }

  // Pattern 2: "X:Y" or "X:Y-Z" or "X:Y-Z:W" (standard colon format)
  const colonMatch = trimmed.match(
    /^(\d+):(\d+)(?:\s*-\s*(\d+)(?::(\d+))?)?/
  );
  if (colonMatch) {
    const [full] = colonMatch;
    return { ref: `${book} ${full}`, length: leadingSpaces + full.length };
  }

  // Pattern 3: "X Y" or "X Y-Z" (two space-separated numbers)
  const twoNumMatch = trimmed.match(/^(\d{1,3})\s+(\d{1,3})(?:\s*-\s*(\d+))?/);
  if (twoNumMatch) {
    const [full, ch, v, vEnd] = twoNumMatch;
    const ref = vEnd ? `${book} ${ch}:${v}-${vEnd}` : `${book} ${ch}:${v}`;
    return { ref, length: leadingSpaces + full.length };
  }

  // Pattern 4: "NNN" (digits together, no colon, no space)
  const digitsMatch = trimmed.match(/^(\d{2,})/);
  if (digitsMatch) {
    const [full, digits] = digitsMatch;
    const validated = splitDigitsValidated(book, digits);
    if (validated) {
      return { ref: validated, length: leadingSpaces + full.length };
    }
  }

  return null;
}

/**
 * Split text into parts, identifying Bible references.
 * Uses a two-phase approach: find book names, then parse what follows.
 */
export function parseBibleReferences(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let pos = 0;

  while (pos < text.length) {
    // Try to find a book name at or after current position
    let found = false;
    for (let i = pos; i < text.length; i++) {
      const book = findBookAt(text, i);
      if (!book) continue;

      // Try to parse a reference after the book name
      const afterBook = text.slice(i + book.length);
      const result = parseRefAfterBook(book, afterBook);
      if (!result) continue;

      // Add text before this reference
      if (i > pos) {
        const before = text.slice(pos, i).trim();
        if (before) {
          parts.push({ text: before, isReference: false });
        }
      }

      // Add the reference
      parts.push({ text: result.ref, isReference: true });
      pos = i + book.length + result.length;
      found = true;
      break;
    }

    if (!found) {
      // No more references found
      const remaining = text.slice(pos).trim();
      if (remaining) {
        parts.push({ text: remaining, isReference: false });
      }
      break;
    }
  }

  if (parts.length === 0) {
    parts.push({ text, isReference: false });
  }

  return parts;
}
