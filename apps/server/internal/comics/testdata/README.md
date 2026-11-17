# Test archives

Generated for ADR-0072 with 7-Zip (`7z a`) from three tiny synthetic PNG pages named
`pages/1.png`, `pages/2.png` and `pages/10.png` (solid red, green and blue; authored for
this project). Encrypted samples use the password `Secret`.

- `solid-lzma2.7z` solid LZMA2 (`-m0=lzma2 -ms=on`)
- `lzma.7z` LZMA, non-solid
- `encrypted-data.7z` file contents encrypted (headers readable)
- `encrypted-headers.7z` headers and contents encrypted (`-mhe=on`)

RAR test archives are written by `internal/comics/archivetest` (RAR5 "store" only).
