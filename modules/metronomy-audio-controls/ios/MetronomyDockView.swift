import ExpoModulesCore
import UIKit

// The floating dock already clears the home indicator in React Native. Do not
// subtract the window's bottom inset again from the icon/selection layout.
private final class FloatingTabBar: UITabBar {
  override var safeAreaInsets: UIEdgeInsets { .zero }
}

// UI only: audio ownership, queues and navigation remain in MusicApp.
public final class MetronomyDockView: ExpoView, UITabBarDelegate {
  let onCommand = EventDispatcher()
  private let bar = FloatingTabBar()
  private let barHeight: CGFloat = 72
  private let barContainer = UIView()
  private let sectionGlass = UIVisualEffectView()
  private let searchGlass = UIVisualEffectView()
  private let sectionButton = UIButton(type: .system)
  private let searchButton = UIButton(type: .system)
  private let glass = UIVisualEffectView()
  private let open = UIButton(type: .system)
  private let artwork = UIImageView()
  private let titleLabel = UILabel()
  private let artistLabel = UILabel()
  private let play = UIButton(type: .system)
  private let nextButton = UIButton(type: .system)
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
    bar.itemPositioning = .fill
    let symbols = ["house.fill", "square.grid.2x2.fill", "music.note.house.fill", "magnifyingglass"]
    bar.items = names.enumerated().map { index, name in
      UITabBarItem(title: name, image: UIImage(systemName: symbols[index], withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .regular, scale: .medium)), tag: index)
    }
    bar.selectedItem = bar.items?.first
    for surface in [sectionGlass, searchGlass] {
      surface.clipsToBounds = true
      surface.layer.cornerRadius = 24
      addSubview(surface)
    }
    sectionGlass.contentView.addSubview(sectionButton)
    searchGlass.contentView.addSubview(searchButton)
    sectionButton.accessibilityLabel = "Mostra barra di navigazione"
    sectionButton.addTarget(self, action: #selector(expandNavigation), for: .touchUpInside)
    searchButton.setImage(UIImage(systemName: "magnifyingglass", withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .regular)), for: .normal)
    searchButton.accessibilityLabel = "Cerca"
    searchButton.addTarget(self, action: #selector(selectSearch), for: .touchUpInside)
    barContainer.clipsToBounds = false
    barContainer.layer.cornerCurve = .continuous
    addSubview(barContainer)
    barContainer.addSubview(bar)
    addSubview(glass)
    glass.clipsToBounds = true
    glass.layer.cornerCurve = .continuous
    let controls: [UIView] = [open, play, nextButton, spinner]
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
    // The reference has only play/next in the mini-player. Keep its native menu
    // on long press, without adding an extra visible button or losing actions.
    open.showsMenuAsPrimaryAction = false
    open.accessibilityHint = "Tocca per aprire; tieni premuto per le opzioni del brano"
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
    sectionButton.setImage(bar.items?[compactNavigationIndex].image, for: .normal)
    sectionButton.accessibilityValue = names[compactNavigationIndex]
    sectionButton.tintColor = selected == 3 ? .label : .systemPink
    searchButton.tintColor = selected == 3 ? .systemPink : .label
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
    if previous["trackID"] as? String != trackID || previous["playing"] as? Bool != playing || previous["canNext"] as? Bool != nextButton.isEnabled || open.menu == nil {
      updateMenu(playing: playing)
    }
    let targetCompact = value["compact"] as? Bool ?? false
    if targetCompact != compact {
      compact = targetCompact
      animateLayout()
    } else {
      setNeedsLayout()
      if layoutAnimator == nil {
        barContainer.isHidden = shouldCompact
        barContainer.clipsToBounds = shouldCompact
      }
    }
  }

  private func refreshAppearance() {
    overrideUserInterfaceStyle = configuration["dark"] as? Bool == true ? .dark : .light
    bar.tintColor = .systemPink
    titleLabel.textColor = .label
    artistLabel.textColor = .secondaryLabel
    for button in [play, nextButton] { button.tintColor = .label }
    sectionButton.tintColor = selected == 3 ? .label : .systemPink
    searchButton.tintColor = selected == 3 ? .systemPink : .label
    glass.backgroundColor = .clear
    if UIAccessibility.isReduceTransparencyEnabled {
      glass.effect = nil
      glass.backgroundColor = .secondarySystemBackground
      for surface in [sectionGlass, searchGlass] {
        surface.effect = nil
        surface.backgroundColor = .secondarySystemBackground
      }
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
      for surface in [sectionGlass, searchGlass] {
        surface.backgroundColor = .clear
        surface.effect = glass.effect
      }
    }
  }

  // Search already has a dedicated button on the right. Keep the library
  // navigation glyph on the left instead of rendering two magnifying glasses.
  private var compactNavigationIndex: Int { selected == 3 ? 2 : selected }

  private var shouldCompact: Bool {
    compact && hasTrack && !UIAccessibility.isVoiceOverRunning && !UIAccessibility.isReduceMotionEnabled
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
      animateLayout()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width >= 160, bounds.height >= barHeight + 60 else { return }
    let small = shouldCompact
    let barY = bounds.height - barHeight
    let compactInset = (barHeight - 48) / 2
    let circle: CGFloat = 48
    let gap: CGFloat = 8
    let inset: CGFloat = 8
    sectionGlass.bounds = CGRect(x: 0, y: 0, width: circle, height: circle)
    searchGlass.bounds = sectionGlass.bounds
    sectionGlass.center = CGPoint(x: inset + circle / 2, y: barY + barHeight / 2)
    searchGlass.center = CGPoint(x: bounds.width - inset - circle / 2, y: barY + barHeight / 2)
    sectionButton.frame = sectionGlass.bounds
    searchButton.frame = searchGlass.bounds
    sectionGlass.transform = small ? .identity : CGAffineTransform(scaleX: 0.01, y: 0.01)
    searchGlass.transform = small ? .identity : CGAffineTransform(scaleX: 0.01, y: 0.01)
    sectionGlass.isUserInteractionEnabled = small
    searchGlass.isUserInteractionEnabled = small
    sectionGlass.accessibilityElementsHidden = !small
    searchGlass.accessibilityElementsHidden = !small
    barContainer.frame = small ? CGRect(x: inset, y: barY + compactInset, width: circle, height: circle)
      : CGRect(x: 0, y: barY, width: bounds.width, height: barHeight)
    barContainer.layer.cornerRadius = small ? 24 : barHeight / 2
    // Keep UIKit's tab items and native tracking lens; only clip/translate the
    // container during collapse. Never stretch its labels or replace its gestures.
    let selectedCenter = bounds.width * (CGFloat(compactNavigationIndex) + 0.5) / CGFloat(names.count)
    bar.frame = CGRect(x: small ? circle / 2 - selectedCenter : 0, y: small ? -compactInset : 0, width: bounds.width, height: barHeight)
    barContainer.isUserInteractionEnabled = !small
    barContainer.accessibilityElementsHidden = small
    let width = small ? bounds.width - 2 * (inset + circle + gap) : bounds.width - 16
    let height: CGFloat = small ? 48 : 52
    glass.frame = CGRect(x: small ? inset + circle + gap : inset, y: small ? barY + compactInset : barY - gap - height, width: width, height: height)
    glass.layer.cornerRadius = height / 2
    glass.isHidden = !hasTrack
    // All controls keep at least a 44pt touch target, including the compact player.
    let trailing: CGFloat = small ? 44 : 88
    let mainWidth = max(44, width - trailing - 8)
    open.frame = CGRect(x: 0, y: 0, width: mainWidth, height: height)
    let artSize: CGFloat = small ? 30 : 36
    artwork.frame = CGRect(x: 9, y: (height - artSize) / 2, width: artSize, height: artSize)
    let textX = artSize + 17
    let textWidth = max(0, mainWidth - textX - 4)
    titleLabel.frame = CGRect(x: textX, y: (height - 37) / 2, width: textWidth, height: 22)
    artistLabel.frame = CGRect(x: textX, y: (height - 37) / 2 + 21, width: textWidth, height: 16)
    artistLabel.isHidden = false
    play.frame = CGRect(x: mainWidth, y: 0, width: 44, height: height)
    spinner.center = play.center
    nextButton.frame = CGRect(x: mainWidth + 44, y: 0, width: 44, height: height)
    nextButton.isHidden = small
  }

  // The transparent space around the compact player must remain scrollable/tappable.
  public override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    guard !keyboardVisible else { return false }
    let navigation = shouldCompact ? sectionGlass.frame.contains(point) || searchGlass.frame.contains(point) : barContainer.frame.contains(point)
    return navigation || (hasTrack && glass.frame.contains(point))
  }

  private func animateLayout() {
    if let animator = layoutAnimator {
      animator.stopAnimation(false)
      animator.finishAnimation(at: .current)
      layoutAnimator = nil
    }
    barContainer.isHidden = false
    barContainer.clipsToBounds = true
    setNeedsLayout()
    guard window != nil, !UIAccessibility.isReduceMotionEnabled else {
      layoutIfNeeded(); barContainer.isHidden = shouldCompact; barContainer.clipsToBounds = shouldCompact; return
    }
    let animator = UIViewPropertyAnimator(duration: 0.38, dampingRatio: 0.9) { [weak self] in self?.layoutIfNeeded() }
    animator.addCompletion { [weak self] _ in
      guard let self else { return }
      self.barContainer.isHidden = self.shouldCompact
      self.barContainer.clipsToBounds = self.shouldCompact
      self.layoutAnimator = nil
    }
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

  @objc private func expandNavigation() {
    compact = false
    animateLayout()
    onCommand(["action": "expand"])
  }
  @objc private func selectSearch() {
    onCommand(["action": "tab", "index": 3, "reset": selected == 3])
  }

  public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    let reselected = selected == item.tag
    selected = item.tag
    searchButton.tintColor = selected == 3 ? .systemPink : .label
    onCommand(["action": "tab", "index": selected, "reset": reselected])
  }

  private func emit(_ action: String, track: String? = nil) {
    guard hasTrack else { return }
    let anchor = glass.convert(glass.bounds, to: window)
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
    open.menu = UIMenu(children: [
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
