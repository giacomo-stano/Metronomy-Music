import ExpoModulesCore
import MediaAccessibility
import MediaPlayer
import UIKit
import AVFoundation

// Apple Music Haptics only. No Core Haptics engine, audio tap or synthetic pulses.
public final class MetronomyMusicHapticsModule: Module {
  private var key = ""
  private var title = ""
  private var artist = ""
  private var isrc = ""
  private var playing = false
  private var callbackReceived = false
  private var callbackCount = 0
  private var callbackCode = ""
  private var callbackAt: Double = 0
  private var activeObserver: NSObjectProtocol?
  private var playbackObserver: (any NSCopying)?

  public func definition() -> ModuleDefinition {
    Name("MetronomyMusicHaptics")
    Events("onStateChanged")

    // Passive observer. expo-audio is the sole writer of Now Playing metadata.
    // Availability and observer registration do not start haptic playback.
    AsyncFunction("beginTrack") { (key: String, title: String, artist: String) -> [String: Any] in
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

      self.restartPlaybackObserver()
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
    var duration: Double = -1
    var elapsed: Double = -1
    var rate: Double = 0
    var isLive = false
    var ownerReady = false
    if #available(iOS 18.0, *) {
      active = MAMusicHapticsManager.shared.isActive
      if let info = MPNowPlayingInfoCenter.default().nowPlayingInfo, matches(info) {
        nowPlayingReady = true
        nativeISRC = info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] as? String ?? ""
        rate = (info[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue ?? 0
        duration = (info[MPMediaItemPropertyPlaybackDuration] as? NSNumber)?.doubleValue ?? -1
        elapsed = (info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? NSNumber)?.doubleValue ?? -1
        isLive = (info[MPNowPlayingInfoPropertyIsLiveStream] as? NSNumber)?.boolValue ?? false
        ownerReady = (info[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String)?.hasPrefix("metronomy:") == true
        audioPlaying = rate.isFinite && rate > 0
      }
    }
    let timelineValid = duration.isFinite && duration > 0 && elapsed.isFinite && elapsed >= 0 && !isLive
    let audio = AVAudioSession.sharedInstance()
    return ["key": key, "supported": supported, "active": active,
            "playing": playing && active && audioPlaying && nativeISRC == isrc && !isrc.isEmpty,
            "nativeIsrc": nativeISRC,
            "nowPlayingReady": nowPlayingReady,
            "audioPlaying": audioPlaying,
            "observerRegistered": playbackObserver != nil,
            "callbackReceived": callbackReceived, "callbackCount": callbackCount,
            "callbackCode": callbackCode, "callbackAt": callbackAt,
            "duration": duration.isFinite ? duration : -1,
            "elapsed": elapsed.isFinite ? elapsed : -1,
            "rate": rate.isFinite ? rate : 0, "isLive": isLive,
            "timelineValid": timelineValid, "ownerReady": ownerReady,
            "plistEnabled": Bundle.main.object(forInfoDictionaryKey: "MusicHapticsSupported") as? Bool ?? false,
            "audioCategory": audio.category.rawValue, "audioMode": audio.mode.rawValue,
            "audioRoute": audio.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ", "),
            "integrationVersion": 2]
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
              self.isrc == expectedISRC else { return }
        self.callbackCode = code.uppercased()
        self.callbackCount += 1
        self.callbackAt = Date().timeIntervalSince1970
        guard code.uppercased() == expectedISRC else {
          if code.isEmpty && !playing { self.playing = false }
          self.sendEvent("onStateChanged", self.snapshot())
          return
        }
        self.callbackReceived = true
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
    playing = false
    callbackReceived = false
    callbackCount = 0
    callbackCode = ""
    callbackAt = 0
  }

  private func clear() {
    key = ""
    isrc = ""
    playing = false
    if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
    activeObserver = nil
    stopPlaybackObserver()
  }
}
