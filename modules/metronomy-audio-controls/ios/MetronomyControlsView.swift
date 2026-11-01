import ExpoModulesCore
import UIKit

private func controlColor(_ value: Any?, fallback: UIColor = .label) -> UIColor {
  guard let rgba = value as? [Double], rgba.count == 4, rgba.allSatisfy({ $0.isFinite }) else { return fallback }
  return UIColor(red: CGFloat(rgba[0]), green: CGFloat(rgba[1]), blue: CGFloat(rgba[2]), alpha: CGFloat(rgba[3]))
}

public final class MetronomyButtonView: ExpoView {
  let onAction = EventDispatcher()
  private let button = UIButton(type: .system)
  private lazy var hold = UILongPressGestureRecognizer(target: self, action: #selector(longPress(_:)))
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(button)
    button.addTarget(self, action: #selector(pressed), for: .touchUpInside)
    button.addTarget(self, action: #selector(began), for: .touchDown)
    button.addTarget(self, action: #selector(ended), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    button.addGestureRecognizer(hold)
  }
  func configure(_ value: [String: Any]) {
    overrideUserInterfaceStyle = value["dark"] as? Bool == true ? .dark : .light
    var config = UIButton.Configuration.plain()
    if value["glass"] as? Bool == true {
      if #available(iOS 26.0, *) { config = .glass() } else { config = .gray() }
    }
    config.title = value["title"] as? String
    config.image = (value["symbol"] as? String).flatMap { UIImage(systemName: $0) }
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: CGFloat(value["iconSize"] as? Double ?? 22), weight: .medium)
    config.baseForegroundColor = controlColor(value["color"])
    config.imagePadding = 8
    let inset = CGFloat(value["inset"] as? Double ?? 0)
    config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: inset, bottom: 0, trailing: inset)
    config.showsActivityIndicator = value["loading"] as? Bool ?? false
    let size = CGFloat(value["fontSize"] as? Double ?? 17)
    let weight: UIFont.Weight = value["bold"] as? Bool == true ? .semibold : .regular
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var outgoing = incoming
      outgoing.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: size, weight: weight))
      return outgoing
    }
    config.titleLineBreakMode = .byWordWrapping
    button.configuration = config
    button.isEnabled = !(value["disabled"] as? Bool ?? false)
    button.isSelected = value["selected"] as? Bool ?? false
    button.accessibilityLabel = value["label"] as? String
    button.accessibilityHint = value["hint"] as? String
    button.contentHorizontalAlignment = value["alignment"] as? String == "left" ? .leading : .center
    hold.isEnabled = value["longPress"] as? Bool ?? false
    hold.minimumPressDuration = (value["delayLongPress"] as? Double ?? 500) / 1000
  }
  public override func layoutSubviews() { super.layoutSubviews(); button.frame = bounds }
  private func emit(_ action: String) {
    guard button.isEnabled else { return }
    let frame = convert(bounds, to: window)
    onAction(["action": action, "x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height])
  }
  @objc private func pressed() { emit("press") }
  @objc private func began() { emit("begin") }
  @objc private func ended() { emit("end") }
  @objc private func longPress(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began { emit("longPress") }
  }
}

public final class MetronomySliderView: ExpoView {
  let onAction = EventDispatcher()
  private let slider = UISlider()
  private var latest: Float = 0
  private var touchTracking = false
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(slider)
    slider.minimumValue = 0; slider.maximumValue = 1
    slider.addTarget(self, action: #selector(changed), for: .valueChanged)
    slider.addTarget(self, action: #selector(began), for: .touchDown)
    slider.addTarget(self, action: #selector(ended), for: [.touchUpInside, .touchUpOutside])
    slider.addTarget(self, action: #selector(cancelled), for: .touchCancel)
  }
  func configure(_ value: [String: Any]) {
    let number = value["value"] as? Double ?? 0
    latest = Float(number.isFinite ? max(0, min(1, number)) : 0)
    slider.isEnabled = value["enabled"] as? Bool ?? true
    if !slider.isTracking { slider.setValue(latest, animated: false) }
    slider.minimumTrackTintColor = controlColor(value["color"], fallback: .systemPink)
    slider.maximumTrackTintColor = controlColor(value["track"], fallback: .tertiaryLabel)
    slider.accessibilityLabel = value["label"] as? String
  }
  public override func layoutSubviews() { super.layoutSubviews(); slider.frame = bounds }
  private func emit(_ phase: String) {
    if slider.isEnabled { onAction(["phase": phase, "value": Double(slider.value), "tracking": touchTracking]) }
  }
  @objc private func began() { touchTracking = true; emit("begin") }
  @objc private func changed() { emit("change") }
  @objc private func ended() { emit("commit"); touchTracking = false }
  @objc private func cancelled() { slider.setValue(latest, animated: false); emit("cancel"); touchTracking = false }
}

public final class MetronomySegmentsView: ExpoView {
  let onAction = EventDispatcher()
  private let control = UISegmentedControl()
  private var labels: [String] = []
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(control)
    control.addTarget(self, action: #selector(changed), for: .valueChanged)
  }
  func configure(_ value: [String: Any]) {
    let next = value["labels"] as? [String] ?? []
    if next != labels {
      labels = next; control.removeAllSegments()
      for (index, label) in labels.enumerated() { control.insertSegment(withTitle: label, at: index, animated: false) }
    }
    let selected = value["selected"] as? Int ?? 0
    control.selectedSegmentIndex = labels.indices.contains(selected) ? selected : UISegmentedControl.noSegment
    control.isEnabled = !(value["disabled"] as? Bool ?? false)
    control.accessibilityLabel = value["label"] as? String
    overrideUserInterfaceStyle = value["dark"] as? Bool == true ? .dark : .light
  }
  public override func layoutSubviews() { super.layoutSubviews(); control.frame = bounds }
  @objc private func changed() {
    if control.isEnabled { onAction(["index": control.selectedSegmentIndex]) }
  }
}

// UIButton owns menu layout, scrolling, highlighting and dismissal animations.
private final class MusicMenuButton: UIButton {
  var onDismiss: (() -> Void)?
  override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration, animator: UIContextMenuInteractionAnimating?) {
    super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
    if let animator { animator.addCompletion { [weak self] in self?.onDismiss?() } }
    else { onDismiss?() }
  }
}

public final class MetronomyMenuView: ExpoView {
  let onAction = EventDispatcher()
  private let button = MusicMenuButton(type: .system)
  private var configuration: [String: Any] = [:]
  private var presented = false
  private var scheduled = false
  private var closed = false
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(button)
    button.showsMenuAsPrimaryAction = true
    button.accessibilityElementsHidden = true
    button.onDismiss = { [weak self] in
      guard let self, !self.closed else { return }
      self.closed = true; self.onAction(["action": "dismiss"])
    }
  }
  func configure(_ value: [String: Any]) {
    configuration = value
    overrideUserInterfaceStyle = value["dark"] as? Bool == true ? .dark : .light
    let menu = makeMenu()
    button.menu = menu
    if presented { button.contextMenuInteraction?.updateVisibleMenu { _ in menu } }
    setNeedsLayout(); schedulePresentation()
  }
  private func makeMenu() -> UIMenu {
    let entries = configuration["items"] as? [[String: Any]] ?? []
    let busy = configuration["busy"] as? Bool ?? false
    var groups: [UIMenuElement] = [], actions: [UIMenuElement] = []
    var quick = false
    func flush() {
      guard !actions.isEmpty else { return }
      let group = UIMenu(options: .displayInline, children: actions)
      group.preferredElementSize = quick ? .small : .large
      groups.append(group); actions = []
    }
    for entry in entries {
      if entry["kind"] as? String == "separator" { flush(); continue }
      let isQuick = entry["kind"] as? String == "quick"
      if !actions.isEmpty && isQuick != quick { flush() }
      quick = isQuick
      let id = entry["id"] as? String ?? ""
      var attributes: UIMenuElement.Attributes = [.keepsMenuPresented]
      if busy || entry["disabled"] as? Bool == true { attributes.insert(.disabled) }
      if entry["destructive"] as? Bool == true { attributes.insert(.destructive) }
      let action = UIAction(title: entry["label"] as? String ?? "", image: (entry["icon"] as? String).flatMap { UIImage(systemName: $0) }, attributes: attributes, state: entry["selected"] as? Bool == true ? .on : .off) { [weak self] _ in
        self?.onAction(["action": "select", "id": id])
      }
      action.subtitle = entry["subtitle"] as? String
      actions.append(action)
    }
    flush()
    return UIMenu(children: groups)
  }
  public override func layoutSubviews() {
    super.layoutSubviews()
    let anchor = configuration["anchor"] as? [String: Double] ?? [:]
    let point = convert(CGPoint(x: anchor["x"] ?? Double(bounds.maxX - 16), y: anchor["y"] ?? Double(safeAreaInsets.top + 12)), from: window)
    let x = max(8, min(point.x - 44, bounds.width - 52))
    let y = max(safeAreaInsets.top + 4, min(point.y, bounds.height - safeAreaInsets.bottom - 48))
    button.frame = CGRect(x: x, y: y, width: 44, height: 44)
    schedulePresentation()
  }
  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil && presented { closed = true; button.contextMenuInteraction?.dismissMenu() }
    else { schedulePresentation() }
  }
  private func schedulePresentation() {
    guard !presented, !closed, !scheduled, window != nil, bounds.width > 0,
          configuration["ready"] as? Bool == true,
          !(configuration["items"] as? [[String: Any]] ?? []).isEmpty else { return }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.scheduled = false
      guard self.window != nil, !self.closed, !self.presented else { return }
      self.presented = true
      self.button.performPrimaryAction()
    }
  }
}
