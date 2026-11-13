package inspect

import "errors"

// Outcome is the distinguishable classification of an inspection attempt.
type Outcome string

const (
	OutcomeOK              Outcome = "ok"
	OutcomeIncomplete      Outcome = "incomplete"
	OutcomeMissingInput    Outcome = "missing_input"
	OutcomeUnreadableInput Outcome = "unreadable_input"
	OutcomeMalformedMedia  Outcome = "malformed_media"
	OutcomeToolUnavailable Outcome = "tool_unavailable"
	OutcomeToolFailure     Outcome = "tool_failure"
	OutcomeIOError         Outcome = "io_error"
	OutcomeTimeout         Outcome = "timeout"
	OutcomeOutputLimit     Outcome = "output_limit"
	OutcomeCancelled       Outcome = "cancelled"
)

// Error carries an Outcome. Retryable says whether another attempt could help.
type Error struct {
	Outcome   Outcome
	Retryable bool
	Message   string
}

func (e *Error) Error() string { return string(e.Outcome) + ": " + e.Message }

// OutcomeOf extracts the Outcome from err, defaulting to a retryable tool failure.
func OutcomeOf(err error) (Outcome, bool) {
	var ie *Error
	if errors.As(err, &ie) {
		return ie.Outcome, ie.Retryable
	}
	return OutcomeToolFailure, true
}
