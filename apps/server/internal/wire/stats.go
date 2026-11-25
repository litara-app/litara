package wire

// ReadingStatsDay is one local calendar day with reading (ADR-0098). Days without sessions are omitted.
type ReadingStatsDay struct {
	Date          string `json:"date" format:"date"`
	ActiveSeconds int64  `json:"activeSeconds" minimum:"0"`
	Sessions      int64  `json:"sessions" minimum:"1"`
	// ReadingDay is true when the day reaches readingDaySeconds; only reading days count toward streaks.
	ReadingDay bool `json:"readingDay"`
}

// ReadingStats summarizes the caller's own ebook reading sessions between from and to (inclusive local dates) in
// timeZone (ADR-0098). Audiobook listening is not recorded, so it is not counted.
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
}
