import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import JSZip from 'jszip';
import { Test } from '@nestjs/testing';
import { EpubMetadataWriterService } from './epub-metadata-writer.service';

// Minimal valid OPF with epub2-style metadata
const MINIMAL_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Old Title</dc:title>
    <dc:creator>Old Author</dc:creator>
    <dc:subject>Old Subject</dc:subject>
    <dc:description>Old description</dc:description>
    <dc:publisher>Old Publisher</dc:publisher>
    <dc:date>2000-01-01</dc:date>
    <dc:language>en</dc:language>
  </metadata>
</package>`;

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

async function buildEpub(opf: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/content.opf', opf);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function readOpfFromEpub(epubPath: string): Promise<string> {
  const buf = fs.readFileSync(epubPath);
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('OEBPS/content.opf');
  if (!entry) throw new Error('OPF not found');
  return entry.async('string');
}

describe('EpubMetadataWriterService', () => {
  let service: EpubMetadataWriterService;
  let tmpDir: string;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [EpubMetadataWriterService],
    }).compile();
    service = module.get(EpubMetadataWriterService);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function writeEpub(opf = MINIMAL_OPF): Promise<string> {
    const buf = await buildEpub(opf);
    const epubPath = path.join(tmpDir, 'test.epub');
    fs.writeFileSync(epubPath, buf);
    return epubPath;
  }

  it('updates dc:title in OPF', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, { title: 'New Title' });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('<dc:title>New Title</dc:title>');
    expect(opf).not.toContain('Old Title');
  });

  it('replaces all dc:creator elements with new authors', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, {
      authors: ['Author A', 'Author B'],
    });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('<dc:creator>Author A</dc:creator>');
    expect(opf).toContain('<dc:creator>Author B</dc:creator>');
    expect(opf).not.toContain('Old Author');
  });

  it('replaces all dc:subject elements with genres and tags combined', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, {
      genres: ['Science Fiction'],
      tags: ['space', 'classic'],
    });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('<dc:subject>Science Fiction</dc:subject>');
    expect(opf).toContain('<dc:subject>space</dc:subject>');
    expect(opf).toContain('<dc:subject>classic</dc:subject>');
    expect(opf).not.toContain('Old Subject');
  });

  it('does not write fields with null/undefined values', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, {
      title: 'New Title',
      subtitle: null,
      description: null,
    });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('<dc:title>New Title</dc:title>');
    // Original description preserved, subtitle not added
    expect(opf).toContain('Old description');
    expect(opf).not.toContain('dcterms:alternative');
  });

  it('leaves the original file unchanged if an error occurs', async () => {
    const epubPath = await writeEpub();
    const originalContent = fs.readFileSync(epubPath);

    // corrupt epub to trigger failure
    const badPath = path.join(tmpDir, 'bad.epub');
    fs.writeFileSync(badPath, 'not a zip');

    await expect(
      service.writeMetadataToEpub(badPath, { title: 'X' }),
    ).rejects.toThrow();

    // bad.epub still has original content
    expect(fs.readFileSync(badPath).toString()).toBe('not a zip');
    // original epubPath is also unaffected
    expect(fs.readFileSync(epubPath)).toEqual(originalContent);
  });

  it('escapes XML special characters in values', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, {
      title: 'Tom & Jerry <Test>',
    });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('Tom &amp; Jerry &lt;Test&gt;');
  });

  it('adds isbn13 and isbn10 identifiers', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, {
      isbn13: '9780000000000',
      isbn10: '0000000000',
    });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('ISBN-13');
    expect(opf).toContain('9780000000000');
    expect(opf).toContain('ISBN-10');
    expect(opf).toContain('0000000000');
  });

  it('adds calibre series meta tags', async () => {
    const epubPath = await writeEpub();
    await service.writeMetadataToEpub(epubPath, {
      seriesName: 'Dune Chronicles',
      seriesNumber: 1,
    });
    const opf = await readOpfFromEpub(epubPath);
    expect(opf).toContain('calibre:series');
    expect(opf).toContain('Dune Chronicles');
    expect(opf).toContain('calibre:series_index');
    expect(opf).toContain('"1"');
  });
});
