package sdk

import "fmt"

// FieldError is one entry from the aggregator's 400-response
// `{"data":[{"field":"amount","message":"required"}, ...]}` payload.
type FieldError struct {
	Field   string
	Message string
}

// APIError is the base error type raised for every non-success
// aggregator response. Callers can switch on Kind or use errors.As with
// one of the typed variants below to branch on specific cases.
type APIError struct {
	StatusCode        int
	Message           string
	Details           interface{}
	Kind              ErrorKind
	RetryAfterSeconds float64
	// FieldErrors is populated on 400 validation responses when the
	// aggregator returns the conventional [{field, message}] shape.
	// Nil / empty on non-validation errors.
	FieldErrors []FieldError
}

// ErrorKind classifies common aggregator error cases so callers don't
// have to string-match messages.
type ErrorKind int

const (
	ErrUnspecified ErrorKind = iota
	ErrValidation
	ErrAuthentication
	ErrNotFound
	ErrRateLimit
	ErrProviderUnavailable
	ErrOrderRejected
	ErrRateQuoteUnavailable
	ErrNetwork
)

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("paycrest api error (%d)", e.StatusCode)
	}
	return e.Message
}

// Is enables `errors.Is(err, ErrValidation)` for consumers. Matches on
// Kind rather than pointer identity so wrapping stays cheap.
func (e *APIError) Is(target error) bool {
	if k, ok := target.(ErrorKind); ok {
		return e.Kind == k
	}
	if other, ok := target.(*APIError); ok {
		return other == e
	}
	return false
}

func (k ErrorKind) Error() string {
	switch k {
	case ErrValidation:
		return "validation error"
	case ErrAuthentication:
		return "authentication error"
	case ErrNotFound:
		return "not found"
	case ErrRateLimit:
		return "rate limit exceeded"
	case ErrProviderUnavailable:
		return "provider unavailable"
	case ErrOrderRejected:
		return "order rejected"
	case ErrRateQuoteUnavailable:
		return "rate quote unavailable"
	case ErrNetwork:
		return "network error"
	default:
		return "paycrest error"
	}
}

// classifyHTTPError turns a non-success HTTP response into an APIError
// with the appropriate Kind populated.
func classifyHTTPError(statusCode int, message string, details interface{}, retryAfterSeconds float64) *APIError {
	kind := ErrUnspecified
	switch {
	case statusCode == 400:
		kind = ErrValidation
	case statusCode == 401 || statusCode == 403:
		kind = ErrAuthentication
	case statusCode == 404:
		kind = ErrNotFound
	case statusCode == 429:
		kind = ErrRateLimit
	case statusCode == 503:
		kind = ErrProviderUnavailable
	}
	return &APIError{
		StatusCode:        statusCode,
		Message:           message,
		Details:           details,
		Kind:              kind,
		RetryAfterSeconds: retryAfterSeconds,
		FieldErrors:       parseFieldErrors(details),
	}
}

// parseFieldErrors extracts the `[{field,message}, ...]` shape the
// aggregator emits on 400 responses. Returns nil if `details` has a
// different shape.
func parseFieldErrors(details interface{}) []FieldError {
	list, ok := details.([]interface{})
	if !ok {
		return nil
	}
	out := make([]FieldError, 0, len(list))
	for _, row := range list {
		obj, ok := row.(map[string]interface{})
		if !ok {
			continue
		}
		field, fieldOk := obj["field"].(string)
		msg, msgOk := obj["message"].(string)
		if fieldOk && msgOk {
			out = append(out, FieldError{Field: field, Message: msg})
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
