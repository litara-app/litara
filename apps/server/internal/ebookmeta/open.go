package ebookmeta

import (
	"bytes"
	"fmt"
	"io"
	"os"
)

// openLimited reads at most maxXMLBytes of a plain-text container.
func openLimited(abs string) (*bytes.Reader, error) {
	f, err := os.Open(abs)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxXMLBytes+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxXMLBytes {
		return nil, fmt.Errorf("fb2 exceeds %d bytes; metadata is not read from larger files", maxXMLBytes)
	}
	return bytes.NewReader(b), nil
}
