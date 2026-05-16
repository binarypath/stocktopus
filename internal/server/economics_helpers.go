package server

import (
	"context"
	"errors"
	"net/http"
	"time"
)

func httpErr(msg string) error { return errors.New(msg) }

func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}
