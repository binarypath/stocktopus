.PHONY: dev build test smoke clean

dev: build
	./bin/stocktopus

build:
	go build -o bin/stocktopus ./cmd/stocktopus

test:
	go test ./...

smoke:
	go test -tags e2e -v -count=1 ./tests/e2e/

clean:
	rm -rf bin/
