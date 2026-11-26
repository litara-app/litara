package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type PlanIn struct {
	PlanID string `path:"planId" format:"uuid"`
}

// managePlan requires administrator status AND a grant on the plan library.
func (a *API) managePlan(ctx context.Context, id string) error {
	lib, err := a.Reading.RepairPlanLibrary(ctx, mustUUID(id))
	if err != nil {
		return a.fail(ctx, err)
	}
	return a.manage(ctx, lib)
}

func (a *API) registerRepair(api huma.API) {
	create := writeOp(op("planRecordingRepair", http.MethodPost, "/admin/recording-repairs", "Plan a reviewed recording merge or split", "repair"))
	create.DefaultStatus = http.StatusCreated
	huma.Register(api, create, func(ctx context.Context, in *struct{ Body wire.RepairCreate }) (*bodyOut[wire.RepairPlan], error) {
		lib, err := a.Reading.RepairSourceLibrary(ctx, in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		out, err := a.Reading.PlanRepair(ctx, a.readingActor(ctx), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.RepairPlan]{Body: out}, nil
	})

	huma.Register(api, readOp(op("getRecordingRepair", http.MethodGet, "/admin/recording-repairs/{planId}", "One repair plan", "repair")),
		func(ctx context.Context, in *PlanIn) (*bodyOut[wire.RepairPlan], error) {
			if err := a.managePlan(ctx, in.PlanID); err != nil {
				return nil, err
			}
			out, err := a.Reading.GetRepair(ctx, mustUUID(in.PlanID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.RepairPlan]{Body: out}, nil
		})

	step := func(id, name, summary string, run func(ctx context.Context, in *struct {
		PlanIn
		Body wire.RepairApply
	}) (wire.RepairPlan, error)) {
		huma.Register(api, writeOp(op(id, http.MethodPost, "/admin/recording-repairs/{planId}/"+name, summary, "repair")),
			func(ctx context.Context, in *struct {
				PlanIn
				Body wire.RepairApply
			}) (*bodyOut[wire.RepairPlan], error) {
				if err := a.managePlan(ctx, in.PlanID); err != nil {
					return nil, err
				}
				out, err := run(ctx, in)
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.RepairPlan]{Body: out}, nil
			})
	}
	type stepIn = struct {
		PlanIn
		Body wire.RepairApply
	}
	step("approveRecordingRepair", "approve", "Approve a reviewed plan", func(ctx context.Context, in *stepIn) (wire.RepairPlan, error) {
		return a.Reading.ApproveRepair(ctx, a.readingActor(ctx), mustUUID(in.PlanID), in.Body)
	})
	step("executeRecordingRepair", "execute", "Apply an approved plan atomically", func(ctx context.Context, in *stepIn) (wire.RepairPlan, error) {
		return a.Reading.ExecuteRepair(ctx, a.readingActor(ctx), mustUUID(in.PlanID), in.Body)
	})
	step("cancelRecordingRepair", "cancel", "Cancel a plan before it is applied", func(ctx context.Context, in *stepIn) (wire.RepairPlan, error) {
		return a.Reading.CancelRepair(ctx, a.readingActor(ctx), mustUUID(in.PlanID), in.Body)
	})
}
