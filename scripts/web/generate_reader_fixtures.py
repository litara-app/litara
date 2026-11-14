"""Generate tiny synthetic reader inputs using only the Python standard library.

Writes only to an explicitly supplied empty output directory. No local books are
read. The fixture text/graphics are newly authored test data, under project MIT.
Not an application renderer test and not a complete broad-format corpus.
"""
import argparse
import hashlib
import json
import struct
import zipfile
import zlib
from pathlib import Path

class FixedZip(zipfile.ZipFile):
    def writestr(self, name, data, compress_type=None, compresslevel=None):
        if isinstance(name,str):
            name=zipfile.ZipInfo(name,date_time=(2026,11,14,0,0,0))
        return super().writestr(name,data,compress_type=compress_type,compresslevel=compresslevel)

def png(red, green, blue):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    raw = b''.join(b'\0' + bytes([red, green, blue]) * 64 for _ in range(64))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB',64,64,8,2,0,0,0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

def ebook(path, language='en', scripted=False, kepub=False):
    content = ('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test chapter</title></head><body>'
               '<h1>Chapter One</h1><p id="anchor">'
               + ('<span class="koboSpan" id="kobo.1.1">' if kepub else '')
               + 'Synthetic Litara fixture. Read forward, then return to this exact sentence.'
               + ('</span>' if kepub else '') + '</p>'
               + ('<script>parent.postMessage({type:"hostile-book-script"},"*")</script>'
                  '<img src="https://example.invalid/book-tracking" onerror="document.body.dataset.executed=1" />' if scripted else '')
               + '</body></html>')
    package = ('<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">'
               '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:litara:synthetic:'
               + language + ('-hostile' if scripted else '') + '</dc:identifier><dc:title>Synthetic Test</dc:title>'
               '<dc:creator>Litara Fixture Author</dc:creator><dc:language>' + language + '</dc:language>'
               '<meta property="dcterms:modified">2026-11-14T00:00:00Z</meta></metadata><manifest>'
               '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>'
               '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
               '</manifest><spine><itemref idref="chapter"/></spine></package>')
    with FixedZip(path,'w') as archive:
        archive.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        archive.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        archive.writestr('OPS/package.opf',package)
        archive.writestr('OPS/chapter.xhtml',content)
        archive.writestr('OPS/nav.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter One</a></li></ol></nav></body></html>')

def pdf(path):
    stream=b'BT /F1 16 Tf 70 600 Td (Synthetic Litara PDF fixture. Exact page resume.) Tj ET'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
             b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [20 30 592 762] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
             b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
             b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream',
             b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [20 30 592 762] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>']
    result=bytearray(b'%PDF-1.4\n'); offsets=[0]
    for number, body in enumerate(objects,1):
        offsets.append(len(result)); result.extend(f'{number} 0 obj\n'.encode()+body+b'\nendobj\n')
    xref=len(result); result.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]: result.extend(f'{offset:010d} 00000 n \n'.encode())
    result.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    path.write_bytes(result)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('output',type=Path); args=parser.parse_args()
    output=args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise SystemExit('Output must be absent or empty; existing files are never overwritten.')
    output.mkdir(parents=True,exist_ok=True)
    ebook(output/'synthetic.epub'); ebook(output/'translation.epub','fr')
    ebook(output/'synthetic.kepub.epub',kepub=True); ebook(output/'hostile-script.epub',scripted=True)
    pdf(output/'cropped-rotated.pdf')
    (output/'synthetic.fb2').write_text('<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose</genre><author><first-name>Fixture</first-name><last-name>Author</last-name></author><book-title>Synthetic FB2</book-title><lang>en</lang></title-info><document-info><author><nickname>Litara</nickname></author><date>2026-11-14</date><id>litara-synthetic-fb2</id><version>1.0</version></document-info></description><body><section><title><p>Chapter One</p></title><p>Synthetic fixture for exact location and selection tests.</p></section></body></FictionBook>',encoding='utf-8')
    with FixedZip(output/'numeric-pages.cbz','w') as archive:
        archive.writestr('10.png',png(20,60,160)); archive.writestr('2.png',png(160,60,20))
    with FixedZip(output/'hostile-path.cbz','w') as archive:
        archive.writestr('../outside.png',png(0,0,0)); archive.writestr('1.png',png(255,255,255))
    manifest={'provenance':'Newly authored synthetic text/images; project MIT. Generated containers are test inputs, not proof of reader support.',
              'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(output.iterdir())]}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(f'Generated {len(manifest["files"])} synthetic inputs in {output}')

if __name__=='__main__': main()
