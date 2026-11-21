package writeback

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
)

const maxCoverBytes = 12 << 20

// parseCoverImage reads the engine-supplied cover: a JSON string of base64 JPEG bytes.
func parseCoverImage(raw json.RawMessage) ([]byte, error) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || s == "" {
		return nil, errors.New("cover_image must be a base64 string")
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) == 0 || len(b) > maxCoverBytes {
		return nil, errors.New("cover_image is not a valid image of a supported size")
	}
	if http.DetectContentType(b) != "image/jpeg" {
		return nil, errors.New("cover_image must be a JPEG")
	}
	if _, err := jpeg.Decode(bytes.NewReader(b)); err != nil {
		return nil, errors.New("cover_image is not a readable JPEG")
	}
	return b, nil
}

func readEntry(f *zip.File, max int) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, int64(max)+1))
	if err != nil || len(b) > max {
		return nil, errors.New("entry could not be read within limits")
	}
	return b, nil
}

// ErrNoDeclaredCover is returned by declaredCover for an EPUB whose package document names no cover image. The writer
// then adds one (ADR-0086); it is an error only for a package it cannot safely extend.
var ErrNoDeclaredCover = errors.New("this EPUB declares no cover image")

// coverFile is the archive entry a new cover is added as, next to the package document.
const coverFile = "litara-cover.jpg"

type opfManifest struct {
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
	Version string `xml:"version,attr"`
}

// declaredCover finds the cover image the package document already names: the manifest item that <meta name="cover">
// points to, or the item marked cover-image. It returns the archive entry name and its declared media type.
func (e *epubFile) declaredCover() (name, mediaType string, err error) {
	var pkg opfManifest
	if xml.Unmarshal(e.opf, &pkg) != nil {
		return "", "", errors.New("the package document could not be read")
	}
	pick := -1
	for _, m := range pkg.Metas {
		if strings.EqualFold(m.Name, "cover") {
			for i, it := range pkg.Items {
				if it.ID == m.Content {
					pick = i
				}
			}
		}
	}
	if pick < 0 {
		for i, it := range pkg.Items {
			for _, p := range strings.Fields(it.Properties) {
				if p == "cover-image" {
					pick = i
				}
			}
		}
	}
	if pick < 0 {
		return "", "", ErrNoDeclaredCover
	}
	href, uerr := url.PathUnescape(pkg.Items[pick].Href)
	if uerr != nil {
		href = pkg.Items[pick].Href
	}
	name = path.Clean(path.Join(path.Dir(e.opfName), href))
	if strings.HasPrefix(name, "..") || path.IsAbs(name) {
		return "", "", errors.New("the cover path escapes the archive")
	}
	return name, strings.ToLower(pkg.Items[pick].MediaType), nil
}

// coverPlan is what writing a cover into one EPUB does. Either the declared cover entry is replaced in place, or (when the
// package declares none) a new image entry, a manifest item and a cover meta are added.
type coverPlan struct {
	name string // the entry replaced, or the new entry added
	data []byte // its bytes
	add  bool
	id   string // add: the manifest id and the cover meta's content
	// add: the text inserted into the manifest, kept so validation can prove it was the only change outside <metadata>.
	insert string
}

// planCover decides how to write jpegBytes into the EPUB.
func (e *epubFile) planCover(jpegBytes []byte) (coverPlan, error) {
	name, mt, err := e.declaredCover()
	if errors.Is(err, ErrNoDeclaredCover) {
		return e.planAddedCover(jpegBytes)
	}
	if err != nil {
		return coverPlan{}, err
	}
	found := false
	for _, f := range e.zr.File {
		if f.Name == name {
			found = true
			if f.Method != zip.Store && f.Method != zip.Deflate {
				return coverPlan{}, fmt.Errorf("the cover entry uses unsupported compression method %d", f.Method)
			}
		}
	}
	if !found {
		return coverPlan{}, fmt.Errorf("the declared cover %q is not in the archive", name)
	}
	switch mt {
	case "image/jpeg", "image/jpg":
		return coverPlan{name: name, data: jpegBytes}, nil
	case "image/png":
		img, _, err := image.Decode(bytes.NewReader(jpegBytes))
		if err != nil {
			return coverPlan{}, err
		}
		var buf bytes.Buffer
		if err := (&png.Encoder{CompressionLevel: png.DefaultCompression}).Encode(&buf, img); err != nil {
			return coverPlan{}, err
		}
		return coverPlan{name: name, data: buf.Bytes()}, nil
	}
	return coverPlan{}, fmt.Errorf("the cover is a %s image; only JPEG and PNG covers can be replaced", mt)
}

