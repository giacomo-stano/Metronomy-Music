// Small adapter built inside qoget's module, using its existing account client.
// Only the public application ID is returned; account tokens and secrets stay local.
package main

import (
    "context"
    "fmt"
    "os"
    "time"
    "crypto/md5"
    "encoding/hex"
    "encoding/json"
    "net/http"
    "net/url"
    "strconv"
    "io"

    "github.com/davidetoniatti/qoget/internal/config"
    "github.com/davidetoniatti/qoget/internal/qobuz"
)

func main() {
    cfg, err := config.Load(config.Path())
    if err != nil || cfg.AuthToken == "" { os.Exit(1) }
    client := qobuz.New(qobuz.Options{AuthToken: cfg.AuthToken, AppID: cfg.AppID, Secrets: cfg.Secrets})
    ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    if _, err := client.User(ctx); err != nil { os.Exit(1) }
    appID, secrets := client.Credentials()
    if appID == "" { os.Exit(1) }
    if len(os.Args) == 3 && os.Args[1] == "preview" {
        track := os.Args[2]
        if _, err := strconv.ParseUint(track, 10, 64); err != nil { os.Exit(1) }
        for _, secret := range secrets {
            timestamp := strconv.FormatInt(time.Now().Unix(), 10)
            digest := md5.Sum([]byte("trackgetFileUrlformat_id5intentstreamsampletruetrack_id" + track + timestamp + secret))
            params := url.Values{"track_id": {track}, "format_id": {"5"}, "intent": {"stream"}, "sample": {"true"}, "app_id": {appID}, "request_ts": {timestamp}, "request_sig": {hex.EncodeToString(digest[:])}}
            req, err := http.NewRequestWithContext(ctx, "GET", "https://www.qobuz.com/api.json/0.2/track/getFileUrl?" + params.Encode(), nil)
            if err != nil { os.Exit(1) }
            req.Header.Set("X-App-Id", appID)
            req.Header.Set("X-User-Auth-Token", cfg.AuthToken)
            response, err := http.DefaultClient.Do(req)
            if err != nil { continue }
            var data struct { URL string `json:"url"`; Sample bool `json:"sample"`; Duration float64 `json:"duration"` }
            err = json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&data)
            response.Body.Close()
            if err == nil && response.StatusCode == 200 && data.Sample && data.URL != "" {
                json.NewEncoder(os.Stdout).Encode(data)
                return
            }
        }
        os.Exit(1)
    }
    fmt.Print(appID)
}
