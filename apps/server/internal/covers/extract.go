package covers

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"io"
	"path"
	"sort"
	"strings"
)

// ErrNoCover is returned when a file holds no usable cover, or its format is not supported yet.
var ErrNoCover = errors.New("no cover could be extracted from the file")

const maxEntryBytes = MaxBytes

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxEntryBytes+1))
	if err != nil || len(data) > maxEntryBytes {
		return nil, ErrNoCover
	}
	return data, nil
}

func findEntry(zr *zip.Reader, name string) *zip.File {
	name = path.Clean(strings.TrimPrefix(name, "/"))
	for _, f := range zr.File {
		if path.Clean(f.Name) == name {
			return f
		}
	}
	return nil
}

// FromEPUB returns the cover image inside an EPUB: the manifest item named by the OPF cover metadata, or the one
// marked cover-image, or an image whose name says cover.
func FromEPUB(zr *zip.Reader) ([]byte, error) {
	cont := findEntry(zr, "META-INF/container.xml")
	if cont == nil {
		return nil, ErrNoCover
	}
	cb, err := readZipEntry(cont)
	if err != nil {
		return nil, ErrNoCover
	}
	var container struct {
		Rootfiles []struct {
			Path string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if xml.Unmarshal(cb, &container) != nil || len(container.Rootfiles) == 0 {
		return nil, ErrNoCover
	}
	opfPath := container.Rootfiles[0].Path
	opf := findEntry(zr, opfPath)
	if opf == nil {
		return nil, ErrNoCover
	}
	ob, err := readZipEntry(opf)
	if err != nil {
		return nil, ErrNoCover
	}
	var pkg struct {
		Metas []struct {
			Name    string `xml:"name,attr"`
			Content string `xml:"content,attr"`
		} `xml:"metadata>meta"`
		Items []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			MediaType  string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"manifest>item"`
	}
	if xml.Unmarshal(ob, &pkg) != nil {
		return nil, ErrNoCover
	}
	dir := path.Dir(opfPath)
	href := ""
	for _, m := range pkg.Metas {
		if strings.EqualFold(m.Name, "cover") {
			for _, it := range pkg.Items {
				if it.ID == m.Content {
					href = it.Href
				}
			}
		}
	}
	if href == "" {
		for _, it := range pkg.Items {
			for _, p := range strings.Fields(it.Properties) {
				if p == "cover-image" {
					href = it.Href
				}
			}
		}
	}
	if href == "" {
		for _, it := range pkg.Items {
			if strings.HasPrefix(it.MediaType, "image/") && strings.Contains(strings.ToLower(it.Href), "cover") {
				href = it.Href
				break
			}
		}
	}
	if href == "" {
		return nil, ErrNoCover
	}
	if u, err := unescape(href); err == nil {
		href = u
	}
	entry := findEntry(zr, path.Join(dir, href))
	if entry == nil {
		return nil, ErrNoCover
	}
	return readZipEntry(entry)
}

func unescape(s string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && i+2 < len(s) {
			var v byte
			ok := true
			for _, c := range []byte{s[i+1], s[i+2]} {
				v <<= 4
				switch {
				case c >= '0' && c <= '9':
					v |= c - '0'
				case c >= 'a' && c <= 'f':
					v |= c - 'a' + 10
				case c >= 'A' && c <= 'F':
					v |= c - 'A' + 10
				default:
					ok = false
				}
			}
			if ok {
				b.WriteByte(v)
				i += 2
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String(), nil
}

// FromComic returns the first page (by name order) of a CBZ.
func FromComic(zr *zip.Reader) ([]byte, error) {
	var names []*zip.File
	for _, f := range zr.File {
		ext := strings.ToLower(path.Ext(f.Name))
		if !f.FileInfo().IsDir() && (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp") && !strings.Contains(f.Name, "__MACOSX") {
			names = append(names, f)
		}
	}
	if len(names) == 0 {
		return nil, ErrNoCover
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i].Name) < strings.ToLower(names[j].Name) })
	return readZipEntry(names[0])
}

// FromFile extracts a cover from an ebook file by format. PDF, MOBI, AZW and FB2 need a renderer or another parser and
// are reported as having no extractable cover for now.
func FromFile(format string, r io.ReaderAt, size int64) ([]byte, error) {
	switch format {
	case "epub", "kepub", "cbz":
		zr, err := zip.NewReader(r, size)
		if err != nil {
			return nil, ErrNoCover
		}
		if format == "cbz" {
			return FromComic(zr)
		}
		return FromEPUB(zr)
	}
	return nil, ErrNoCover
}
