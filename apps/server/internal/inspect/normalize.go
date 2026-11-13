package inspect

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// rawProbe mirrors the subset of ffprobe JSON that we consume. ffprobe emits
// many numerics as strings, so they are parsed explicitly.
type rawProbe struct {
	Format struct {
		FormatName string            `json:"format_name"`
		LongName   string            `json:"format_long_name"`
		StartTime  string            `json:"start_time"`
		Duration   string            `json:"duration"`
		BitRate    string            `json:"bit_rate"`
		ProbeScore int               `json:"probe_score"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		Index         int               `json:"index"`
		CodecType     string            `json:"codec_type"`
		CodecName     string            `json:"codec_name"`
		CodecLongName string            `json:"codec_long_name"`
		Profile       string            `json:"profile"`
		SampleRate    string            `json:"sample_rate"`
		Channels      int64             `json:"channels"`
		ChannelLayout string            `json:"channel_layout"`
		BitRate       string            `json:"bit_rate"`
		Duration      string            `json:"duration"`
		Width         int64             `json:"width"`
		Height        int64             `json:"height"`
		Disposition   map[string]int    `json:"disposition"`
		Tags          map[string]string `json:"tags"`
	} `json:"streams"`
	Chapters []struct {
		ID        int64             `json:"id"`
		TimeBase  string            `json:"time_base"`
		Start     int64             `json:"start"`
		StartTime string            `json:"start_time"`
		End       int64             `json:"end"`
		EndTime   string            `json:"end_time"`
		Tags      map[string]string `json:"tags"`
	} `json:"chapters"`
}

// secondsToMs converts ffprobe's decimal seconds string to milliseconds.
// "", "N/A" and unparsable values are unknown (nil).
func secondsToMs(s string) *int64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "N/A" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	ms := int64(math.Round(f * 1000))
	return &ms
}

func parseInt(s string) *int64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "N/A" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

func positive(p *int64) *int64 {
	if p == nil || *p <= 0 {
		return nil
	}
	return p
}

func lowerTags(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[strings.ToLower(k)] = v
	}
	return out
}

// Normalize converts ffprobe JSON into a Result. It returns a malformed-media
// Error when the document is unusable (no recognizable container).
func Normalize(data []byte) (*Result, error) {
	var raw rawProbe
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, &Error{Outcome: OutcomeToolFailure, Message: "unparsable ffprobe output: " + err.Error()}
	}
	if raw.Format.FormatName == "" {
		return nil, &Error{Outcome: OutcomeMalformedMedia, Message: "no container format recognized"}
	}

	r := &Result{
		SchemaVersion: SchemaVersion,
		Format: Format{
			Name:               raw.Format.FormatName,
			LongName:           raw.Format.LongName,
			ProbeScore:         raw.Format.ProbeScore,
			DurationMs:         positive(secondsToMs(raw.Format.Duration)),
			StartTimeMs:        secondsToMs(raw.Format.StartTime),
			BitRate:            positive(parseInt(raw.Format.BitRate)),
			Tags:               lowerTags(raw.Format.Tags),
			RawDurationSeconds: raw.Format.Duration,
		},
		Streams:  []Stream{},
		Artwork:  []Artwork{},
		Chapters: []Chapter{},
		Issues:   []Issue{},
	}

	audio := 0
	var audioDurationMs *int64
	for _, s := range raw.Streams {
		attached := s.Disposition["attached_pic"] == 1
		st := Stream{
			Index: s.Index, Type: s.CodecType, Codec: s.CodecName,
			CodecLongName: s.CodecLongName, Profile: s.Profile,
			SampleRate:    positive(parseInt(s.SampleRate)),
			ChannelLayout: s.ChannelLayout,
			BitRate:       positive(parseInt(s.BitRate)),
			DurationMs:    positive(secondsToMs(s.Duration)),
			AttachedPic:   attached,
			Tags:          lowerTags(s.Tags),
		}
		if s.Channels > 0 {
			c := s.Channels
			st.Channels = &c
		}
		if s.Width > 0 {
			w := s.Width
			st.Width = &w
		}
		if s.Height > 0 {
			h := s.Height
			st.Height = &h
		}
		r.Streams = append(r.Streams, st)
		if s.CodecType == "audio" {
			audio++
			if audioDurationMs == nil {
				audioDurationMs = st.DurationMs
			}
		}
		if attached {
			r.Artwork = append(r.Artwork, Artwork{
				StreamIndex: s.Index, Codec: s.CodecName,
				Width: st.Width, Height: st.Height, Source: "attached_picture",
			})
		}
	}

	for i, c := range raw.Chapters {
		start := secondsToMs(c.StartTime)
		if start == nil {
			r.Issues = append(r.Issues, Issue{"chapter_timing_unknown", fmt.Sprintf("chapter %d has no start time; skipped", i)})
			continue
		}
		r.Chapters = append(r.Chapters, Chapter{
			Index: i, Title: lowerTags(c.Tags)["title"], StartMs: *start,
			EndMs: secondsToMs(c.EndTime), TimeBase: c.TimeBase,
			RawStart: c.Start, RawEnd: c.End,
		})
	}

	// Container duration is preferred; fall back to the first audio stream's.
	if r.Format.DurationMs == nil && audioDurationMs != nil {
		r.Format.DurationMs = audioDurationMs
		r.Issues = append(r.Issues, Issue{"duration_from_stream", "container duration missing; using first audio stream duration"})
	}

	r.Completeness = Complete
	if audio == 0 {
		r.Completeness = Incomplete
		r.Issues = append(r.Issues, Issue{"no_audio_stream", "no audio stream found"})
	}
	if r.Format.DurationMs == nil {
		r.Completeness = Incomplete
		r.Issues = append(r.Issues, Issue{"duration_unknown", "duration is missing or non-positive; not defaulted to zero"})
	}
	return r, nil
}
