import ExpoModulesCore
import MediaAccessibility
import MediaPlayer
import UIKit

// Apple Music Haptics only. No Core Haptics engine, audio tap or synthetic pulses.
public final class MetronomyMusicHapticsModule: Module {
  private var key = ""
  private var title = ""
  private var artist = ""
  private var isrc = ""
  private var playing = false
  private var activeObserver: NSObjectProtocol?
  private var playbackObserver: (any NSCopying)?

  public func definition() -> ModuleDefinition {
    Name("MetronomyMusicHaptics")
    Events("onStateChanged")

    // Serialize all Now Playing read/modify/write operations on the same queue
    // used by expo-audio. Never replace its artwork, duration, rate or position.
    AsyncFunction("beginTrack") { (key: String, title: String, artist: String) -> [String: Any] in
      self.removeOwnedISRC()
      self.key = key
      self.title = title
      self.artist = artist
      self.isrc = ""
      self.playing = false
      self.stopPlaybackObserver()
      self.observeActiveStatus()
      return self.snapshot()
    }.runOnQueue(.main)

    AsyncFunction("setISRC") { (key: String, code: String) -> [String: Any] in
      guard self.key == key,
            code.range(of: "^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$", options: .regularExpression) != nil else {
        return self.snapshot()
      }
      self.isrc = code

      // Publish the ISRC first, then register the Music Haptics playback
      // observer so an initial callback cannot arrive while the media code is empty.
      _ = self.snapshot()
      self.restartPlaybackObserver()

      // expo-audio can finish publishing Now Playing metadata shortly after
      // setActiveForLockScreen(). Re-read and reattach after it settles.
      self.scheduleAttachmentRetry(key: key, code: code, after: 0.35)
      self.scheduleAttachmentRetry(key: key, code: code, after: 0.90)
      return self.snapshot()
    }.runOnQueue(.main)

    AsyncFunction("getState") { () -> [String: Any] in
      self.snapshot()
    }.runOnQueue(.main)

    AsyncFunction("checkAvailability") { (code: String, promise: Promise) in
      if #available(iOS 18.0, *) {
        MAMusicHapticsManager.shared.checkHapticTrackAvailabilityForMedia(matchingCode: code) {
          promise.resolve($0)
        }
      } else {
        promise.resolve(false)
      }
    }.runOnQueue(.main)

    AsyncFunction("clearTrack") { (key: String) in
      // An old async cleanup must not clear a newer song/account.
      guard self.key == key else { return }
      self.clear()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async { self.clear() }
    }
  }

  private var supported: Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    if #available(iOS 18.0, *) { return UIDevice.current.userInterfaceIdiom == .phone }
    return false
    #endif
  }

  private func matches(_ info: [String: Any]) -> Bool {
    !key.isEmpty && info[MPMediaItemPropertyTitle] as? String == title &&
      info[MPMediaItemPropertyArtist] as? String == artist
  }

  private func snapshot() -> [String: Any] {
    var active = false
    var nativeISRC = ""
    var audioPlaying = false
    var nowPlayingReady = false
    if #available(iOS 18.0, *) {
      active = MAMusicHapticsManager.shared.isActive
      if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo, matches(info) {
        nowPlayingReady = true
        if !isrc.isEmpty,
           info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] as? String != isrc {
          info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] = isrc
          MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
        nativeISRC = info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] as? String ?? ""
        audioPlaying = ((info[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue ?? 0) > 0
      }
    }
    return ["key": key, "supported": supported, "active": active,
            "playing": playing && active && audioPlaying && nativeISRC == isrc && !isrc.isEmpty,
            "nativeIsrc": nativeISRC,
            "nowPlayingReady": nowPlayingReady,
            "audioPlaying": audioPlaying,
            "observerRegistered": playbackObserver != nil]
  }

  private func observeActiveStatus() {
    guard #available(iOS 18.0, *), activeObserver == nil else { return }
    activeObserver = NotificationCenter.default.addObserver(
      forName: MAMusicHapticsManager.activeStatusDidChangeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      if !MAMusicHapticsManager.shared.isActive { self.playing = false }
      self.sendEvent("onStateChanged", self.snapshot())
    }
  }

  private func restartPlaybackObserver() {
    guard #available(iOS 18.0, *), !key.isEmpty, !isrc.isEmpty else {
      stopPlaybackObserver()
      return
    }
    stopPlaybackObserver()
    let expectedKey = key
    let expectedISRC = isrc
    playbackObserver = MAMusicHapticsManager.shared.addStatusObserver { [weak self] code, playing in
      DispatchQueue.main.async {
        guard let self,
              self.key == expectedKey,
              self.isrc == expectedISRC,
              code.uppercased() == expectedISRC else { return }
        self.playing = playing
        self.sendEvent("onStateChanged", self.snapshot())
      }
    }
  }

  private func stopPlaybackObserver() {
    if #available(iOS 18.0, *), let playbackObserver {
      MAMusicHapticsManager.shared.removeStatusObserver(playbackObserver)
    }
    playbackObserver = nil
  }

  private func scheduleAttachmentRetry(key: String, code: String, after delay: TimeInterval) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self, self.key == key, self.isrc == code else { return }
      let state = self.snapshot()
      let ready = (state["nowPlayingReady"] as? Bool ?? false) &&
        (state["nativeIsrc"] as? String ?? "") == code
      if ready && !self.playing {
        self.restartPlaybackObserver()
      }
      self.sendEvent("onStateChanged", self.snapshot())
    }
  }

  private func removeOwnedISRC() {
    guard #available(iOS 18.0, *), !isrc.isEmpty,
          var info = MPNowPlayingInfoCenter.default().nowPlayingInfo,
          info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] as? String == isrc else { return }
    info.removeValue(forKey: MPNowPlayingInfoPropertyInternationalStandardRecordingCode)
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func clear() {
    removeOwnedISRC()
    key = ""
    isrc = ""
    playing = false
    if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
    activeObserver = nil
    stopPlaybackObserver()
  }
}
