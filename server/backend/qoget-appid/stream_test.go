package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/davidetoniatti/qoget/internal/config"
	"github.com/davidetoniatti/qoget/internal/qobuz"
)

type fakeStream struct {
	users, files int
	url          string
	err          error
}

func (f *fakeStream) User(context.Context) (*qobuz.User, error) { f.users++; return &qobuz.User{}, nil }
func (f *fakeStream) FileURL(_ context.Context, _ string, format qobuz.Format) (*qobuz.File, error) {
	f.files++
	if format != qobuz.FormatFLAC {
		panic("quality changed")
	}
	return &qobuz.File{URL: f.url}, f.err
}

func TestStreamSessionReuseAndCredentialRotation(t *testing.T) {
	cfg := &config.Config{AuthToken: "test-token"}
	clock := time.Now()
	created := 0
	client := &fakeStream{url: "https://cdn.example/audio"}
	s := &streamSession{
		load:   func() (*config.Config, error) { return cfg, nil },
		create: func(*config.Config) streamClient { created++; return client },
		now:    func() time.Time { return clock },
	}
	for _, id := range []string{"1", "2"} {
		if !s.resolve(id).Full {
			t.Fatal("stream failed")
		}
	}
	if created != 1 || client.users != 1 || client.files != 2 {
		t.Fatal("client not reused, or track authorization skipped")
	}
	cfg.AuthToken = "rotated"
	s.resolve("3")
	if created != 2 {
		t.Fatal("credentials not refreshed")
	}
	clock = clock.Add(11 * time.Minute)
	s.resolve("4")
	if created != 3 {
		t.Fatal("client refresh overdue")
	}
	cfg.AuthToken = ""
	if s.resolve("5").Full || s.client != nil {
		t.Fatal("removed credentials reused")
	}
}

func TestStreamProtocolAndFailureRecovery(t *testing.T) {
	created := 0
	client := &fakeStream{url: "https://cdn.example/audio"}
	s := &streamSession{
		load:   func() (*config.Config, error) { return &config.Config{AuthToken: "test"}, nil },
		create: func(*config.Config) streamClient { created++; return client },
		now:    time.Now,
	}
	var output bytes.Buffer
	serveStreams(strings.NewReader("{invalid}\n{\"track_id\":\"oops\"}\n{\"track_id\":\"123\"}\n"), &output, s)
	decoder := json.NewDecoder(&output)
	for i := 0; i < 3; i++ {
		var r streamReply
		if decoder.Decode(&r) != nil || r.Full != (i == 2) {
			t.Fatal("protocol desynchronized")
		}
	}
	if created != 1 {
		t.Fatal("invalid input reached Qobuz")
	}
	for _, bad := range []string{"http://cdn.example/audio", "https://user:secret@cdn.example/audio", "https:///missing"} {
		client.url = bad
		if r := s.resolve("123"); r.Full || r.URL != "" || r.Error != "stream_unavailable" {
			t.Fatal("unsafe reply")
		}
	}
	client.err = errors.New("sensitive upstream response")
	if r := s.resolve("123"); r.Error != "stream_unavailable" || s.client != nil {
		t.Fatal("error not sanitized/reset")
	}
	client.err = nil
	client.url = "https://cdn.example/fresh"
	if !s.resolve("123").Full {
		t.Fatal("session did not recover")
	}
}
