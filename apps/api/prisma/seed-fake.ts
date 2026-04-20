/**
 * Seed the database with fake books for development / screenshot testing.
 *
 * Usage:
 *   npm run seed:fake              # 1 000 books (default)
 *   npm run seed:fake -- 500       # custom count
 *
 * Requires DATABASE_URL in the environment (apps/api/.env is loaded automatically).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { faker } from '@faker-js/faker';
import { deflateSync } from 'zlib';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const BOOK_COUNT = parseInt(process.argv[2] ?? '1000', 10);

// ── Tiny solid-colour PNG generator (no external deps) ───────────────────────

function crc32(buf: Buffer): Buffer {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return out;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, 'ascii');
  return Buffer.concat([
    len,
    typeBytes,
    data,
    crc32(Buffer.concat([typeBytes, data])),
  ]);
}

function generateCoverPng(r: number, g: number, b: number): Buffer {
  const W = 80,
    H = 120;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB colour type

  // Gradient: top = colour, bottom = 70% brightness
  const raw = Buffer.alloc((1 + W * 3) * H);
  let off = 0;
  for (let y = 0; y < H; y++) {
    const shade = 1 - (y / H) * 0.3;
    raw[off++] = 0; // filter byte = None
    for (let x = 0; x < W; x++) {
      raw[off++] = Math.min(255, Math.round(r * shade));
      raw[off++] = Math.min(255, Math.round(g * shade));
      raw[off++] = Math.min(255, Math.round(b * shade));
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Static data pools ────────────────────────────────────────────────────────

const FORMATS: string[] = [
  ...Array(40).fill('EPUB'),
  ...Array(25).fill('PDF'),
  ...Array(15).fill('MOBI'),
  ...Array(10).fill('CBZ'),
  ...Array(5).fill('AZW3'),
  ...Array(3).fill('FB2'),
  ...Array(2).fill('CBR'),
];

const GENRES = [
  'Fantasy',
  'Science Fiction',
  'Mystery',
  'Thriller',
  'Romance',
  'Historical Fiction',
  'Horror',
  'Literary Fiction',
  'Adventure',
  'Biography',
  'Self-Help',
  'Non-Fiction',
  'Young Adult',
  'Children',
  'Graphic Novel',
  'Poetry',
  'True Crime',
  'Philosophy',
  'Psychology',
  'Business',
  'Technology',
  'Science',
  'Travel',
  'Cooking',
  'Art',
];

const MOODS = [
  'Dark',
  'Uplifting',
  'Suspenseful',
  'Humorous',
  'Romantic',
  'Melancholic',
  'Adventurous',
  'Mysterious',
  'Inspiring',
  'Tense',
  'Whimsical',
  'Gritty',
  'Heartwarming',
  'Philosophical',
  'Nostalgic',
];

const TAGS = [
  'classic',
  'bestseller',
  'award-winner',
  'debut',
  'page-turner',
  'slow-burn',
  'fast-paced',
  'character-driven',
  'plot-driven',
  'world-building',
  'magic-system',
  'space-opera',
  'cyberpunk',
  'steampunk',
  'dystopian',
  'post-apocalyptic',
  'time-travel',
  'mythology',
  'fairy-tale',
  'retelling',
  'anthology',
  'short-stories',
  'standalone',
  'series-starter',
  'novella',
];

const PUBLISHERS = [
  'Tor Books',
  'Orbit',
  'Del Rey',
  'Ace Books',
  'Baen Books',
  'Penguin Random House',
  'HarperCollins',
  'Simon & Schuster',
  'Macmillan',
  'Hachette Book Group',
  'Scholastic',
  'Bloomsbury',
  'Vintage Books',
  'Farrar, Straus and Giroux',
  'W. W. Norton',
  'Knopf',
  'Random House',
  'Little, Brown',
  'Doubleday',
  'Scribner',
];

const LANGUAGES = [
  'English',
  'English',
  'English',
  'English',
  'English',
  'Spanish',
  'French',
  'German',
  'Japanese',
  'Italian',
];

const SERIES_SUFFIXES = [
  'Chronicles',
  'Saga',
  'Series',
  'Trilogy',
  'Cycle',
  'Tales',
  'Collection',
  'Adventures',
  'Sequence',
  'Quartet',
];

const COVER_PALETTE: [number, number, number][] = [
  [52, 152, 219],
  [231, 76, 60],
  [46, 204, 113],
  [155, 89, 182],
  [241, 196, 15],
  [26, 188, 156],
  [230, 126, 34],
  [52, 73, 94],
  [192, 57, 43],
  [39, 174, 96],
  [142, 68, 173],
  [243, 156, 18],
  [22, 160, 133],
  [211, 84, 0],
  [127, 140, 141],
  [41, 128, 185],
  [109, 213, 250],
  [255, 99, 132],
  [75, 192, 192],
  [153, 102, 255],
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function randomCreatedAt(): Date {
  const now = Date.now();
  const start = now - 3 * 365 * 24 * 60 * 60 * 1000; // 3 years ago
  // Slight recency bias: power < 1 stretches toward "now"
  return new Date(start + Math.random() ** 0.75 * (now - start));
}

function randomPublishedDate(): Date | null {
  if (Math.random() < 0.08) return null;
  // Weighted decade selection: older = less likely
  const decades = [
    1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2015, 2020,
  ];
  const weights = [1, 2, 3, 4, 6, 10, 15, 20, 22, 18, 14];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let decade = 2015;
  for (let i = 0; i < decades.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      decade = decades[i];
      break;
    }
  }
  const year = decade + Math.floor(Math.random() * (decade >= 2020 ? 6 : 10));
  const month = Math.floor(Math.random() * 12) + 1;
  const day = Math.floor(Math.random() * 28) + 1;
  return new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`,
  );
}

function randomPageCount(): number | null {
  if (Math.random() < 0.07) return null;
  const ranges = [
    { min: 50, max: 150, w: 5 },
    { min: 150, max: 250, w: 15 },
    { min: 250, max: 350, w: 28 },
    { min: 350, max: 500, w: 30 },
    { min: 500, max: 700, w: 14 },
    { min: 700, max: 900, w: 6 },
    { min: 900, max: 1200, w: 2 },
  ];
  const total = ranges.reduce((a, r) => a + r.w, 0);
  let rng = Math.random() * total;
  for (const range of ranges) {
    rng -= range.w;
    if (rng <= 0) return faker.number.int({ min: range.min, max: range.max });
  }
  return 300;
}

function randomFileSize(format: string): bigint {
  const ranges: Record<string, [number, number]> = {
    EPUB: [150_000, 5_000_000],
    PDF: [800_000, 25_000_000],
    MOBI: [200_000, 8_000_000],
    CBZ: [8_000_000, 150_000_000],
    AZW3: [200_000, 6_000_000],
    FB2: [80_000, 2_000_000],
    CBR: [8_000_000, 120_000_000],
  };
  const [min, max] = ranges[format] ?? [200_000, 5_000_000];
  return BigInt(faker.number.int({ min, max }));
}

function randomReadingDate(): Date {
  // Spread across the past 14 months with recency bias
  const now = Date.now();
  const start = now - 14 * 30 * 24 * 60 * 60 * 1000;
  const dayTs = start + Math.random() ** 0.6 * (now - start);

  // Weight hours toward typical reading times: evening (19–23) and morning (6–9)
  const hourWeights = [
    1,
    1,
    1,
    1,
    1,
    1, // 0–5  (night)
    3,
    5,
    6,
    4,
    2,
    2, // 6–11 (morning)
    3,
    3,
    2,
    2,
    2,
    3, // 12–17 (afternoon)
    5,
    8,
    9,
    9,
    8,
    5, // 18–23 (evening)
  ];
  const totalW = hourWeights.reduce((a, b) => a + b, 0);
  let rh = Math.random() * totalW;
  let hour = 0;
  for (let i = 0; i < hourWeights.length; i++) {
    rh -= hourWeights[i];
    if (rh <= 0) {
      hour = i;
      break;
    }
  }

  const d = new Date(dayTs);
  d.setUTCHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

function randomHex(bytes: number): string {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('');
}

function randomIsbn13(): string {
  const prefix = faker.helpers.arrayElement(['978', '979']);
  const body = faker.number
    .int({ min: 1_000_000_000, max: 9_999_999_999 })
    .toString()
    .slice(0, 9);
  return prefix + body;
}

function randomIsbn10(): string {
  return faker.number
    .int({ min: 1_000_000_000, max: 9_999_999_999 })
    .toString();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📚 Seeding ${BOOK_COUNT} fake books...\n`);

  const library =
    (await prisma.library.findFirst({ where: { userId: null } })) ??
    (await prisma.library.create({
      data: { name: 'Default Library', userId: null },
    }));

  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!adminUser)
    console.log(
      '  ⚠  No admin user found — skipping reviews & reading progress.',
    );

  // ── Reference data ──────────────────────────────────────────────────────

  process.stdout.write('Creating genres / moods / tags... ');
  const genreRecords = await Promise.all(
    GENRES.map((name) =>
      prisma.genre.upsert({ where: { name }, create: { name }, update: {} }),
    ),
  );
  const moodRecords = await Promise.all(
    MOODS.map((name) =>
      prisma.mood.upsert({ where: { name }, create: { name }, update: {} }),
    ),
  );
  const tagRecords = await Promise.all(
    TAGS.map((name) =>
      prisma.tag.upsert({ where: { name }, create: { name }, update: {} }),
    ),
  );
  console.log('done');

  // ── Authors ─────────────────────────────────────────────────────────────

  process.stdout.write('Creating 150 authors... ');
  const authorNames = [
    ...new Set(Array.from({ length: 180 }, () => faker.person.fullName())),
  ].slice(0, 150);
  const authorRecords = await Promise.all(
    authorNames.map((name) =>
      prisma.author.upsert({ where: { name }, create: { name }, update: {} }),
    ),
  );
  console.log('done');

  // ── Series ──────────────────────────────────────────────────────────────

  process.stdout.write('Creating 80 series... ');
  const seriesNames = [
    ...new Set(
      Array.from({ length: 100 }, () => {
        const adj = faker.word.adjective();
        const noun = faker.word.noun();
        return `The ${adj.charAt(0).toUpperCase() + adj.slice(1)} ${noun.charAt(0).toUpperCase() + noun.slice(1)} ${pick(SERIES_SUFFIXES)}`;
      }),
    ),
  ].slice(0, 80);
  const seriesRecords = await Promise.all(
    seriesNames.map((name) =>
      prisma.series.upsert({
        where: { name },
        create: { name, totalBooks: faker.number.int({ min: 3, max: 12 }) },
        update: {},
      }),
    ),
  );
  console.log('done');

  // Pre-plan series assignments so sequence numbers are consecutive per series
  const seriesBookCounts = new Map<string, number>();
  const seriesAssignments = new Map<
    number,
    { seriesId: string; sequence: number }
  >();
  for (let i = 0; i < BOOK_COUNT; i++) {
    if (Math.random() < 0.65) {
      const s = pick(seriesRecords);
      const seq = (seriesBookCounts.get(s.id) ?? 0) + 1;
      seriesBookCounts.set(s.id, seq);
      seriesAssignments.set(i, { seriesId: s.id, sequence: seq });
    }
  }

  // ── Books ────────────────────────────────────────────────────────────────

  console.log(`Creating ${BOOK_COUNT} books:`);
  for (let i = 0; i < BOOK_COUNT; i++) {
    if (i > 0 && i % 100 === 0) console.log(`  ${i} / ${BOOK_COUNT}`);

    const format = pick(FORMATS);
    const title = faker.helpers.arrayElement([
      () => faker.commerce.productName(),
      () => faker.lorem.words({ min: 2, max: 5 }),
      () => `The ${faker.word.adjective()} ${faker.word.noun()}`,
      () => faker.person.lastName() + "'s " + faker.word.noun(),
    ])();

    const bookAuthors = pickN(authorRecords, Math.random() < 0.2 ? 2 : 1);
    const bookGenres = pickN(
      genreRecords,
      faker.number.int({ min: 1, max: 3 }),
    );
    const bookMoods =
      Math.random() < 0.7
        ? pickN(moodRecords, faker.number.int({ min: 1, max: 2 }))
        : [];
    const bookTags = pickN(tagRecords, faker.number.int({ min: 1, max: 4 }));
    const seriesAssignment = seriesAssignments.get(i);
    const [r, g, b] = pick(COVER_PALETTE);

    const readStatus = pick([
      'UNREAD',
      'UNREAD',
      'UNREAD',
      'READING',
      'READ',
      'READ',
      'READ',
      'READ',
      'WONT_READ',
    ]);
    const hasReview = !!adminUser && Math.random() < 0.55;
    const hasProgress =
      !!adminUser &&
      (readStatus === 'READING' ||
        (readStatus === 'READ' && Math.random() < 0.3));

    await prisma.book.create({
      data: {
        libraryId: library.id,
        title,
        subtitle:
          Math.random() < 0.25 ? faker.lorem.words({ min: 2, max: 6 }) : null,
        description:
          Math.random() < 0.7
            ? faker.lorem.paragraphs({ min: 1, max: 3 }, '\n\n')
            : null,
        publishedDate: randomPublishedDate(),
        publisher: Math.random() < 0.82 ? pick(PUBLISHERS) : null,
        language: pick(LANGUAGES),
        pageCount: randomPageCount(),
        isbn13: Math.random() < 0.5 ? randomIsbn13() : null,
        isbn10: Math.random() < 0.3 ? randomIsbn10() : null,
        coverData: new Uint8Array(
          generateCoverPng(r, g, b),
        ) as Uint8Array<ArrayBuffer>,
        googleBooksId: Math.random() < 0.55 ? randomHex(6) : null,
        goodreadsRating:
          Math.random() < 0.45
            ? parseFloat((Math.random() * 3 + 2).toFixed(1))
            : null,
        createdAt: randomCreatedAt(),
        authors: {
          create: bookAuthors.map((a) => ({ authorId: a.id })),
        },
        genres: { connect: bookGenres.map((g) => ({ id: g.id })) },
        moods: { connect: bookMoods.map((m) => ({ id: m.id })) },
        tags: { connect: bookTags.map((t) => ({ id: t.id })) },
        ...(seriesAssignment
          ? {
              series: {
                create: {
                  seriesId: seriesAssignment.seriesId,
                  sequence: seriesAssignment.sequence,
                },
              },
            }
          : {}),
        files: {
          create: {
            filePath: `fake-books/${randomHex(8)}.${format.toLowerCase()}`,
            format,
            sizeBytes: randomFileSize(format),
            fileHash: randomHex(32),
          },
        },
        ...(hasReview
          ? {
              reviews: {
                create: {
                  userId: adminUser!.id,
                  readStatus,
                  rating:
                    Math.random() < 0.65
                      ? parseFloat((Math.random() * 3 + 2).toFixed(1))
                      : null,
                },
              },
            }
          : {}),
        ...(hasProgress
          ? {
              readingProgress: {
                create: {
                  userId: adminUser!.id,
                  source: 'LITARA',
                  percentage:
                    readStatus === 'READ'
                      ? 1.0
                      : parseFloat((Math.random() * 0.95 + 0.02).toFixed(3)),
                  lastSyncedAt: randomReadingDate(),
                },
              },
            }
          : {}),
      },
    });
  }

  console.log(
    `\n✅ Done! Seeded ${BOOK_COUNT} books into library "${library.name}".\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
