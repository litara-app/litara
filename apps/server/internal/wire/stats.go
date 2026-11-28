package wire

// ReadingStatsDay is one local calendar day with reading (ADR-0098). Days without sessions are omitted.
type ReadingStatsDay struct {
	Date          string `json:"date" format:"date"`
	ActiveSeconds int64  `json:"activeSeconds" minimum:"0"`
	Sessions      int64  `json:"sessions" minimum:"1"`
	// ReadingDay is true when the day's reading and listening reach readingDaySeconds; only reading days count toward streaks.
	ReadingDay bool `json:"readingDay"`
}

// ActivityDay is one local day with any reading or listening (ADR-0109).
type ActivityDay struct {
	Date              string `json:"date" format:"date"`
	ReadingSeconds    int64  `json:"readingSeconds" minimum:"0"`
	ReadingSessions   int64  `json:"readingSessions" minimum:"0"`
	ListeningSeconds  int64  `json:"listeningSeconds" minimum:"0"`
	ListeningSessions int64  `json:"listeningSessions" minimum:"0"`
	// ReadingDay is true when reading and listening together reach readingDaySeconds.
	ReadingDay bool `json:"readingDay"`
}

// ReadingStats summarizes the caller's own ebook reading sessions between from and to (inclusive local dates) in
// timeZone (ADR-0098), and their listening (ADR-0109).
type ReadingStats struct {
	From     string `json:"from" format:"date"`
	To       string `json:"to" format:"date"`
	TimeZone string `json:"timeZone"`
	// ReadingDaySeconds is the active time a day needs to count as a reading day.
	ReadingDaySeconds int64             `json:"readingDaySeconds" minimum:"1"`
	Days              []ReadingStatsDay `json:"days"`
	ActiveSeconds     int64             `json:"activeSeconds" minimum:"0"`
	ReadingDays       int64             `json:"readingDays" minimum:"0"`
	Sessions          int64             `json:"sessions" minimum:"0"`
	Books             int64             `json:"books" minimum:"0" doc:"Distinct titles read in the range."`
	// CurrentStreak is the run of consecutive reading days ending today or yesterday; 0 when the range ends earlier.
	CurrentStreak int64 `json:"currentStreak" minimum:"0"`
	LongestStreak int64 `json:"longestStreak" minimum:"0" doc:"Within the range."`
	// Audiobook listening (ADR-0109). days, activeSeconds, sessions and books above describe ebook reading only, while
	// readingDays and both streaks count reading and listening together.
	Activity          []ActivityDay `json:"activity" doc:"Every day with reading or listening."`
	ListeningSeconds  int64         `json:"listeningSeconds" minimum:"0"`
	ListeningSessions int64         `json:"listeningSessions" minimum:"0"`
	ListenedBooks     int64         `json:"listenedBooks" minimum:"0" doc:"Distinct titles listened to in the range."`
	// PaperBooksFinished is counted on its own (ADR-0116): paper reading adds no time, pages or reading days.
	PaperBooksFinished int64 `json:"paperBooksFinished" minimum:"0" doc:"Distinct titles whose paper copy was marked finished in the range."`
}
