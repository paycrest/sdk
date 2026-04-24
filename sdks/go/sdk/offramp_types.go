package sdk

// OfframpMethod selects which dispatch path `CreateOfframpOrder` takes.
type OfframpMethod string

const (
	// OfframpMethodAPI posts the order to the aggregator. Default.
	OfframpMethodAPI OfframpMethod = "api"
	// OfframpMethodGateway calls Gateway.createOrder on-chain from the
	// configured signer. Requires ClientOptions.Gateway to be set.
	OfframpMethodGateway OfframpMethod = "gateway"
)

// CreateOfframpOptions controls how a sender order is dispatched.
type CreateOfframpOptions struct {
	Method OfframpMethod
}

// OfframpOrderPayload is the structured payload for an off-ramp order,
// identical across dispatch methods. Callers may also pass an untyped
// map[string]interface{} to keep parity with the existing API.
type OfframpOrderPayload struct {
	Amount              string
	Rate                string
	SenderFee           string
	SenderFeeRecipient  string
	Reference           string
	Source              CryptoSourceInput
	Destination         FiatDestinationInput
}

type CryptoSourceInput struct {
	Currency      string // e.g. "USDT"
	Network       string // e.g. "base"
	RefundAddress string
}

type FiatDestinationInput struct {
	Currency   string
	Country    string
	ProviderID string
	Recipient  FiatRecipientInput
}

type FiatRecipientInput struct {
	Institution       string
	AccountIdentifier string
	AccountName       string
	Memo              string
}

// OfframpOrderResult wraps both dispatch outcomes so
// `CreateOfframpOrder` can keep a single signature. Exactly one of
// Payment or Gateway is populated depending on Method.
type OfframpOrderResult struct {
	Method  OfframpMethod
	Payment *PaymentOrder
	Gateway *GatewayOrderResult
}

// MarshalMap renders the payload into the loose map form the existing
// aggregator path expects.
func (p OfframpOrderPayload) MarshalMap() map[string]interface{} {
	out := map[string]interface{}{
		"amount": p.Amount,
		"source": map[string]interface{}{
			"type":          "crypto",
			"currency":      p.Source.Currency,
			"network":       p.Source.Network,
			"refundAddress": p.Source.RefundAddress,
		},
		"destination": map[string]interface{}{
			"type":     "fiat",
			"currency": p.Destination.Currency,
			"country":  p.Destination.Country,
			"recipient": map[string]interface{}{
				"institution":       p.Destination.Recipient.Institution,
				"accountIdentifier": p.Destination.Recipient.AccountIdentifier,
				"accountName":       p.Destination.Recipient.AccountName,
				"memo":              p.Destination.Recipient.Memo,
			},
		},
	}
	if p.Destination.ProviderID != "" {
		out["destination"].(map[string]interface{})["providerId"] = p.Destination.ProviderID
	}
	if p.Rate != "" {
		out["rate"] = p.Rate
	}
	if p.SenderFee != "" {
		out["senderFee"] = p.SenderFee
	}
	if p.Reference != "" {
		out["reference"] = p.Reference
	}
	return out
}
