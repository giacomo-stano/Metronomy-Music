import ExpoModulesCore
import AVFoundation
import MediaPlayer
import MediaAccessibility
import UIKit

// An opt-in, foreground-only A/B probe. No synthesis and no diagnostic uploads.
public final class MetronomyHapticsDiagnosticModule: Module {
  private var controller: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("MetronomyHapticsDiagnostic")
    AsyncFunction("cancel") {
      if #available(iOS 18.0, *) { (self.controller as? HapticsDiagnosticController)?.closeTest() }
    }.runOnQueue(.main)
    AsyncFunction("run") { (uri: String, code: String, title: String, artist: String, duration: Double, promise: Promise) in
      guard #available(iOS 18.0, *), self.controller == nil,
            let presenter = self.appContext?.utilities?.currentViewController(),
            presenter.view.window != nil, !presenter.isBeingDismissed, !(presenter is UIAlertController),
            let url = URL(string: uri), ["http", "https", "file"].contains(url.scheme ?? ""),
            code.range(of: "^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$", options: .regularExpression) != nil else {
        promise.reject("ERR_DIAGNOSTIC", "Test non disponibile: verifica il brano, l’ISRC e la build nativa.")
        return
      }
      let test = HapticsDiagnosticController(url: url, code: code, title: title, artist: artist,
        duration: duration) { [weak self] report in
          self?.controller = nil
          promise.resolve(report)
        }
      self.controller = test
      test.modalPresentationStyle = .fullScreen
      test.isModalInPresentation = true
      presenter.present(test, animated: true)
    }.runOnQueue(.main)
    OnDestroy {
      DispatchQueue.main.async {
        if #available(iOS 18.0, *) { (self.controller as? HapticsDiagnosticController)?.closeTest() }
      }
    }
  }
}

@available(iOS 18.0, *)
private final class HapticsDiagnosticController: UIViewController {
  private let url: URL
  private let code: String
  private let trackTitle: String
  private let artist: String
  private let catalogDuration: Double
  private let completion: (String) -> Void
  private let owner = "metronomy:diagnostic:" + UUID().uuidString
  private var player: AVPlayer?
  private var observer: (any NSCopying)?
  private var observerRegistered = false
  private var remoteTargets: [(MPRemoteCommand, Any)] = []
  private var tokens: [NSObjectProtocol] = []
  private var timer: Timer?
  private var finished = false
  private var closed = false
  private var started = false
  private var startTime: TimeInterval = 0
  private var lastRate: Float = -1
  private var lastDuration: Double = -1
  private var callbacks = 0
  private var matchingCallbacks = 0
  private var confirmed = false
  private var hapticsPlaying = false
  private var available = "in verifica"
  private var phase = "Preparazione"
  private var errorCode = "nessuno"
  private var position: Double = 0
  private var publications = 0
  private var observedAudio = false
  private var itemState = "non caricato"
  private var audioState = "fermo"
  private let output = UITextView()

