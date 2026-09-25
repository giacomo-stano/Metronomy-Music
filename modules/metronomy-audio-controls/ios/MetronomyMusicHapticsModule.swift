import CoreHaptics
import ExpoModulesCore
import MediaAccessibility
import MediaPlayer

public final class MetronomyMusicHapticsModule: Module {
  private var engine: CHHapticEngine?

  public func definition() -> ModuleDefinition {
    Name("MetronomyMusicHaptics")

    Function("isCoreHapticsSupported") {
      CHHapticEngine.capabilitiesForHardware().supportsHaptics
    }

    Function("isAppleMusicHapticsActive") { () -> Bool in
      if #available(iOS 18.0, *) {
        return MAMusicHapticsManager.shared.isActive
      }

      return false
    }

    AsyncFunction("checkAppleTrackAvailability") { (isrc: String, promise: Promise) in
      let code = isrc.trimmingCharacters(in: .whitespacesAndNewlines)

      guard !code.isEmpty else {
        promise.resolve(false)
        return
      }

      if #available(iOS 18.0, *) {
        MAMusicHapticsManager.shared.checkHapticTrackAvailabilityForMedia(
          matchingCode: code
        ) { available in
          promise.resolve(available)
        }
      } else {
        promise.resolve(false)
      }
    }

    Function("setNowPlayingISRC") { (isrc: String?) in
      guard #available(iOS 18.0, *) else {
        return
      }

      var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]

      let code = isrc?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      if code.isEmpty {
        info.removeValue(
          forKey: MPNowPlayingInfoPropertyInternationalStandardRecordingCode
        )
      } else {
        info[
          MPNowPlayingInfoPropertyInternationalStandardRecordingCode
        ] = code
      }

      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    Function("pulse") { (intensity: Double, sharpness: Double) in
      self.playTransient(
        intensity: Float(max(0.0, min(1.0, intensity))),
        sharpness: Float(max(0.0, min(1.0, sharpness)))
      )
    }

    Function("stop") {
      self.engine?.stop(completionHandler: nil)
      self.engine = nil
    }
  }

  private func ensureEngine() -> CHHapticEngine? {
    guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
      return nil
    }

    if let engine {
      return engine
    }

    do {
      let next = try CHHapticEngine()
      next.isAutoShutdownEnabled = true

      next.resetHandler = { [weak self] in
        guard let self, let engine = self.engine else {
          return
        }

        do {
          try engine.start()
        } catch {
          self.engine = nil
        }
      }

      next.stoppedHandler = { [weak self] reason in
        guard reason != .idleTimeout else {
          return
        }

        self?.engine = nil
      }

      try next.start()
      engine = next
      return next
    } catch {
      engine = nil
      return nil
    }
  }

  private func playTransient(intensity: Float, sharpness: Float) {
    guard let engine = ensureEngine() else {
      return
    }

    let event = CHHapticEvent(
      eventType: .hapticTransient,
      parameters: [
        CHHapticEventParameter(
          parameterID: .hapticIntensity,
          value: intensity
        ),
        CHHapticEventParameter(
          parameterID: .hapticSharpness,
          value: sharpness
        ),
      ],
      relativeTime: 0
    )

    do {
      let pattern = try CHHapticPattern(
        events: [event],
        parameters: []
      )
      let player = try engine.makePlayer(with: pattern)
      try player.start(atTime: CHHapticTimeImmediate)
    } catch {
      // Haptics are optional and must never interrupt audio playback.
    }
  }
}
