package sdk

import "fmt"

type APIError struct {
	StatusCode int
	Message    string
	Details    interface{}
}

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("paycrest api error (%d)", e.StatusCode)
	}
	return e.Message
}
