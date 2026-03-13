#!/bin/bash

# Build script for UFO Encoder with maximum optimizations

echo "Building UFO Encoder with maximum optimizations..."

# Install dependencies first
nimble install -y yaml

# Compile with aggressive optimizations
nim c -d:release -d:danger --threads:on --opt:speed --passC:"-march=native" --passC:"-O3" --passC:"-flto" --passL:"-flto" --gc:arc -o:ufo_encoder ufo_encoder.nim

echo "Build complete! Binary: ./ufo_encoder"
echo "Run with: ./ufo_encoder <designspace> [options]"
