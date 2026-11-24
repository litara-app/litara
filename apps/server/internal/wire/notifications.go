package wire

// Notification is one entry of an account's notification history (ADR-0089).
type Notification struct {
	ID        string `json:"id" format:"uuid"`
	Tone      string `json:"tone" enum:"success,info,warning,error"`
	Title     string `json:"title" maxLength:"300"`
	Detail    string `json:"detail,omitempty" maxLength:"2000"`
	Source    string `json:"source" enum:"user,system" doc:"user: the result of the person's own action. system: background work they did not start."`
	Read      bool   `json:"read"`
	CreatedAt string `json:"createdAt" format:"date-time"`
}

// Notifications is the newest part of the history, newest first, with the count of unread entries over all of it.
type Notifications struct {
	Items  []Notification `json:"items"`
	Unread int            `json:"unread" minimum:"0"`
}

// NotificationWrite records the result of the caller's own action. Entries from background work are created by the
// server itself and cannot be written through the API.
type NotificationWrite struct {
	Tone   string `json:"tone" enum:"success,info,warning,error"`
	Title  string `json:"title" minLength:"1" maxLength:"300"`
	Detail string `json:"detail,omitempty" maxLength:"2000"`
}