// planAddedCover plans adding a cover to a package that declares none.
func (e *epubFile) planAddedCover(jpegBytes []byte) (coverPlan, error) {
	var pkg opfManifest
	if xml.Unmarshal(e.opf, &pkg) != nil {
		return coverPlan{}, errors.New("the package document could not be read")
	}
	for _, m := range pkg.Metas {
		if strings.EqualFold(m.Name, "cover") {
			return coverPlan{}, errors.New("the package names a cover that is not in its manifest; fix that before adding a cover")
		}
	}
	name := path.Join(path.Dir(e.opfName), coverFile)
	for _, f := range e.zr.File {
		if f.Name == name {
			return coverPlan{}, fmt.Errorf("the archive already holds an unrelated %q", name)
		}
	}
	id := "litara-cover"
	for n := 2; ; n++ {
		taken := false
		for _, it := range pkg.Items {
			taken = taken || it.ID == id
		}
		if !taken {
			break
		}
		id = fmt.Sprintf("litara-cover-%d", n)
	}
	cp := coverPlan{name: name, data: jpegBytes, add: true, id: id}
	_, text, err := manifestInsertion(e.opf, id, strings.HasPrefix(pkg.Version, "3"))
	if err != nil {
		return coverPlan{}, err
	}
	cp.insert = text
	return cp, nil
}

// packageVersion returns the version attribute of the package element ("2.0", "3.0"), or "".
func packageVersion(opf []byte) string {
	var pkg opfManifest
	if xml.Unmarshal(opf, &pkg) != nil {
		return ""
	}
	return pkg.Version
}

// manifestInsertion finds where a new cover item goes in the package document (after the manifest's last item) and the
// exact text to insert.
func manifestInsertion(opf []byte, id string, epub3 bool) (at int, text string, err error) {
	d := xml.NewDecoder(bytes.NewReader(opf))
	d.Strict = true
	depth, prev := 0, 0
	var prefix string
	closeAt, lastEnd, lastStart := -1, -1, -1
	inManifest := false
	for {
		tok, terr := d.RawToken()
		if terr == io.EOF {
			break
		}
		if terr != nil {
			return 0, "", fmt.Errorf("the package document could not be read: %w", terr)
		}
		off := int(d.InputOffset())
		start := prev
		prev = off
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			if depth == 2 && t.Name.Local == "manifest" {
				inManifest, prefix = true, t.Name.Space
				if len(opf) > off-2 && opf[off-2] == '/' {
					return 0, "", errors.New("the manifest is empty, so a cover cannot be added to it")
				}
			}
			if inManifest && depth == 3 && t.Name.Local == "item" {
				lastStart = start
			}
		case xml.EndElement:
			if inManifest && depth == 3 && t.Name.Local == "item" {
				lastEnd = off
			}
			if depth == 2 && t.Name.Local == "manifest" {
				closeAt = start
				inManifest = false
			}
			depth--
		}
	}
	if closeAt < 0 || lastEnd < 0 || lastStart < 0 {
		return 0, "", errors.New("the manifest could not be located")
	}
	item := "item"
	if prefix != "" {
		item = prefix + ":item"
	}
	node := "<" + item + ` id="` + id + `" href="` + coverFile + `" media-type="image/jpeg"`
	if epub3 {
		node += ` properties="cover-image"`
	}
	node += "/>"
	// Start the new item on its own line with the same indent as the manifest's last item.
	indent := ""
	if nl := bytes.LastIndexByte(opf[:lastStart], '\n'); nl >= 0 && len(bytes.TrimLeft(opf[nl+1:lastStart], " \t")) == 0 {
		indent = "\n" + string(opf[nl+1:lastStart])
	}
	return lastEnd, indent + node, nil
}

// applyManifest inserts the cover item into an package document (the original, or one with metadata edits already applied).
func (cp coverPlan) applyManifest(opf []byte, epub3 bool) ([]byte, error) {
	at, text, err := manifestInsertion(opf, cp.id, epub3)
	if err != nil {
		return nil, err
	}
	if text != cp.insert {
		return nil, errors.New("the manifest changed while planning the cover")
	}
	out := make([]byte, 0, len(opf)+len(text))
	out = append(out, opf[:at]...)
	out = append(out, text...)
	return append(out, opf[at:]...), nil
}
