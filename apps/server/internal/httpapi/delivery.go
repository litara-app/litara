package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/delivery"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type RecipientPath struct {
	RecipientID string `path:"recipientId" format:"uuid"`
}

type DeliveryPath struct {
	DeliveryID string `path:"deliveryId" format:"uuid"`
}

func (a *API) registerDelivery(api huma.API) {
	smtpOps := []struct {
		prefix, getID, putID, testID, summary string
		admin                                 bool
	}{
		{"/delivery/smtp", "getPersonalSmtp", "setPersonalSmtp", "testPersonalSmtp", "personal SMTP transport", false},
		{"/admin/delivery/smtp", "getServerSmtp", "setServerSmtp", "testServerSmtp", "server SMTP transport", true},
	}
	for _, c := range smtpOps {
		c := c
		owner := func(ctx context.Context) delivery.Owner {
			if c.admin {
				return delivery.Owner{}
			}
			return delivery.Owner{Personal: true, User: principal(ctx).UserID}
		}
		wrap := func(o huma.Operation) huma.Operation {
			if c.admin {
				return adminOp(o)
			}
			return o
		}
		huma.Register(api, wrap(t006Read(op(c.getID, http.MethodGet, c.prefix, "Read the "+c.summary, "delivery"))),
			func(ctx context.Context, _ *struct{}) (*bodyOut[wire.SmtpReport], error) {
				out, err := a.Delivery.Report(ctx, owner(ctx))
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.SmtpReport]{Body: out}, nil
			})
		huma.Register(api, wrap(t006Write(op(c.putID, http.MethodPut, c.prefix, "Change the "+c.summary, "delivery"))),
			func(ctx context.Context, in *struct{ Body wire.SmtpWrite }) (*bodyOut[wire.SmtpReport], error) {
				out, err := a.Delivery.Put(ctx, principal(ctx).UserID, owner(ctx), in.Body)
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.SmtpReport]{Body: out}, nil
			})
		huma.Register(api, wrap(t006Write(op(c.testID, http.MethodPost, c.prefix+"/test", "Test the "+c.summary+" without sending mail", "delivery"))),
			func(ctx context.Context, in *struct{ Body wire.RevisionedMutation }) (*bodyOut[wire.ConnectionTest], error) {
				out, err := a.Delivery.Test(ctx, principal(ctx).UserID, owner(ctx), in.Body)
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.ConnectionTest]{Body: out}, nil
			})
	}

	huma.Register(api, t006Read(op("listDeliveryTransports", http.MethodGet, "/delivery/transports", "Transport availability and revisions", "delivery")),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.TransportList], error) {
			out, err := a.Delivery.Transports(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.TransportList]{Body: out}, nil
		})

	huma.Register(api, t006Read(op("listDeliveryRecipients", http.MethodGet, "/delivery/recipients", "The caller's saved recipients", "delivery")),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.RecipientList], error) {
			out, err := a.Delivery.ListRecipients(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.RecipientList]{Body: out}, nil
		})
	huma.Register(api, t006Write(op("putDeliveryRecipient", http.MethodPut, "/delivery/recipients/{recipientId}", "Create or update a saved recipient", "delivery")),
		func(ctx context.Context, in *struct {
			RecipientPath
			Body wire.RecipientWrite
		}) (*bodyOut[wire.Recipient], error) {
			out, err := a.Delivery.PutRecipient(ctx, principal(ctx).UserID, mustUUID(in.RecipientID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Recipient]{Body: out}, nil
		})
	huma.Register(api, t006Write(op("deleteDeliveryRecipient", http.MethodDelete, "/delivery/recipients/{recipientId}", "Delete a saved recipient (tombstone)", "delivery")),
		func(ctx context.Context, in *struct {
			RecipientPath
			Body wire.RevisionedMutation
		}) (*bodyOut[wire.Recipient], error) {
			out, err := a.Delivery.DeleteRecipient(ctx, principal(ctx).UserID, mustUUID(in.RecipientID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Recipient]{Body: out}, nil
		})

	huma.Register(api, t006Read(op("listDeliveries", http.MethodGet, "/deliveries", "The caller's delivery history", "delivery")),
		func(ctx context.Context, in *PageQuery) (*bodyOut[wire.DeliveryList], error) {
			page, size := in.normalized()
			out, err := a.Delivery.List(ctx, principal(ctx).UserID, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.DeliveryList]{Body: out}, nil
		})
	create := t006Write(op("createDelivery", http.MethodPost, "/deliveries", "Queue one explicit original-file email", "delivery"))
	create.DefaultStatus = http.StatusAccepted
	huma.Register(api, create,
		func(ctx context.Context, in *struct{ Body wire.DeliveryCreate }) (*bodyOut[wire.Delivery], error) {
			out, err := a.Delivery.Create(ctx, principal(ctx).UserID, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Delivery]{Body: out}, nil
		})
	huma.Register(api, t006Read(op("getDelivery", http.MethodGet, "/deliveries/{deliveryId}", "One delivery's current state", "delivery")),
		func(ctx context.Context, in *DeliveryPath) (*bodyOut[wire.Delivery], error) {
			out, err := a.Delivery.Get(ctx, principal(ctx).UserID, mustUUID(in.DeliveryID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Delivery]{Body: out}, nil
		})
	huma.Register(api, t006Write(op("cancelDelivery", http.MethodPost, "/deliveries/{deliveryId}/cancel", "Cancel a request that has not started submission", "delivery")),
		func(ctx context.Context, in *struct {
			DeliveryPath
			Body wire.RevisionedMutation
		}) (*bodyOut[wire.Delivery], error) {
			out, err := a.Delivery.Cancel(ctx, principal(ctx).UserID, mustUUID(in.DeliveryID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Delivery]{Body: out}, nil
		})
}
