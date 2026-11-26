package wire

// AnnotationHubItem is one live annotation with the book it belongs to (ADR-0099).
type AnnotationHubItem struct {
	Annotation   Annotation `json:"annotation"`
	CreatedAt    string     `json:"createdAt" format:"date-time"`
	TitleID      string     `json:"titleId" format:"uuid"`
	Title        string     `json:"title"`
	Authors      []string   `json:"authors"`
	EditionLabel string     `json:"editionLabel"`
	Format       string     `json:"format"`
}

// AnnotationHub is one page of the caller's own live annotations across every edition they can see, newest change
// first (ADR-0099). Annotations on libraries the caller can no longer access are left out.
type AnnotationHub struct {
	Items []AnnotationHubItem `json:"items" maxItems:"200"`
	Total int64               `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64               `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64               `json:"size" minimum:"1" maximum:"200"`
}

// AnnotationHubTitle is a book the caller has live annotations on, for the hub's book filter.
type AnnotationHubTitle struct {
	TitleID     string   `json:"titleId" format:"uuid"`
	Title       string   `json:"title"`
	Authors     []string `json:"authors"`
	Annotations int64    `json:"annotations" minimum:"1"`
}

type AnnotationHubTitles struct {
	Items []AnnotationHubTitle `json:"items"`
}
