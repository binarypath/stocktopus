.PHONY: dev build test smoke clean setup-agents agent-train

dev: build
	./bin/stocktopus

build:
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
