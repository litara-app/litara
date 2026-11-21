// Shared sample data for the Litara UI mockups. Fictional state, public-domain titles.
const B = (id, title, author, series, seq, year, h, fm, prog, status, extra = {}) =>
  ({ id, title, author, series, seq, year, h, fm, prog, status, ...extra });
const LIT = {
  user: { name: 'deranjer', role: 'Administrator' },
  libraries: [
    { id: 'fic', name: 'Fiction', mode: 'Managed', titles: 3412, health: 'ok', path: '/mnt/nas/books/fiction' },
    { id: 'aud', name: 'Audiobooks', mode: 'Existing', titles: 1186, health: 'warn', path: '/mnt/nas/audio', note: '3 incomplete recordings' },
    { id: 'com', name: 'Comics & Manga', mode: 'Existing', titles: 2240, health: 'ok', path: '/mnt/nas/comics' },
    { id: 'ref', name: 'Reference', mode: 'Managed', titles: 318, health: 'ok', path: '/mnt/nas/reference' }
  ],
  shelves: [{ n: 'Winter re-reads', c: 14 }, { n: 'Book club 2027', c: 6 }, { n: 'Gothic & horror', c: 41 }, { n: 'Short & sweet', c: 22 }],
  smart: [{ n: 'Unread audiobooks', c: 212 }, { n: 'Added this month', c: 87 }, { n: 'Has annotations', c: 63 }],
  books: [
    B('b1', 'Dracula', 'Bram Stoker', '', null, 1897, 350, ['EPUB', 'M4B'], 62, 'Reading', { pages: 418, dur: '15h 41m', narr: 'Alan Cumming', lib: 'Fiction', rating: 5, added: '2 d ago', ann: 7, flag: '' }),
    B('b2', 'Pride and Prejudice', 'Jane Austen', '', null, 1813, 15, ['EPUB', 'PDF'], 100, 'Finished', { pages: 432, lib: 'Fiction', rating: 5, added: '3 w ago', ann: 21 }),
    B('b3', 'The Time Machine', 'H. G. Wells', 'Scientific Romances', 1, 1895, 205, ['EPUB', 'M4B'], 18, 'Listening', { pages: 118, dur: '3h 12m', narr: 'Nigel Planer', lib: 'Audiobooks', rating: 4, added: '1 w ago', ann: 0 }),
    B('b4', 'Frankenstein', 'Mary Shelley', '', null, 1818, 140, ['EPUB'], 0, 'Unread', { pages: 280, lib: 'Fiction', rating: 0, added: '1 w ago', ann: 0 }),
    B('b5', 'The War of the Worlds', 'H. G. Wells', 'Scientific Romances', 2, 1898, 28, ['EPUB', 'M4B'], 34, 'Listening', { pages: 192, dur: '6h 02m', narr: 'Anthony Heald', lib: 'Audiobooks', rating: 4, added: '1 w ago', ann: 2, flag: 'Recording incomplete' }),
    B('b6', 'Moby-Dick', 'Herman Melville', '', null, 1851, 195, ['EPUB', 'PDF'], 9, 'Reading', { pages: 635, lib: 'Fiction', rating: 3, added: '5 w ago', ann: 4 }),
    B('b7', 'Jane Eyre', 'Charlotte Brontë', '', null, 1847, 330, ['EPUB', 'M4B'], 0, 'Unread', { pages: 532, dur: '18h 20m', narr: 'Thandiwe Newton', lib: 'Fiction', rating: 0, added: '2 w ago', ann: 0 }),
    B('b8', 'The Hound of the Baskervilles', 'Arthur Conan Doyle', 'Sherlock Holmes', 5, 1902, 45, ['EPUB', 'M4B'], 100, 'Finished', { pages: 256, dur: '6h 40m', narr: 'Stephen Fry', lib: 'Audiobooks', rating: 5, added: '2 m ago', ann: 11 }),
    B('b9', 'A Study in Scarlet', 'Arthur Conan Doyle', 'Sherlock Holmes', 1, 1887, 60, ['EPUB'], 100, 'Finished', { pages: 178, lib: 'Fiction', rating: 4, added: '2 m ago', ann: 3 }),
    B('b10', 'The Sign of the Four', 'Arthur Conan Doyle', 'Sherlock Holmes', 2, 1890, 75, ['EPUB'], 0, 'Unread', { pages: 150, lib: 'Fiction', rating: 0, added: '2 m ago', ann: 0 }),
    B('b11', 'Wuthering Heights', 'Emily Brontë', '', null, 1847, 260, ['EPUB', 'PDF'], 0, 'Unread', { pages: 416, lib: 'Fiction', rating: 0, added: '4 d ago', ann: 0, flag: 'Needs review' }),
    B('b12', 'Great Expectations', 'Charles Dickens', '', null, 1861, 165, ['EPUB', 'M4B'], 47, 'Reading', { pages: 544, dur: '19h 05m', narr: 'Simon Vance', lib: 'Fiction', rating: 4, added: '6 w ago', ann: 9 }),
    B('b13', 'Alice in Wonderland', 'Lewis Carroll', 'Alice', 1, 1865, 300, ['EPUB', 'CBZ'], 100, 'Finished', { pages: 200, lib: 'Fiction', rating: 5, added: '3 m ago', ann: 5 }),
    B('b14', 'Treasure Island', 'R. L. Stevenson', '', null, 1883, 180, ['EPUB', 'M4B'], 0, 'Unread', { pages: 292, dur: '7h 11m', narr: 'Alfred Molina', lib: 'Audiobooks', rating: 0, added: '3 d ago', ann: 0 }),
    B('b15', 'The Picture of Dorian Gray', 'Oscar Wilde', '', null, 1890, 100, ['EPUB'], 73, 'Reading', { pages: 254, lib: 'Fiction', rating: 5, added: '7 w ago', ann: 14 }),
    B('b16', 'Little Women', 'Louisa May Alcott', 'March Family', 1, 1868, 345, ['EPUB', 'M4B'], 0, 'Unread', { pages: 759, dur: '21h 33m', narr: 'Laurel Lefkow', lib: 'Audiobooks', rating: 0, added: 'today', ann: 0 }),
    B('b17', 'Heart of Darkness', 'Joseph Conrad', '', null, 1899, 120, ['EPUB', 'PDF'], 0, 'Unread', { pages: 96, lib: 'Fiction', rating: 0, added: 'today', ann: 0 }),
    B('b18', 'Dr Jekyll and Mr Hyde', 'R. L. Stevenson', '', null, 1886, 225, ['EPUB', 'M4B'], 100, 'Finished', { pages: 144, dur: '3h 02m', narr: 'Tom Baker', lib: 'Audiobooks', rating: 4, added: '4 m ago', ann: 6 }),
    B('b19', 'Walden', 'Henry David Thoreau', '', null, 1854, 90, ['EPUB'], 4, 'Reading', { pages: 352, lib: 'Reference', rating: 3, added: '2 m ago', ann: 1 }),
    B('b20', 'The Count of Monte Cristo', 'Alexandre Dumas', '', null, 1844, 15, ['EPUB', 'M4B'], 0, 'Unread', { pages: 1276, dur: '52h 19m', narr: 'Bill Homewood', lib: 'Audiobooks', rating: 0, added: '2 w ago', ann: 0, flag: 'Recording incomplete' })
  ],
  pending: [
    { t: 'Kobo reports 64%, web has 62%', s: 'Dracula · EPUB', w: 'Resume conflict' },
    { t: '3 annotations not yet uploaded', s: 'Great Expectations', w: 'Offline queue' },
    { t: 'Chapter file missing: Part 07', s: 'The War of the Worlds · M4B', w: 'Needs repair' }
  ],
  devices: [
    { n: 'Web · Firefox', w: 'now', p: '62%' },
    { n: 'Pixel 8 · Android', w: '2 h ago', p: '62%' },
    { n: 'Kobo Libra · KOReader', w: 'yesterday', p: '64%' }
  ],
  chapters: [
    ['Jonathan Harker’s Journal I', '24:10', 'done'], ['Jonathan Harker’s Journal II', '31:42', 'done'],
    ['Jonathan Harker’s Journal III', '28:05', 'done'], ['Jonathan Harker’s Journal IV', '35:51', 'done'],
    ['Mina Murray’s Journal', '27:30', 'now'], ['Letter from Dr Seward', '19:22', ''],
    ['The Demeter', '33:14', ''], ['Seward’s Diary', '41:07', '']
  ],
  meta: [
    ['Title', 'Dracula', 'Embedded'], ['Author', 'Bram Stoker', 'Embedded'], ['Published', '1897', 'Open Library'],
    ['Publisher', 'Archibald Constable', 'Embedded'], ['Language', 'English', 'Embedded'],
    ['ISBN', '9780141439846', 'Provider · confirmed'], ['Subjects', 'Gothic · Horror · Epistolary', 'Edited by you'],
    ['Narrator', 'Alan Cumming', 'Audio tags']
  ],
  notes: [
    ['Ch. 3', '“There are darknesses in life and there are lights…”', 'Highlight', 'Yesterday'],
    ['Ch. 8', 'Compare Mina’s shorthand with Seward’s phonograph', 'Note', '3 d ago'],
    ['Ch. 12', 'The crew’s log entries: good pacing', 'Bookmark', '1 w ago']
  ]
};
const cv = (b, c = '') => `<div class="cv ${c}" style="--h:${b.h}"><b>${b.title}</b><i>${b.author.split(' ').pop()}</i></div>`;
const byId = id => LIT.books.find(b => b.id === id);
const stars = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
