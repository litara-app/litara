package wire

// DirectoryField is one saved or derived detail of an author or a series (ADR-0102, ADR-0103).
type DirectoryField struct {
	Field   string            `json:"field" enum:"last_name,introduction,biography,description,book_count,status"`
	Source  string            `json:"source" enum:"user,guessed,none" doc:"user is a saved edit, guessed is derived from the name, none has no value."`
	Value   T005MetadataValue `json:"value"`
	Cleared bool              `json:"cleared" doc:"A saved, deliberate clear."`
	Locked  bool              `json:"locked"`
}

// AuthorPhoto describes an author's photo; the image is at the author photo route.
type AuthorPhoto struct {
	Source  string  `json:"source" enum:"upload,url,none"`
	Version *string `json:"version" format:"uuid" nullable:"true" doc:"Changes with every new image; null without one."`
	Locked  bool    `json:"locked"`
}

// DirectoryDetails are the details of one author or series, shared by everyone who can see it (ADR-0104). The revision
// covers every field and the photo.
type DirectoryDetails struct {
	Name     string           `json:"name"`
	Revision string           `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Fields   []DirectoryField `json:"fields" maxItems:"20"`
	Photo    *AuthorPhoto     `json:"photo,omitempty" doc:"Authors only."`
}

// AuthorPhotoFromURL asks the server to fetch a public image and store it as the author's photo (ADR-0105).
type AuthorPhotoFromURL struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	URL          string `json:"url" minLength:"8" maxLength:"2048"`
}
