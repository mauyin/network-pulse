FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY poller/go.mod poller/go.sum ./
RUN go mod download
COPY poller/ .
RUN CGO_ENABLED=0 go build -o /bin/poller cmd/poller/main.go
RUN CGO_ENABLED=0 go build -o /bin/backfill cmd/backfill/main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/poller /bin/poller
COPY --from=builder /bin/backfill /bin/backfill
COPY chains.json /chains.json
ENTRYPOINT ["/bin/poller"]
