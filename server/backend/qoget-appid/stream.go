package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/url"
	"strconv"
	"time"

	"github.com/davidetoniatti/qoget/internal/config"
	"github.com/davidetoniatti/qoget/internal/qobuz"
)

type streamClient interface {
	User(context.Context) (*qobuz.User, error)
	FileURL(context.Context, string, qobuz.Format) (*qobuz.File, error)
}

type streamReply struct {
	URL   string `json:"url,omitempty"`
	Full  bool   `json:"full"`
	Error string `json:"error,omitempty"`
}

// One serial session per worker; no signed URLs are cached or written to disk.
type streamSession struct {
	load        func() (*config.Config, error)
	create      func(*config.Config) streamClient
	now         func() time.Time
	client      streamClient
	fingerprint [32]byte
	initialized time.Time
}

func newStreamSession() *streamSession {
	return &streamSession{
		load: func() (*config.Config, error) { return config.Load(config.Path()) },
		create: func(c *config.Config) streamClient {
			return qobuz.New(qobuz.Options{AuthToken: c.AuthToken, AppID: c.AppID, Secrets: c.Secrets})
		},
		now: time.Now,
	}
}

func (s *streamSession) resolve(track string) streamReply {
	failure := streamReply{Error: "stream_unavailable"}
	if _, err := strconv.ParseUint(track, 10, 64); err != nil || track == "" {
		return failure
	}
	cfg, err := s.load()
	if err != nil || cfg == nil || cfg.AuthToken == "" {
		s.client = nil
		return failure
	}
	identity, _ := json.Marshal(struct {
		Token, AppID string
		Secrets      []string
	}{cfg.AuthToken, cfg.AppID, cfg.Secrets})
	fingerprint := sha256.Sum256(identity)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if s.client == nil || fingerprint != s.fingerprint || s.now().Sub(s.initialized) >= 10*time.Minute {
		s.client = s.create(cfg)
		if _, err := s.client.User(ctx); err != nil {
			s.client = nil
			return failure
		}
		s.fingerprint, s.initialized = fingerprint, s.now()
	}
	// FileURL authorizes every track and rejects samples, unavailable streams
	// and incompatible formats. Reuse connections, never cached entitlements.
	file, err := s.client.FileURL(ctx, track, qobuz.FormatFLAC)
	if err != nil || file == nil {
		s.client = nil
		return failure
	}
	parsed, err := url.Parse(file.URL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		s.client = nil
		return failure
	}
	return streamReply{URL: file.URL, Full: true}
}

func serveStreams(input io.Reader, output io.Writer, session *streamSession) {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 1024), 4096)
	encoder := json.NewEncoder(output)
	for scanner.Scan() {
		var request struct {
			TrackID string `json:"track_id"`
		}
		reply := streamReply{Error: "invalid_request"}
		if json.Unmarshal(scanner.Bytes(), &request) == nil {
			reply = session.resolve(request.TrackID)
		}
		if encoder.Encode(reply) != nil {
			return
		}
	}
}
