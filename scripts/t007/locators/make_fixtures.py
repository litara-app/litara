#!/usr/bin/env python3
"""Synthetic EPUB/FB2 fixtures that stress CFI generation and resolution (all text is generated; no third-party content).

  python scripts/t007/locators/make_fixtures.py   # writes .tmp/t007/locator-fixtures/{stress.epub,stress.fb2}

What the EPUB exercises: nested inline markup, links, <br/>, lists, tables, blockquotes, ruby, comments inside text, whitespace
runs and newlines in the source, character references, astral emoji (surrogate pairs), combining marks, right-to-left text, an
image, several spine items and a nav document. The aim is structure that makes text-node counting and offsets easy to get wrong.
"""
import struct, zlib, zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / ".tmp" / "t007" / "locator-fixtures"

LOREM = ("Lantern light spilled over the harbour wall while the clerk counted crates, "
         "reading each label twice to be sure. ")


def png(w=64, h=48):
    rows = b"".join(b"\x00" + bytes(v for x in range(w) for v in (x * 4 % 256, y * 5 % 256, 128)) for y in range(h))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def chapter(n: int) -> str:
    paras = []
    for p in range(1, 7):
        body = (LOREM * 3).strip()
        paras.append(
            f'<p id="c{n}p{p}">Chapter {n} paragraph {p}: <em>emphasis</em> and <strong>strong <span class="x">nested <code>code</code></span></strong>, '
            f'a <a href="#c{n}p1">link</a><sup>{p}</sup>, a break<br/>then text&#160;after&nbsp;entities &amp; &lt;marks&gt;.\n'
            f'   Whitespace   runs and\n   newlines   in   source. <!-- a comment inside the text --> After the comment. {body}</p>'
        )
    special = (
        f'<p id="c{n}emoji">Emoji \U0001F600\U0001F680 astral pair, é combining, ü precomposed, CJK 漢字, '
        f'<ruby>漢<rt>kan</rt></ruby> ruby base.</p>'
        f'<p id="c{n}rtl" dir="rtl">שלום עולם مرحبا بالعالم {LOREM}</p>'
        f'<blockquote><p>Quoted text with <i>italic</i> inside a blockquote. {LOREM}</p></blockquote>'
        f'<ul><li>Item one {LOREM}</li><li>Item <b>two</b></li><li>Item three</li></ul>'
        f'<table><tr><td>cell A1</td><td>cell <em>A2</em></td></tr><tr><td>cell B1</td><td>{LOREM}</td></tr></table>'
    )
    img = '<p><img src="img.png" alt="a small generated image" width="64" height="48"/></p>' if n == 2 else ""
    return (f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head><title>Chapter {n}</title></head>'
            f'<body><h1 id="c{n}">Chapter {n}</h1>\n{"".join(paras[:3])}{special}{img}{"".join(paras[3:])}</body></html>')


