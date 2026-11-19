# Audio metadata writer qualification

The built-in MP3, FLAC, M4A and M4B writers support the `title` field under ADR-0048, ADR-0052 and ADR-0057. Each format starts disabled. An operator can enable it with a retained evidence reference. The existing reviewed plan, staging, byte-version check, optional backup and recovery flow handles publication.

The writers use the Go standard library and do not remux the file. MP3 updates the ID3 title frame (plain ID3v2.3 or v2.4, including tag insertion for an untagged MP3). Native FLAC updates its Vorbis comment. Unfragmented M4A/M4B updates a UTF-8 iTunes title atom. For a fast-start MP4, media offsets stay fixed and the updated movie box moves to the end. The staged file must exactly match a regenerated edit of the original before publication. The service also compares source and staged files using FFprobe.

Run `go test -v ./internal/writeback -run TestAudio` from `apps/server`. FFmpeg and FFprobe 8.0.1 on Windows generated and checked all five fixtures.

| Fixture | Verified |
| --- | --- |
| MP3 ID3v2.3 and ID3v2.4 | Unicode title round trip, two chapters, attached PNG and other metadata |
| Native FLAC | Unicode title round trip, attached PNG, other comments and a byte-identical native two-track CUESHEET |
| AAC M4A and fast-start AAC M4B | Unicode title round trip, two chapters, attached PNG, other metadata and unchanged media timing |

Every case compared SHA-256 for each probed packet, stream codec properties and dispositions, full chapter records and remaining metadata. The source stayed byte-identical and tampering with the staged copy failed validation. Invalid containers and unsupported fields were refused for each format. The native FLAC CUESHEET fixture follows [RFC 9639](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.7). Chapters and pictures are not writable fields. Protected, ambiguous and unsupported metadata layouts fail closed. Broader field mappings and media variants require their own evidence.
