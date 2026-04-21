.PHONY: dev build test smoke clean setup-agents agent-train lint-js

dev: build
	./bin/stocktopus

lint-js:
	@node --check internal/server/static/terminal.js 2>&1 && echo "terminal.js OK" || (echo "terminal.js has syntax errors" && exit 1)
	@node --check internal/server/static/info.js 2>&1 && echo "info.js OK" || (echo "info.js has syntax errors" && exit 1)
	@node --check internal/server/static/chart.js 2>&1 && echo "chart.js OK" || (echo "chart.js has syntax errors" && exit 1)

build: lint-js
	CGO_ENABLED=1 go build -o bin/stocktopus ./cmd/stocktopus

test:
	go test ./...

smoke:
	go test -tags e2e -v -count=1 ./tests/e2e/

setup-agents:
	@echo "Installing Ollama (if not present)..."
	@which ollama > /dev/null 2>&1 || (echo "Please install Ollama from https://ollama.ai/download" && exit 1)
	ollama pull gemma4
	python3 -m venv .venv
	.venv/bin/pip install requests beautifulsoup4 feedparser
	@echo "Agent setup complete"

agent-train:
	@echo "Exporting training data and creating model..."
	CGO_ENABLED=1 go run ./cmd/stocktopus -train
	@echo "Training complete"

clean:
	rm -rf bin/ stocktopus.db
