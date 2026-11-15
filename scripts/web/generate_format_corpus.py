#!/usr/bin/env python3
"""Generate the synthetic format corpus used by the browser format matrix.

Everything is newly authored text/tones (project MIT). MOBI/AZW3 are converted
from the generated EPUB with Calibre's ebook-convert when it is installed; audio
uses ffmpeg. Missing tools skip their files and the matrix reports them as not
generated. Usage: python scripts/web/generate_format_corpus.py OUT_DIR
"""
import os, shutil, subprocess, sys, zipfile

out = os.path.abspath(sys.argv[1])
shutil.rmtree(out, ignore_errors=True)
os.makedirs(out)

PARA = "<p>The quick brown fox jumps over the lazy dog. " * 3 + "</p>"
CONTAINER = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'


def epub(path, title, fixed=False, chapters=3):
    items = "".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(chapters))
    spine = "".join(f'<itemref idref="c{i}"/>' for i in range(chapters))
    layout = '<meta property="rendition:layout">pre-paginated</meta>' if fixed else ""
    opf = (f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           f'<dc:identifier id="id">urn:uuid:corpus-{title.replace(" ", "-")}</dc:identifier><dc:title>{title}</dc:title><dc:creator>Corpus Author</dc:creator>'
           f'<dc:language>en</dc:language>{layout}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{items}</manifest><spine>{spine}</spine></package>')
    nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>' + "".join(
        f'<li><a href="c{i}.xhtml">Chapter {i + 1}</a></li>' for i in range(chapters)) + "</ol></nav></body></html>"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("OPS/package.opf", opf)
        z.writestr("OPS/nav.xhtml", nav)
        for i in range(chapters):
            vp = '<meta name="viewport" content="width=600,height=800"/>' if fixed else ""
            z.writestr(f"OPS/c{i}.xhtml", f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c{i}</title>{vp}</head><body><h1>Chapter {i + 1}</h1>{PARA * 30}</body></html>')


epub(f"{out}/corpus-epub.epub", "Corpus EPUB")
epub(f"{out}/corpus-kepub.kepub.epub", "Corpus KEPUB")
epub(f"{out}/corpus-fixed-layout.epub", "Corpus Fixed Layout", fixed=True)

# damaged: a valid EPUB cut in half (the central directory is gone)
epub(f"{out}/damaged-source.epub", "Corpus Damaged")
data = open(f"{out}/damaged-source.epub", "rb").read()
open(f"{out}/corpus-damaged.epub", "wb").write(data[: len(data) // 2])
os.remove(f"{out}/damaged-source.epub")

# FB2
open(f"{out}/corpus-fb2.fb2", "w", encoding="utf8").write(
    '<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose</genre>'
    '<author><first-name>Corpus</first-name><last-name>Author</last-name></author><book-title>Corpus FB2</book-title><lang>en</lang></title-info></description>'
    '<body><section><title><p>Chapter 1</p></title>' + "<p>The quick brown fox jumps over the lazy dog.</p>" * 200 + "</section></body></FictionBook>")


# PDF with real text (two pages)
def pdf(path):
    objs = []
    def add(b): objs.append(b); return len(objs)
    add(b"<< /Type /Catalog /Pages 2 0 R >>")
    add(b"<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>")
    add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for n in (1, 2):
        stream = f"BT /F1 24 Tf 72 700 Td (Corpus PDF page {n}) Tj ET".encode()
        c = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        add(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % c)
    # object order: 1 catalog,2 pages,3 font,4 stream1,5 page1?  fix kids below
    body = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(body))
        body += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(body)
    body += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    body += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    open(path, "wb").write(body.replace(b"/Kids [4 0 R 6 0 R]", b"/Kids [5 0 R 7 0 R]"))


pdf(f"{out}/corpus-pdf.pdf")


# PDF with a cropped, rotated page and one known filled rectangle (pdf-coordinates test).
# Rect in user space (200,300)-(300,400); CropBox [100 100 500 600] => unrotated fractions
# x=0.25 y=0.40 w=0.25 h=0.20 from the crop box top-left. Rotate 90 swaps the displayed axes.
def pdf_crop(path):
    nl = bytes([10])
    stream = b"0 0 0 rg 200 300 100 100 re f"
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [100 100 500 600] /Rotate 90 /Contents 4 0 R /Resources << >> >>",
            b"<< /Length %d >>" % len(stream) + nl + b"stream" + nl + stream + nl + b"endstream"]
    body = b"%PDF-1.4" + nl
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(body))
        body += b"%d 0 obj" % i + nl + o + nl + b"endobj" + nl
    x = len(body)
    body += b"xref" + nl + b"0 %d" % (len(objs) + 1) + nl + b"0000000000 65535 f " + nl + b"".join(b"%010d 00000 n " % o + nl for o in offs)
    body += b"trailer" + nl + b"<< /Size %d /Root 1 0 R >>" % (len(objs) + 1) + nl + b"startxref" + nl + b"%d" % x + nl + b"%%EOF" + nl
    open(path, "wb").write(body)


pdf_crop(f"{out}/corpus-pdf-crop.pdf")

# MOBI / AZW3 via Calibre
conv = shutil.which("ebook-convert") or next((p for p in (r"C:\Program Files\Calibre2\ebook-convert.exe",) if os.path.exists(p)), None)
for ext in ("mobi", "azw3"):
    if conv:
        try:
            subprocess.run([conv, f"{out}/corpus-epub.epub", f"{out}/corpus-{ext}.{ext}", "--title", f"Corpus {ext.upper()}", "--authors", "Corpus Author"],
                           check=True, capture_output=True, timeout=180)
        except Exception as e:  # keep going; the matrix reports a missing file
            print("skip", ext, e)
    else:
        print("ebook-convert not found; skipping", ext)

# Audio: one folder per file so each becomes its own recording
ffmpeg = shutil.which("ffmpeg")
audio = {"mp3": ["-c:a", "libmp3lame"], "m4a": ["-c:a", "aac", "-f", "ipod"], "m4b": ["-c:a", "aac", "-f", "ipod"], "ogg": ["-c:a", "libvorbis"],
         "opus": ["-c:a", "libopus"], "flac": ["-c:a", "flac"], "wav": ["-c:a", "pcm_s16le"]}
if ffmpeg:
    for ext, codec in audio.items():
        d = f"{out}/audio/corpus-audio-{ext}"
        os.makedirs(d)
        subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "1", "-ar", "24000", *codec,
                        "-metadata", f"title=Corpus Audio {ext.upper()}", f"{d}/corpus-audio-{ext}.{ext}"], check=True, capture_output=True)
else:
    print("ffmpeg not found; skipping audio")
print("corpus written to", out)
for root, _, files in os.walk(out):
    for f in sorted(files):
        print(" ", os.path.relpath(os.path.join(root, f), out), os.path.getsize(os.path.join(root, f)))
