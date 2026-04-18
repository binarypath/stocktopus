package server

import (
	"os"
	"path/filepath"
	"runtime"
)

func projectRoot() string {
	if env := os.Getenv("STOCKTOPUS_ROOT"); env != "" {
		return env
	}
	_, f, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(f), "..", "..")
}

func templatesDir() string {
	return filepath.Join(projectRoot(), "internal", "server", "templates")
}

func staticDir() string {
	return filepath.Join(projectRoot(), "internal", "server", "static")
}
