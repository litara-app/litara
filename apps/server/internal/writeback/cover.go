package writeback

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// FieldCover is the plan-level field for a cover write (ADR-0086). The plan stores only a reference and a fingerprint of the
// stored cover, never the image, so the reviewer approves exactly the picture that was shown and a changed cover is refused.
const FieldCover = "cover"

// coverRef is what a reviewer sees and approves for a cover write.
type coverRef struct {
	TitleID uuid.UUID `json:"titleId"`
	Medium  string    `json:"medium"`
	SHA256  string    `json:"sha256"`
	Bytes   int       `json:"bytes"`
}

// storedCover returns the stored cover image for a title and medium, or a 409 when there is none to write.
func (s *Service) storedCover(ctx context.Context, titleID uuid.UUID, medium string) ([]byte, error) {
	row, err := sqlcgen.New(s.Pool).GetTitleCover(ctx, sqlcgen.GetTitleCoverParams{TitleID: titleID, Medium: medium})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (row.Image == nil || row.Source == "none")) {
		return nil, apperr.New(409, "no_cover", "This title has no stored cover to write. Choose or upload one first.")
	}
	if err != nil {
		return nil, apperr.ErrUnavailable
	}
	return row.Image, nil
}

// materialize turns a plan's cover reference into the writer's cover_image field, verifying that the stored cover is
// still the reviewed one. Plans without a cover are returned unchanged.
func (s *Service) materialize(ctx context.Context, changes metadata.Fields) (metadata.Fields, error) {
	raw, ok := changes[FieldCover]
	if !ok {
		return changes, nil
	}
	var ref coverRef
	if err := json.Unmarshal(raw, &ref); err != nil || ref.TitleID == uuid.Nil || (ref.Medium != "ebook" && ref.Medium != "audio") {
		return nil, apperr.Validation("the cover reference is not valid")
	}
	img, err := s.storedCover(ctx, ref.TitleID, ref.Medium)
	if err != nil {
		return nil, err
	}
	if sumBytes(img) != ref.SHA256 {
		return nil, apperr.New(409, "cover_changed", "The stored cover changed after this plan was reviewed. Plan the write again.")
	}
	out := metadata.Fields{}
	for k, v := range changes {
		if k != FieldCover {
			out[k] = v
		}
	}
	enc, _ := json.Marshal(base64.StdEncoding.EncodeToString(img))
	out["cover_image"] = enc
	return out, nil
}

// PlanCoverInFile proposes embedding the title's stored cover in one ebook file. It goes through the same in-file plan as
// any metadata write: the format's writer must be enabled with recorded evidence, and nothing is written until the exact
// diff is approved.
func (s *Service) PlanCoverInFile(ctx context.Context, fileID uuid.UUID, medium string) (sqlcgen.WritebackPlan, error) {
	q := sqlcgen.New(s.Pool)
	var titleID uuid.UUID
	var err error
	switch medium {
	case "ebook":
		titleID, err = q.GetEditionTitleForFile(ctx, fileID)
	case "audio":
		titleID, err = q.GetRecordingTitleForFile(ctx, fileID)
	default:
		return sqlcgen.WritebackPlan{}, apperr.Validation("the medium is ebook or audio")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.WritebackPlan{}, apperr.New(409, "cover_embed_unsupported", "This file does not belong to "+map[string]string{"ebook": "an ebook edition", "audio": "an audiobook recording"}[medium]+".")
	}
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	img, err := s.storedCover(ctx, titleID, medium)
	if err != nil {
		return sqlcgen.WritebackPlan{}, err
	}
	ref, _ := json.Marshal(coverRef{TitleID: titleID, Medium: medium, SHA256: sumBytes(img), Bytes: len(img)})
	return s.PlanInFile(ctx, fileID, metadata.Fields{FieldCover: ref})
}

// MaxCoverPlans bounds how many files one audiobook may have a cover planned for at once.
const MaxCoverPlans = 500

// PlanCoverInRecording plans the cover write for every file of an audiobook recording, in order. Each file is its own plan
// with its own approval, because each file is a separate change on disk. The first refusal (for instance a format whose
// writer is off) stops the batch and is returned; plans already made stay unapproved and harmless.
func (s *Service) PlanCoverInRecording(ctx context.Context, recordingID uuid.UUID) ([]sqlcgen.WritebackPlan, error) {
	ids, err := sqlcgen.New(s.Pool).ListRecordingFileIDs(ctx, recordingID)
	if err != nil {
		return nil, apperr.ErrUnavailable
	}
	if len(ids) == 0 {
		return nil, apperr.ErrNotFound
	}
	if len(ids) > MaxCoverPlans {
		return nil, apperr.New(409, "too_many_files", "This audiobook has too many files to plan at once.")
	}
	out := make([]sqlcgen.WritebackPlan, 0, len(ids))
	for _, id := range ids {
		p, err := s.PlanCoverInFile(ctx, id, "audio")
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}
