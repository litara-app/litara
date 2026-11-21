package wire

// CoverSlot says where one medium's current cover came from. Source "none" means the files hold no cover, so the
// generated placeholder is shown.
type CoverSlot struct {
	Source  string  `json:"source" enum:"upload,url,search,extracted,none"`
	Version *string `json:"version,omitempty" format:"uuid"`
}

// TitleCovers describes both cover slots of a title and whether online search is available.
type TitleCovers struct {
	Ebook         CoverSlot `json:"ebook"`
	Audio         CoverSlot `json:"audio"`
	SearchEnabled bool      `json:"searchEnabled"`
}

type CoverFromURL struct {
	Medium string `json:"medium" enum:"ebook,audio"`
	URL    string `json:"url" minLength:"8" maxLength:"2048" doc:"A public http or https address."`
	Source string `json:"source,omitempty" enum:"url,search" doc:"Default url; search when the address came from a search result."`
}

type CoverRegenerate struct {
	Medium string `json:"medium" enum:"ebook,audio"`
}

type CoverSearchResult struct {
	Provider string `json:"provider" maxLength:"64"`
	Title    string `json:"title" maxLength:"512"`
	Author   string `json:"author" maxLength:"512"`
	ImageURL string `json:"imageUrl" maxLength:"2048"`
	ThumbURL string `json:"thumbUrl" maxLength:"2048"`
}

type CoverSearchResults struct {
	Items []CoverSearchResult `json:"items" maxItems:"50"`
}

type CoverSettings struct {
	SearchEnabled bool `json:"searchEnabled" doc:"Whether the server may query Open Library and iTunes for covers."`
}