def make_epub(path: Path, chapters: int = 6):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        items = "".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(1, chapters + 1))
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(1, chapters + 1))
        z.writestr("OEBPS/content.opf",
                   '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-0000000000b1</dc:identifier>'
                   '<dc:title>Locator Stress</dc:title><dc:creator>Synthetic Author</dc:creator><dc:language>en</dc:language>'
                   '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>'
                   f'<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
                   f'<item id="img" href="img.png" media-type="image/png"/>{items}</manifest><spine>{spine}</spine></package>')
        navli = "".join(f'<li><a href="c{i}.xhtml">Chapter {i}</a></li>' for i in range(1, chapters + 1))
        z.writestr("OEBPS/nav.xhtml",
                   '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                   f'<head><title>Contents</title></head><body><nav epub:type="toc"><ol>{navli}</ol></nav></body></html>')
        z.writestr("OEBPS/img.png", png(), compress_type=zipfile.ZIP_STORED)
        for i in range(1, chapters + 1):
            z.writestr(f"OEBPS/c{i}.xhtml", chapter(i))


def make_fb2(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    secs = ""
    for n in range(1, 4):
        paras = "".join(f"<p>Section {n} paragraph {p}: <emphasis>emphasis</emphasis> and <strong>strong</strong> text. {LOREM * 2}</p>" for p in range(1, 6))
        extra = ('<subtitle>A subtitle</subtitle><cite><p>Cited <emphasis>text</emphasis> here.</p><text-author>Someone</text-author></cite><empty-line/>'
                 '<p>Styled <style name="s1">style span</style>, <sup>sup</sup><sub>sub</sub> <strikethrough>struck</strikethrough> <code>code</code> '
                 f'😀 emoji and é combining. {LOREM}</p>'
                 '<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b <strong>c</strong></td></tr></table>')
        secs += (f'<section><title><p>Section {n}</p></title><epigraph><p>An epigraph line.</p></epigraph>{paras}{extra}'
                 f'<poem><stanza><v>First verse line {n}</v><v>Second verse line {n}</v></stanza></poem></section>')
    xml = ('<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">'
           '<description><title-info><genre>prose</genre><author><first-name>Synthetic</first-name><last-name>Author</last-name></author>'
           '<book-title>Locator FB2</book-title><lang>en</lang></title-info><document-info><author><nickname>t</nickname></author>'
           '<date>2026-01-01</date><id>00000000-0000-4000-8000-0000000000b2</id><version>1.0</version></document-info></description>'
           f'<body>{secs}</body></FictionBook>')
    path.write_text(xml, encoding="utf-8")


def make_pdf_edge(path: Path):
    """A 7-page PDF built to expose page-identity differences between renderers: a nested page tree with an inherited MediaBox,
    mixed page sizes and orientations, /Rotate 90 and 270, a CropBox, and page labels (i, ii, 1, 2, ...) that differ from indexes.
    Page n (1-based) carries the text 'PAGE n' (generated, no third-party content)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    objs = {}
    def put(n, body): objs[n] = body
    # object numbers: 1 catalog, 2 root pages, 3 node A, 4 node B, 5 font, 10.. pages, 30.. contents
    pages = [  # (mediabox override or None, rotate, cropbox or None)
        (None, 0, None),                       # inherits Letter 612x792
        ("[0 0 595 842]", 0, None),            # A4
        ("[0 0 792 612]", 0, None),            # landscape
        (None, 90, None),                      # rotated 90, inherits Letter
        (None, 0, "[50 50 562 742]"),          # crop box inset
        ("[0 0 612 792]", 270, "[0 0 400 600]"),  # rotated 270 and cropped
        ("[0 0 300 900]", 0, None),            # tall and narrow
    ]
    page_ids = [10 + i for i in range(7)]
    put(1, "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D /St 1 >>] >> >>")
    put(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 7 >>")
    put(3, f"<< /Type /Pages /Parent 2 0 R /Kids [{' '.join(f'{i} 0 R' for i in page_ids[:3])}] /Count 3 /MediaBox [0 0 612 792] >>")
    put(4, f"<< /Type /Pages /Parent 2 0 R /Kids [{' '.join(f'{i} 0 R' for i in page_ids[3:])}] /Count 4 /MediaBox [0 0 612 792] >>")
    put(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, (mb, rot, crop) in enumerate(pages):
        n = i + 1
        stream = f"BT /F1 72 Tf 60 {300 if n == 7 else 400} Td (PAGE {n}) Tj ET"
        extra = (f" /MediaBox {mb}" if mb else "") + (f" /Rotate {rot}" if rot else "") + (f" /CropBox {crop}" if crop else "")
        parent = 3 if i < 3 else 4
        put(page_ids[i], f"<< /Type /Page /Parent {parent} 0 R{extra} /Resources << /Font << /F1 5 0 R >> >> /Contents {30 + i} 0 R >>")
        put(30 + i, f"<< /Length {len(stream)} >>" + chr(10) + "stream" + chr(10) + stream + chr(10) + "endstream")
    out = bytearray(b"%PDF-1.4" + bytes([10]))
    offsets = {}
    for n in sorted(objs):
        offsets[n] = len(out)
        out += (f"{n} 0 obj" + chr(10) + objs[n] + chr(10) + "endobj" + chr(10)).encode("latin-1")
    xref = len(out)
    size = max(objs) + 1
    out += (f"xref" + chr(10) + f"0 {size}" + chr(10)).encode()
    out += b"0000000000 65535 f " + bytes([10])
    for n in range(1, size):
        out += ((f"{offsets[n]:010d} 00000 n " if n in offsets else "0000000000 65535 f ") + chr(10)).encode()
    out += (f"trailer" + chr(10) + f"<< /Size {size} /Root 1 0 R >>" + chr(10) + f"startxref" + chr(10) + f"{xref}" + chr(10) + "%%EOF" + chr(10)).encode()
    path.write_bytes(bytes(out))


if __name__ == "__main__":
    make_epub(OUT / "stress.epub")
    make_fb2(OUT / "stress.fb2")
    make_pdf_edge(OUT / "edge.pdf")
    print("wrote", OUT)
