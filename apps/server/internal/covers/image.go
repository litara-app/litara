// Package covers chooses, fetches, extracts and stores title covers (ADR-0086). Every image that is stored passes
// through Normalize, so what the server serves is always a bounded JPEG it produced itself.
package covers

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // decoders for the formats Normalize accepts
	"io"
	"net/http"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	// MaxBytes bounds one source image, uploaded or fetched.
	MaxBytes = 10 << 20
	// MaxSide is the longest side of a stored cover, in pixels.
	MaxSide = 1600
	// maxPixels refuses a decompression bomb before any pixel data is allocated.
	maxPixels = 40_000_000
)

// ErrNotAnImage is returned for anything that is not a JPEG, PNG or WebP picture of a sane size.
var ErrNotAnImage = errors.New("the file is not a JPEG, PNG or WebP image of a supported size")

// ErrTooLarge is returned when the source exceeds MaxBytes.
var ErrTooLarge = fmt.Errorf("the image is larger than %d MiB", MaxBytes>>20)

// Normalize reads one image from r, checks it by content (not by declared type), and returns a JPEG whose longest
// side is at most MaxSide, with all metadata dropped and transparency flattened onto white.
func Normalize(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxBytes {
		return nil, ErrTooLarge
	}
	switch http.DetectContentType(data) {
	case "image/jpeg", "image/png", "image/webp":
	default:
		return nil, ErrNotAnImage
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width*cfg.Height > maxPixels {
		return nil, ErrNotAnImage
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrNotAnImage
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if long := max(w, h); long > MaxSide {
		w, h = max(1, w*MaxSide/long), max(1, h*MaxSide/long)
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(out, out.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(out, out.Bounds(), src, b, xdraw.Over, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
