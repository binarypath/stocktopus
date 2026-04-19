.PHONY: dev build test clean

dev: build
	./bin/stocktopus

build:
	go build -o bin/stocktopus ./cmd/stocktopus

test:
	go test ./...

clean:
	rm -rf bin/