  init(url: URL, code: String, title: String, artist: String, duration: Double,
       completion: @escaping (String) -> Void) {
    self.url = url; self.code = code; self.trackTitle = title; self.artist = artist
    self.catalogDuration = duration.isFinite && duration > 0 ? duration : 0
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    output.isEditable = false
    output.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
    let copy = UIButton(type: .system)
    copy.setTitle("Copia report senza URL e credenziali", for: .normal)
    copy.addTarget(self, action: #selector(copyReport), for: .touchUpInside)
    let close = UIButton(type: .system)
    close.setTitle("Termina test e torna al player", for: .normal)
    close.addTarget(self, action: #selector(closeTest), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [output, copy, close])
    stack.axis = .vertical; stack.spacing = 12; stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      copy.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
    ])
    render()
    tokens.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
      object: nil, queue: .main) { [weak self] _ in self?.finish("Interrotto: app in background") })
    tokens.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
      object: nil, queue: .main) { [weak self] notification in
        if (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
          self?.finish("Interrotto dalla sessione audio")
        }
      })
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    // Let Expo's asynchronous pause/deactivation settle before acquiring audio.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      guard let self, !self.finished, !self.closed, UIApplication.shared.applicationState == .active else { return }
      self.begin()
    }
  }

  private func begin() {
    do {
      let audio = AVAudioSession.sharedInstance()
      try audio.setCategory(.playback, mode: .default, options: [])
      try audio.setActive(true)
    } catch {
      errorCode = "AVAudioSession: " + String((error as NSError).code)
      finish("Errore sessione audio"); return
    }
    observer = MAMusicHapticsManager.shared.addStatusObserver { [weak self] code, playing in
      DispatchQueue.main.async {
        guard let self, !self.finished else { return }
        self.callbacks += 1
        if code.uppercased() == self.code {
          self.matchingCallbacks += 1
          let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
          let ownsMetadata = info[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String == self.owner
          // A late callback for the normal player's same ISRC is not proof.
          let valid = ownsMetadata && self.player?.timeControlStatus == .playing
          self.hapticsPlaying = playing && valid
          self.confirmed = self.confirmed || self.hapticsPlaying
        }
        self.render()
      }
    }
    observerRegistered = observer != nil
    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.isEnabled = true
    commands.pauseCommand.isEnabled = true
    remoteTargets = [
      (commands.playCommand, commands.playCommand.addTarget { [weak self] _ in
        DispatchQueue.main.async { if self?.finished == false { self?.player?.play() } }
        return .success
      }),
      (commands.pauseCommand, commands.pauseCommand.addTarget { [weak self] _ in
        DispatchQueue.main.async { self?.finish("Terminato dal controllo pausa") }
        return .success
      })
    ]
    MAMusicHapticsManager.shared.checkHapticTrackAvailabilityForMedia(matchingCode: code) { [weak self] value in
      DispatchQueue.main.async {
        guard let self, !self.finished else { return }
        self.available = value ? "sì" : "no"; self.render()
      }
    }
    let item = AVPlayerItem(url: url)
    player = AVPlayer(playerItem: item)
    tokens.append(NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime,
      object: item, queue: .main) { [weak self] _ in self?.finish("Brano terminato") })
    phase = "Test in corso (massimo 60 secondi)"
    startTime = ProcessInfo.processInfo.systemUptime
    publish(rate: 0, duration: catalogDuration)
    player?.play()
    timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
    tick()
  }

  private func tick() {
    guard !finished, let player else { return }
    let seconds = player.currentTime().seconds
    position = seconds.isFinite ? seconds : 0
    itemState = player.currentItem?.status == .readyToPlay ? "pronto" : "in caricamento"
    if player.currentItem?.status == .failed {
      errorCode = "AVPlayerItem: " + String((player.currentItem?.error as NSError?)?.code ?? 0)
      finish("Errore caricamento audio"); return
    }
    let playing = player.timeControlStatus == .playing
    observedAudio = observedAudio || playing
    audioState = playing ? "in riproduzione" : (player.timeControlStatus == .waitingToPlayAtSpecifiedRate ? "buffering" : "in pausa")
    let rate: Float = playing ? player.rate : 0
    let secondsDuration = player.currentItem?.duration.seconds ?? 0
    let duration = secondsDuration.isFinite && secondsDuration > 0 ? secondsDuration : catalogDuration
    if rate != lastRate || duration != lastDuration { publish(rate: rate, duration: duration) }
    if ProcessInfo.processInfo.systemUptime - startTime >= 60 { finish("Test completato"); return }
    render()
  }

  private func publish(rate: Float, duration: Double) {
    lastRate = rate; lastDuration = duration; publications += 1
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: trackTitle, MPMediaItemPropertyArtist: artist,
      MPNowPlayingInfoPropertyExternalContentIdentifier: owner,
      MPNowPlayingInfoPropertyInternationalStandardRecordingCode: code,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      MPNowPlayingInfoPropertyIsLiveStream: false,
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: rate
    ]
  }

  private func report() -> String {
    let audio = AVAudioSession.sharedInstance()
    return """
    TEST NATIVO MUSIC HAPTICS · 1
    \(phase)
    Player: AVPlayer diretto, senza Expo
    Sorgente: \(url.isFileURL ? "file locale" : "stesso stream del player")
    ISRC: \(code)
    iOS: \(UIDevice.current.systemVersion)
    Attivo in iOS: \(MAMusicHapticsManager.shared.isActive)
    MusicHapticsSupported: \(Bundle.main.object(forInfoDictionaryKey: "MusicHapticsSupported") as? Bool ?? false)
    Traccia aptica disponibile: \(available)
    Observer registrato nel test: \(observerRegistered)
    Stato file: \(itemState)
    Stato audio osservato: \(audioState)
    Audio partito durante il test: \(observedAudio)
    Posizione: \(String(format: "%.1f", position)) s
    Durata: \(String(format: "%.1f", max(0, lastDuration))) s
    Pubblicazioni: \(publications)
    Callback totali: \(callbacks)
    Callback per questo ISRC: \(matchingCallbacks)
    Aptica attiva all’ultimo callback: \(hapticsPlaying)
    Conferma positiva ricevuta nel test: \(confirmed)
    Errore (solo codice): \(errorCode)
    Sessione: \(audio.category.rawValue) / \(audio.mode.rawValue)
    Uscita: \(audio.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ", "))

    Resta in questa schermata. Il test si ferma in background.
    Nessun log di sistema, URL, titolo, account o token incluso nel report. Non invia dati diagnostici.
    Disponibilità e icona non dimostrano una vibrazione: annota anche se la senti fisicamente.
    """
  }
  private func render() { output.text = report() }
  @objc private func copyReport() { UIPasteboard.general.string = report() }

  private func finish(_ reason: String) {
    guard !finished else { return }
    finished = true; phase = reason
    timer?.invalidate(); timer = nil
    player?.pause(); player = nil
    if let observer { MAMusicHapticsManager.shared.removeStatusObserver(observer) }
    observer = nil
    remoteTargets.forEach { command, target in command.removeTarget(target); command.isEnabled = false }
    remoteTargets.removeAll()
    tokens.forEach { NotificationCenter.default.removeObserver($0) }; tokens.removeAll()
    if MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String == owner {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
    // Do not deactivate the shared session: the normal player still owns it.
    render()
  }
  @objc func closeTest() {
    guard !closed else { return }
    closed = true
    finish("Terminato dall’utente")
    let result = report()
    dismiss(animated: true) { self.completion(result) }
  }
}
