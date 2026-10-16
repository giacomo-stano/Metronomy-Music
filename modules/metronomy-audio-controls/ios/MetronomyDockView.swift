import ExpoModulesCore
import UIKit

// UI only: audio ownership, queues and navigation remain in MusicApp.
public final class MetronomyDockView: ExpoView, UITabBarDelegate {
  let onCommand = EventDispatcher()
  private let bar = UITabBar()
  private let glass = UIVisualEffectView()
  private let open = UIButton(type: .system)
  private let artwork = UIImageView()
  private let titleLabel = UILabel()
  private let artistLabel = UILabel()
  private let play = UIButton(type: .system)
  private let nextButton = UIButton(type: .system)
  private let more = UIButton(type: .system)
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let names = ["Home", "Novità", "Libreria", "Cerca"]
  private var configuration: [String: Any] = [:]
  private var selected = 0
  private var trackID = ""
  private var compact = false
  private var hasTrack = false
  private var keyboardVisible = false
  private var artworkURL = ""
  private var artworkTask: URLSessionDataTask?
  private var artworkGeneration = 0
  private var layoutAnimator: UIViewPropertyAnimator?
  // Artwork URLs may contain credentials. Never persist them to a URL cache or log them.
  private lazy var artworkSession: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.timeoutIntervalForRequest = 15
    return URLSession(configuration: config)
  }()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    bar.delegate = self
    let symbols = ["house.fill", "square.grid.2x2.fill", "music.note.house.fill", "magnifyingglass"]
    bar.items = names.enumerated().map { index, name in
      UITabBarItem(title: name, image: UIImage(systemName: symbols[index]), tag: index)
    }
    bar.selectedItem = bar.items?.first
    addSubview(bar)
    addSubview(glass)
    glass.clipsToBounds = true
    glass.layer.cornerCurve = .continuous
    let controls: [UIView] = [open, play, nextButton, more, spinner]
    for view in controls { glass.contentView.addSubview(view) }
    open.addSubview(artwork)
    open.addSubview(titleLabel)
    open.addSubview(artistLabel)
    artwork.contentMode = .scaleAspectFill
    artwork.clipsToBounds = true
    artwork.layer.cornerRadius = 6
    artwork.tintColor = .secondaryLabel
    artwork.image = UIImage(systemName: "music.note")
    updateFonts()
    for label in [titleLabel, artistLabel] {
      label.adjustsFontForContentSizeCategory = true
      label.lineBreakMode = .byTruncatingTail
      label.isUserInteractionEnabled = false
    }
    open.addTarget(self, action: #selector(openPlayer), for: .touchUpInside)
    play.addTarget(self, action: #selector(togglePlayback), for: .touchUpInside)
    nextButton.addTarget(self, action: #selector(nextTrack), for: .touchUpInside)
    more.setImage(UIImage(systemName: "ellipsis"), for: .normal)
    more.accessibilityLabel = "Opzioni del brano in riproduzione"
    more.showsMenuAsPrimaryAction = true
    nextButton.accessibilityLabel = "Brano successivo"
    spinner.isUserInteractionEnabled = false
    NotificationCenter.default.addObserver(self, selector: #selector(accessibilityChanged), name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(accessibilityChanged), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(accessibilityChanged), name: UIAccessibility.voiceOverStatusDidChangeNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardHidden), name: UIResponder.keyboardWillHideNotification, object: nil)
    refreshAppearance()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    artworkTask?.cancel()
    artworkSession.invalidateAndCancel()
    layoutAnimator?.stopAnimation(true)
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { refreshAppearance() }
    else { layoutAnimator?.stopAnimation(true) }
  }

  func configure(_ value: [String: Any]) {
    let previous = configuration
    configuration = value
    selected = max(0, min(3, value["selected"] as? Int ?? 0))
    bar.selectedItem = bar.items?[selected]
    trackID = value["trackID"] as? String ?? ""
    hasTrack = !trackID.isEmpty
    titleLabel.text = value["title"] as? String ?? ""
    artistLabel.text = value["artist"] as? String ?? ""
    open.accessibilityLabel = "Apri player, \(titleLabel.text ?? ""), \(artistLabel.text ?? "")"
    let playing = value["playing"] as? Bool ?? false
    play.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)), for: .normal)
    play.accessibilityLabel = playing ? "Pausa" : "Riproduci"
    nextButton.setImage(UIImage(systemName: "forward.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)), for: .normal)
    nextButton.isEnabled = value["canNext"] as? Bool ?? false
    let buffering = value["buffering"] as? Bool ?? false
    if buffering { spinner.startAnimating() } else { spinner.stopAnimating() }
    play.imageView?.isHidden = buffering
    play.accessibilityValue = buffering ? "Caricamento" : nil
    if previous["dark"] as? Bool != value["dark"] as? Bool { refreshAppearance() }
    updateArtwork(value["artwork"] as? String ?? "")
    // Keep the menu stable during scroll/layout updates; actions retain the original track ID.
    if previous["trackID"] as? String != trackID || previous["playing"] as? Bool != playing || previous["canNext"] as? Bool != nextButton.isEnabled || more.menu == nil {
      updateMenu(playing: playing)
    }
    let targetCompact = value["compact"] as? Bool ?? false
    if targetCompact != compact {
      compact = targetCompact
      animateLayout()
    } else { setNeedsLayout() }
  }

  private func refreshAppearance() {
    overrideUserInterfaceStyle = configuration["dark"] as? Bool == true ? .dark : .light
    bar.tintColor = .systemPink
    titleLabel.textColor = .label
    artistLabel.textColor = .secondaryLabel
    for button in [play, nextButton, more] { button.tintColor = .label }
    glass.backgroundColor = .clear
    if UIAccessibility.isReduceTransparencyEnabled {
      glass.effect = nil
      glass.backgroundColor = .secondarySystemBackground
      let appearance = UITabBarAppearance()
      appearance.configureWithOpaqueBackground()
      bar.standardAppearance = appearance
      bar.scrollEdgeAppearance = appearance
    } else {
      let appearance = UITabBarAppearance()
      appearance.configureWithDefaultBackground()
      bar.standardAppearance = appearance
      bar.scrollEdgeAppearance = appearance
      #if compiler(>=6.2)
      if #available(iOS 26.0, *),
         let type = NSClassFromString("UIGlassEffect") as? NSObject.Type,
         type.responds(to: Selector(("effectWithStyle:"))) {
        let effect = UIGlassEffect(style: .regular)
        effect.isInteractive = true
        glass.effect = effect
      } else {
        glass.effect = UIBlurEffect(style: .systemMaterial)
      }
      #else
      glass.effect = UIBlurEffect(style: .systemMaterial)
      #endif
    }
  }

  private var shouldCompact: Bool {
    compact && !UIAccessibility.isVoiceOverRunning && !UIAccessibility.isReduceMotionEnabled
      && !traitCollection.preferredContentSizeCategory.isAccessibilityCategory
  }

  private func updateFonts() {
    // Bound the dock's typography; the full player exposes the unabridged labels.
    titleLabel.font = UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: .systemFont(ofSize: 15, weight: .semibold), maximumPointSize: 20)
    artistLabel.font = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12), maximumPointSize: 16)
  }

  public override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
      updateFonts()
      setNeedsLayout()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    bar.frame = CGRect(x: 0, y: bounds.height - 64, width: bounds.width, height: 64)
    let small = shouldCompact
    let width = small ? min(bounds.width - 16, 280) : bounds.width - 16
    let height: CGFloat = small ? 48 : 60
    glass.frame = CGRect(x: bounds.width - width - 8, y: bounds.height - 72 - height, width: width, height: height)
    glass.layer.cornerRadius = height / 2
    glass.isHidden = !hasTrack
    // All controls keep at least a 44pt touch target, including the compact player.
    let trailing: CGFloat = small ? 88 : 132
    let mainWidth = max(44, width - trailing - 8)
    open.frame = CGRect(x: 0, y: 0, width: mainWidth, height: height)
    artwork.frame = CGRect(x: 10, y: (height - 36) / 2, width: 36, height: 36)
    let textWidth = max(0, mainWidth - 55)
    titleLabel.frame = CGRect(x: 54, y: small ? (height - 24) / 2 : 10, width: textWidth, height: 24)
    artistLabel.frame = CGRect(x: 54, y: 33, width: textWidth, height: 18)
    artistLabel.isHidden = small
    play.frame = CGRect(x: mainWidth, y: 0, width: 44, height: height)
    spinner.center = play.center
    nextButton.frame = CGRect(x: mainWidth + 44, y: 0, width: 44, height: height)
    nextButton.isHidden = small
    more.frame = CGRect(x: width - 52, y: 0, width: 44, height: height)
  }

  // The transparent space around the compact player must remain scrollable/tappable.
  public override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    guard !keyboardVisible else { return false }
    return bar.frame.contains(point) || (hasTrack && glass.frame.contains(point))
  }

  private func animateLayout() {
    layoutAnimator?.stopAnimation(true)
    setNeedsLayout()
    guard window != nil, !UIAccessibility.isReduceMotionEnabled else { layoutIfNeeded(); return }
    let animator = UIViewPropertyAnimator(duration: 0.32, dampingRatio: 0.88) { [weak self] in self?.layoutIfNeeded() }
    layoutAnimator = animator
    animator.startAnimation()
  }

  @objc private func accessibilityChanged() { refreshAppearance(); animateLayout() }
  @objc private func keyboardChanged(_ notification: Notification) {
    guard let window, let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
    let keyboardFrame = window.convert(frame, from: nil)
    keyboardVisible = convert(bounds, to: window).intersects(keyboardFrame)
    isHidden = keyboardVisible
  }
  @objc private func keyboardHidden() { keyboardVisible = false; isHidden = false }

  public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    let reselected = selected == item.tag
    selected = item.tag
    onCommand(["action": "tab", "index": selected, "reset": reselected])
  }

  private func emit(_ action: String, track: String? = nil) {
    guard hasTrack else { return }
    let anchor = more.convert(more.bounds, to: window)
    onCommand(["action": action, "trackID": track ?? trackID,
               "x": anchor.minX, "y": anchor.minY, "width": anchor.width, "height": anchor.height])
  }
  @objc private func openPlayer() { emit("open") }
  @objc private func togglePlayback() { emit("toggle") }
  @objc private func nextTrack() { if nextButton.isEnabled { emit("next") } }

  private func updateMenu(playing: Bool) {
    let track = trackID
    func action(_ title: String, _ symbol: String, _ command: String, disabled: Bool = false) -> UIAction {
      UIAction(title: title, image: UIImage(systemName: symbol), attributes: disabled ? [.disabled] : []) { [weak self] _ in
        self?.emit(command, track: track)
      }
    }
    more.menu = UIMenu(children: [
      action(playing ? "Pausa" : "Riproduci", playing ? "pause.fill" : "play.fill", "toggle"),
      action("Brano successivo", "forward.fill", "next", disabled: !nextButton.isEnabled),
      UIMenu(options: .displayInline, children: [
        action("Apri riproduzione", "music.note", "open"),
        action("Altre opzioni del brano…", "ellipsis.circle", "options")
      ])
    ])
  }

  private func updateArtwork(_ value: String) {
    guard value != artworkURL else { return }
    artworkURL = value
    artworkGeneration += 1
    let generation = artworkGeneration
    artworkTask?.cancel()
    artwork.image = UIImage(systemName: "music.note")
    guard let url = URL(string: value), ["https", "http", "file"].contains(url.scheme?.lowercased() ?? "") else { return }
    if url.isFileURL {
      DispatchQueue.global(qos: .utility).async { [weak self] in
        let image = UIImage(contentsOfFile: url.path)
        DispatchQueue.main.async { [weak self] in
          guard let self, self.artworkGeneration == generation else { return }
          self.artwork.image = image ?? UIImage(systemName: "music.note")
        }
      }
      return
    }
    artworkTask = artworkSession.dataTask(with: url) { [weak self] data, response, _ in
      guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), let data, data.count <= 12_000_000,
            let image = UIImage(data: data) else { return }
      DispatchQueue.main.async { [weak self] in
        guard let self, self.artworkGeneration == generation else { return }
        self.artwork.image = image
      }
    }
    artworkTask?.resume()
  }
}
