import Foundation

@main
struct NowPlayingPolicyTests {
  static func main() {
    var policy = MetronomyNowPlayingPolicy()
    let first = NSObject(), second = NSObject()
    var signature: [String: Any] = ["isrc": "USAT21300493", "duration": 234.5, "title": "Creep in a T-Shirt"]
    let item = ObjectIdentifier(first)
    func publish(_ elapsed: Double, _ rate: Double, _ time: Double,
                 _ currentItem: ObjectIdentifier? = nil, _ present: Bool = true) -> Bool {
      policy.shouldPublish(signature: signature, item: currentItem ?? item,
        elapsed: elapsed, rate: rate, uptime: time, hasNowPlayingInfo: present)
    }
    assert(publish(0, 1, 100), "first publication")
    for tick in 1...168 {
      let elapsed = Double(tick) / 4
      assert(!publish(elapsed, 1, 100 + elapsed), "4 Hz ticks must not republish during steady playback")
    }
    assert(publish(42, 0, 142), "pause/buffering must publish")
    assert(!publish(42, 0, 150), "paused clock does not advance")
    assert(publish(42, 1, 150), "resume must publish")
    assert(publish(120, 1, 151), "forward seek")
    assert(publish(30, 1, 152), "backward seek")
    assert(publish(30, 0.5, 152), "playback-rate change")
    assert(!publish(30.5, 0.5, 153), "rate-aware extrapolation")
    signature["isrc"] = "DEE861902725"
    assert(publish(30.5, 0.5, 153), "ISRC change is never suppressed")
    signature["duration"] = 234.6
    assert(publish(30.5, 0.5, 153), "resolved asset duration")
    signature["artwork"] = "cover"
    assert(publish(30.5, 0.5, 153), "artwork change")
    assert(publish(0, 1, 153, ObjectIdentifier(second)), "new item, even with same recording")
    assert(publish(0, 1, 153, ObjectIdentifier(second), false), "restore cleared Now Playing")
    assert(!publish(0.25, 1, 153.25, ObjectIdentifier(second)), "UI tick remains suppressed")
    assert(publish(0, 1, 154, ObjectIdentifier(second)), "loop/timeline discontinuity")
    policy.reset()
    assert(publish(0, 1, 154), "clear/logout resets the policy")
    print("Native Now Playing policy: steady playback, pause/resume, seek, rate, metadata, item, clear and loop passed.")
  }
}
