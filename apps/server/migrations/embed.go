// Package migrations embeds the application's Goose migrations. River's own
// schema is migrated separately through rivermigrate and never copied here.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
