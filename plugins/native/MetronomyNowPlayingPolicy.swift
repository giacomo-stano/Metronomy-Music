import Foundation

// Pure policy: used by expo-audio and executable in macOS CI without an iPhone.
// Never gate UI playback events, only redundant Now Playing publications.
struct MetronomyNowPlayingPolicy {
  private var previousSignature: NSDictionary?
  private var previousItem: ObjectIdentifier?
  private var previousUptime: Double = 0
  private var previousElapsed: Double = 0
  private var previousRate: Double = 0

  mutating func shouldPublish(signature: [String: Any], item: ObjectIdentifier?,
                             elapsed: Double, rate: Double, uptime: Double,
                             hasNowPlayingInfo: Bool) -> Bool {
    let expected = previousElapsed + max(0, uptime - previousUptime) * previousRate
    if let previousSignature, hasNowPlayingInfo, previousItem == item,
       previousRate == rate, previousSignature.isEqual(to: signature),
       abs(elapsed - expected) < 0.25 {
      return false
    }
    previousSignature = NSDictionary(dictionary: signature)
    previousItem = item
    previousUptime = uptime
    previousElapsed = elapsed
    previousRate = rate
    return true
  }

  mutating func reset() { previousSignature = nil }
}
