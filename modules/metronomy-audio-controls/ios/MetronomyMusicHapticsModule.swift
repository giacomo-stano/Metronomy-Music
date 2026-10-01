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
  private var callbackCount = 0
  private var callbackCode = ""
  private var callbackOwner = ""
  private var callbackAt: Double = 0
  private var activeObserver: NSObjectProtocol?
  private var playbackObserver: (any NSCopying)?
  private var publicationObserver: NSObjectProtocol?
  private var publicationUptime: Double = 0
  private var publicationOwner = ""
  private var publicationCount = 0
  private var activeChangeCount = 0
  private var observerGeneration = 0
  private var observerRegistrations = 0

  public func definition() -> ModuleDefinition {
    Name("MetronomyMusicHaptics")
    Events("onStateChanged")

    AsyncFunction("prepareObserver") {
      // Called before replace/Now Playing/play; never wait for catalog lookup.
      self.playing = false
      self.callbackCode = ""
      self.callbackOwner = ""
      self.callbackAt = 0
      self.ensureObservers()
    }.runOnQueue(.main)

    // Passive observer. expo-audio is the sole writer of Now Playing metadata.
    // Availability and observer registration do not start haptic playback.
    AsyncFunction("beginTrack") { (key: String, title: String, artist: String) -> [String: Any] in
      self.key = key
      self.title = title
      self.artist = artist
      self.isrc = ""
      // Keep a callback delivered between audio start and the React effect.
      // The owner + ISRC comparison in snapshot rejects unrelated recordings.
      self.ensureObservers()
      return self.snapshot()
    }.runOnQueue(.main)

    AsyncFunction("setISRC") { (key: String, code: String) -> [String: Any] in
      guard self.key == key,
            code.range(of: "^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$", options: .regularExpression) != nil else {
        return self.snapshot()
      }
      self.isrc = code

      self.ensureObservers()
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
      DispatchQueue.main.async {
        self.clear()
        self.stopPlaybackObserver()
        if let observer = self.activeObserver { NotificationCenter.default.removeObserver(observer) }
        if let observer = self.publicationObserver { NotificationCenter.default.removeObserver(observer) }
        self.activeObserver = nil
        self.publicationObserver = nil
      }
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
    var owner = ""
    var elapsedAnchor: Double = -1
    if #available(iOS 18.0, *) {
      active = MAMusicHapticsManager.shared.isActive
      if let info = MPNowPlayingInfoCenter.default().nowPlayingInfo, matches(info) {
        nowPlayingReady = true
        nativeISRC = info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] as? String ?? ""
        rate = (info[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue ?? 0
        duration = (info[MPMediaItemPropertyPlaybackDuration] as? NSNumber)?.doubleValue ?? -1
        elapsed = (info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? NSNumber)?.doubleValue ?? -1
        elapsedAnchor = elapsed
        isLive = (info[MPNowPlayingInfoPropertyIsLiveStream] as? NSNumber)?.boolValue ?? false
        owner = info[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String ?? ""
        ownerReady = owner.hasPrefix("metronomy:")
        // Now Playing retains an anchor, not a clock updated four times/second.
        // Match iOS extrapolation for diagnostics without writing the dictionary.
        if owner == publicationOwner, publicationUptime > 0, elapsed >= 0, rate > 0 {
          elapsed += max(0, ProcessInfo.processInfo.systemUptime - publicationUptime) * rate
          if duration.isFinite && duration > 0 { elapsed = min(elapsed, duration) }
        }
        audioPlaying = rate.isFinite && rate > 0
      }
    }
    let timelineValid = duration.isFinite && duration > 0 && elapsed.isFinite && elapsed >= 0 && !isLive
    let audio = AVAudioSession.sharedInstance()
    let callbackReceived = !isrc.isEmpty && callbackCode == isrc && !owner.isEmpty && callbackOwner == owner
    return ["key": key, "supported": supported, "active": active,
            "playing": playing && callbackReceived && active && audioPlaying && nativeISRC == isrc,
            "nativeIsrc": nativeISRC,
            "nowPlayingReady": nowPlayingReady,
            "audioPlaying": audioPlaying,
            "observerRegistered": playbackObserver != nil,
            "callbackReceived": callbackReceived, "callbackCount": callbackCount,
            "callbackCode": callbackCode, "callbackAt": callbackAt,
            "duration": duration.isFinite ? duration : -1,
            "elapsed": elapsed.isFinite ? elapsed : -1,
            "elapsedAnchor": elapsedAnchor.isFinite ? elapsedAnchor : -1,
            "rate": rate.isFinite ? rate : 0, "isLive": isLive,
            "timelineValid": timelineValid, "ownerReady": ownerReady,
            "plistEnabled": Bundle.main.object(forInfoDictionaryKey: "MusicHapticsSupported") as? Bool ?? false,
            "audioCategory": audio.category.rawValue, "audioMode": audio.mode.rawValue,
            "audioRoute": audio.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ", "),
            "publicationCount": publicationCount, "activeChangeCount": activeChangeCount,
            "observerRegistrations": observerRegistrations,
            "integrationVersion": 3]
  }

  private func ensureObservers() {
    observeActiveStatus()
    ensurePlaybackObserver()
    if publicationObserver == nil {
      publicationObserver = NotificationCenter.default.addObserver(
        forName: Notification.Name("MetronomyNowPlayingPublished"), object: nil, queue: .main
      ) { [weak self] notification in
        guard let self, let id = notification.userInfo?["trackId"] as? String,
              let uptime = notification.userInfo?["uptime"] as? Double else { return }
        self.publicationOwner = "metronomy:" + id
        self.publicationUptime = uptime
        self.publicationCount += 1
      }
    }
  }

  private func observeActiveStatus() {
    guard #available(iOS 18.0, *), activeObserver == nil else { return }
    activeObserver = NotificationCenter.default.addObserver(
      forName: MAMusicHapticsManager.activeStatusDidChangeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.activeChangeCount += 1
      if !MAMusicHapticsManager.shared.isActive { self.playing = false }
      self.sendEvent("onStateChanged", self.snapshot())
    }
  }

  private func ensurePlaybackObserver() {
    guard #available(iOS 18.0, *), playbackObserver == nil else { return }
    observerGeneration += 1
    let generation = observerGeneration
    playbackObserver = MAMusicHapticsManager.shared.addStatusObserver { [weak self] code, playing in
      DispatchQueue.main.async {
        guard let self, self.observerGeneration == generation else { return }
        self.callbackCode = code.uppercased()
        self.callbackCount += 1
        self.callbackAt = Date().timeIntervalSince1970
        let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        let mediaCode = info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] as? String ?? ""
        self.callbackOwner = mediaCode == self.callbackCode
          ? (info[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String ?? "") : ""
        self.playing = playing
        self.sendEvent("onStateChanged", self.snapshot())
      }
    }
    if playbackObserver != nil { observerRegistrations += 1 }
  }

  private func stopPlaybackObserver() {
    observerGeneration += 1
    if #available(iOS 18.0, *), let playbackObserver {
      MAMusicHapticsManager.shared.removeStatusObserver(playbackObserver)
    }
    playbackObserver = nil
    playing = false
    callbackCode = ""
    callbackOwner = ""
    callbackAt = 0
  }

  private func clear() {
    key = ""
    isrc = ""
    playing = false
    callbackCode = ""
    callbackOwner = ""
    // Keep one observer alive until module destruction, including track changes
    // and retries. A status subscription is not a per-track playback command.
  }
}
