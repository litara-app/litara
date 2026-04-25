import { AudiobookMetadataService } from './audiobook-metadata.service';
import { AudiobookScannerService } from './audiobook-scanner.service';

// ---------------------------------------------------------------------------
// AudiobookMetadataService — pure utility methods
// ---------------------------------------------------------------------------

describe('AudiobookMetadataService', () => {
  let service: AudiobookMetadataService;

  beforeEach(() => {
    service = new AudiobookMetadataService();
  });

  // ── parseCueFile ──────────────────────────────────────────────────────────

  describe('parseCueFile', () => {
    it('parses a basic cue file into chapters', () => {
      const cue = [
        'TITLE "Test Album"',
        'TRACK 01 AUDIO',
        '  TITLE "Chapter One"',
        '  INDEX 01 00:00:00',
        'TRACK 02 AUDIO',
        '  TITLE "Chapter Two"',
        '  INDEX 01 05:30:00',
        'TRACK 03 AUDIO',
        '  TITLE "Chapter Three"',
        '  INDEX 01 12:45:00',
      ].join('\n');

      const chapters = service.parseCueFile(cue, 3600);
      expect(chapters).toHaveLength(3);

      expect(chapters[0].title).toBe('Chapter One');
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].endTime).toBeCloseTo(330, 0); // 5 * 60 + 30

      expect(chapters[1].title).toBe('Chapter Two');
      expect(chapters[1].startTime).toBeCloseTo(330, 0);

      expect(chapters[2].startTime).toBeCloseTo(765, 0); // 12 * 60 + 45
      expect(chapters[2].endTime).toBe(3600);
    });

    it('converts MM:SS:FF timestamps (75 frames = 1 second)', () => {
      const cue = ['TRACK 01 AUDIO', '  TITLE "A"', '  INDEX 01 01:00:75'].join(
        '\n',
      );
      const chapters = service.parseCueFile(cue, 120);
      // 1 min + 0 sec + 75/75 frames = 61.0s
      expect(chapters[0].startTime).toBeCloseTo(61, 1);
    });

    it('returns empty array for empty cue content', () => {
      expect(service.parseCueFile('', 100)).toHaveLength(0);
    });

    it('sets endTime of last chapter to totalDuration', () => {
      const cue = [
        'TRACK 01 AUDIO',
        '  TITLE "Only"',
        '  INDEX 01 00:00:00',
      ].join('\n');
      const chapters = service.parseCueFile(cue, 500);
      expect(chapters[0].endTime).toBe(500);
    });
  });

  // ── deriveTitleFromFolder ─────────────────────────────────────────────────

  describe('deriveTitleFromFolder', () => {
    it('strips leading numeric prefix', () => {
      expect(service.deriveTitleFromFolder('/books/01 - My Book')).toBe(
        'My Book',
      );
    });

    it('strips Unabridged suffix', () => {
      expect(service.deriveTitleFromFolder('/books/My Book - Unabridged')).toBe(
        'My Book',
      );
    });

    it('strips Audiobook suffix (case-insensitive)', () => {
      expect(service.deriveTitleFromFolder('/books/My Book - Audiobook')).toBe(
        'My Book',
      );
    });

    it('returns folder name unchanged when nothing to strip', () => {
      expect(service.deriveTitleFromFolder('/books/Childhood End')).toBe(
        'Childhood End',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AudiobookScannerService — parseNumericPrefix (pure logic)
// ---------------------------------------------------------------------------

describe('AudiobookScannerService.parseNumericPrefix', () => {
  // Directly test the method via prototype to avoid constructing with DI deps
  const parse = (filename: string) =>
    AudiobookScannerService.prototype.parseNumericPrefix(filename);

  const cases: [string, number][] = [
    ['01 Chapter One.mp3', 1],
    ['001 Chapter One.mp3', 1],
    ['01. Chapter One.mp3', 1],
    ['01 - Chapter One.mp3', 1],
    ['1 - Chapter One.mp3', 1],
    ['01_ Chapter One.mp3', 1],
    ['02 Chapter Two.mp3', 2],
    ['10 Chapter Ten.mp3', 10],
    ['99 Last Chapter.mp3', 99],
    ['Chapter One.mp3', Infinity],
    ['NoPrefix.mp3', Infinity],
    ['A_file.mp3', Infinity],
  ];

  it.each(cases)('"%s" → %d', (filename, expected) => {
    expect(parse(filename)).toBe(expected);
  });
});
