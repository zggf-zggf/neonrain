#!/bin/bash
# Quick demo launcher - builds and runs the streaming demo

cd "$(dirname "$0")"
source ~/.bashrc
go build -o bin/streaming-demo ./test/demo && ./bin/streaming-demo
