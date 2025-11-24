# Makefile for UFO Encoder

NIM = nim
NIMFLAGS = -d:release -d:danger --threads:on --opt:speed --gc:arc
BINARY = ufo_encoder

.PHONY: all clean install deps build debug

all: deps build

deps:
	nimble install -y yaml

build:
	$(NIM) c $(NIMFLAGS) -o:$(BINARY) ufo_encoder.nim

debug:
	$(NIM) c --threads:on -o:$(BINARY)_debug ufo_encoder.nim

clean:
	rm -f $(BINARY) $(BINARY)_debug
	rm -rf nimcache

install: build
	cp $(BINARY) /usr/local/bin/

test:
	./$(BINARY) -h
