# KOReader large-file digest comparison

The upstream executable was the Linux x86-64 build of [KOReader v2026.07.1](https://github.com/koreader/koreader/releases/tag/v2026.07.1), archive SHA-256 `299aadb28147a25e9432ced1214ea444a4184393b5ae97cf42402c8a61b1a1b0`. The bundled LuaJIT loaded KOReader's own setup and called the unmodified `util.partialMD5` and `ffi/sha2` modules. Litara opened the same local files and called its production `koreader.PartialMD5`.

| Fixture | Logical bytes | KOReader and Litara MD5 |
| --- | ---: | --- |
| EOF exactly at the final sample offset | 1,073,741,824 | `ec7d8653bf43ea569e545b0e54a87fa9` |
| Final sample has only 513 bytes | 1,073,742,337 | `68696ad09de7105c5a15de88525921d2` |
| Sparse file with a marker after the 4 GiB boundary | 4,294,971,393 | `d89491cbf39251bd2aa1e69b89e55ea9` |
| Sparse ZIP64 CBZ with a generated PNG entry beyond 4 GiB | 4,294,967,576 | `d89491cbf39251bd2aa1e69b89e55ea9` |

Each sampled block used the byte pattern `(sample index * 37 + byte index * 13) mod 256`, with sample indices starting at zero. The CBZ used the same sample blocks as the large binary. Python verified its ZIP64 entry offset, decompressed bytes and archive CRC. Distinct files can intentionally share a partial digest. This test exercised the digest on a valid synthetic archive. Rendering a comic of this size was outside the comparison.
