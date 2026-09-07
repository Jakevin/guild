import ApplicationServices
import Cocoa
import Foundation
import ScreenCaptureKit

/// Guild's macOS computer-use helper.
///
/// Commands:
///   windows [query]
///   shot <windowId> <path>
///   see <windowId> <path>     shot + AX dump
///   idle
///   open <name-or-path> [--cdp PORT]
///   ax <windowId>
///   axset <windowId> <eN> <text>
///   click <windowId> <x> <y> [--focus]
///   type <windowId> <text> [--focus]
///   hud [ms]
///
/// Default writes post events to the target pid (no focus steal).
/// --focus borrows the front app, flashes a capture-invisible HUD, then restores.
/// Writes refuse with exit 2 when the window is off the current Space or the
/// user is still using the keyboard/mouse.

private let idleNeed: TimeInterval = 2
private let idleWait: TimeInterval = 15
private let axCap = 80
private let axDepth = 8

private func die(_ message: String, _ code: Int32) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(code)
}

private func onMain(_ block: () -> Void) {
  if Thread.isMainThread {
    block()
  } else {
    DispatchQueue.main.sync(execute: block)
  }
}

private struct Win {
  let id: CGWindowID
  let pid: pid_t
  let owner: String
  let title: String
  let x: Double
  let y: Double
  let w: Double
  let h: Double
  let onscreen: Bool
}

private func windowList(_ onscreenOnly: Bool) -> [Win] {
  var opts = CGWindowListOption.excludeDesktopElements
  if onscreenOnly { opts.insert(.optionOnScreenOnly) }
  else { opts.insert(.optionAll) }
  guard let raw = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    return []
  }
  var out: [Win] = []
  for row in raw {
    let layer = row[kCGWindowLayer as String] as? Int ?? 0
    if layer != 0 { continue }
    let bounds = row[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let w = (bounds["Width"] as? NSNumber)?.doubleValue ?? 0
    let h = (bounds["Height"] as? NSNumber)?.doubleValue ?? 0
    if w < 40 || h < 40 { continue }
    let owner = row[kCGWindowOwnerName as String] as? String ?? ""
    if owner.isEmpty || owner == "Window Server" { continue }
    let id = CGWindowID((row[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0)
    let pid = pid_t((row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0)
    let title = row[kCGWindowName as String] as? String ?? ""
    let x = (bounds["X"] as? NSNumber)?.doubleValue ?? 0
    let y = (bounds["Y"] as? NSNumber)?.doubleValue ?? 0
    let on = (row[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false
    out.append(Win(id: id, pid: pid, owner: owner, title: title, x: x, y: y, w: w, h: h, onscreen: on))
  }
  return out
}

private func findWin(_ token: String) -> Win? {
  let all = windowList(false)
  if let id = UInt32(token) {
    return all.first { $0.id == CGWindowID(id) }
  }
  let needle = token.lowercased()
  return all.first {
    $0.owner.lowercased().contains(needle) || $0.title.lowercased().contains(needle)
  }
}

private func fmt(_ w: Win) -> String {
  let on = w.onscreen ? "on" : "off"
  let title = w.title.replacingOccurrences(of: "\n", with: " ")
  return "id=\(w.id) pid=\(w.pid) owner=\(w.owner) on=\(on) \(Int(w.w))x\(Int(w.h)) +\(Int(w.x)),\(Int(w.y)) title=\(title)"
}

private func primaryDisplayHeight() -> CGFloat {
  if let screen = NSScreen.screens.first { return screen.frame.height }
  return CGDisplayBounds(CGMainDisplayID()).height
}

private func eventPoint(win: Win, localX: Double, localY: Double) -> CGPoint {
  let globalX = win.x + localX
  let globalYFromTop = win.y + localY
  let y = Double(primaryDisplayHeight()) - globalYFromTop
  return CGPoint(x: globalX, y: y)
}

private func userIdleSeconds() -> TimeInterval {
  let mouse = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .mouseMoved)
  let down = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .leftMouseDown)
  let key = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
  return min(mouse, min(down, key))
}

private func waitUntilIdle() {
  let start = Date()
  while userIdleSeconds() < idleNeed {
    if Date().timeIntervalSince(start) > idleWait {
      die("refused: user-present", 2)
    }
    Thread.sleep(forTimeInterval: 0.2)
  }
}

private func gateWrite(_ w: Win) {
  if !AXIsProcessTrusted() { die("refused: accessibility", 2) }
  if !w.onscreen { die("refused: off-space", 2) }
  waitUntilIdle()
}

@discardableResult
private func activate(pid: pid_t) -> NSRunningApplication? {
  let app = NSRunningApplication(processIdentifier: pid)
  app?.activate()
  return app
}

private func isFrontmost(_ pid: pid_t) -> Bool {
  NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
}

private func postClick(pid: pid_t, at point: CGPoint) {
  let src = CGEventSource(stateID: .hidSystemState)
  let down = CGEvent(
    mouseEventSource: src,
    mouseType: .leftMouseDown,
    mouseCursorPosition: point,
    mouseButton: .left,
  )
  let up = CGEvent(
    mouseEventSource: src,
    mouseType: .leftMouseUp,
    mouseCursorPosition: point,
    mouseButton: .left,
  )
  down?.postToPid(pid)
  up?.postToPid(pid)
}

private func utf16Chunks(_ text: String, size: Int = 20) -> [ArraySlice<UInt16>] {
  let units = Array(text.utf16)
  var out: [ArraySlice<UInt16>] = []
  var i = 0
  while i < units.count {
    var end = min(i + size, units.count)
    if end < units.count && (0xD800...0xDBFF).contains(units[end - 1]) {
      end -= 1
    }
    if end <= i { end = min(i + 1, units.count) }
    out.append(units[i..<end])
    i = end
  }
  return out
}

private func postUtf16(_ units: ArraySlice<UInt16>, pid: pid_t?, global: Bool) {
  let src = CGEventSource(stateID: .hidSystemState)
  var copy = Array(units)
  let count = copy.count
  copy.withUnsafeMutableBufferPointer { buf in
    guard let base = buf.baseAddress else { return }
    let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
    down?.keyboardSetUnicodeString(stringLength: count, unicodeString: base)
    if global { down?.post(tap: .cghidEventTap) } else if let pid { down?.postToPid(pid) }
    let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
    if global { up?.post(tap: .cghidEventTap) } else if let pid { up?.postToPid(pid) }
  }
}

private func postType(pid: pid_t, _ text: String) -> Int {
  var n = 0
  for chunk in utf16Chunks(text) {
    postUtf16(chunk, pid: pid, global: false)
    n += chunk.count
  }
  return n
}

private func globalClick(at point: CGPoint) {
  let src = CGEventSource(stateID: .hidSystemState)
  let down = CGEvent(
    mouseEventSource: src,
    mouseType: .leftMouseDown,
    mouseCursorPosition: point,
    mouseButton: .left,
  )
  let up = CGEvent(
    mouseEventSource: src,
    mouseType: .leftMouseUp,
    mouseCursorPosition: point,
    mouseButton: .left,
  )
  down?.post(tap: .cghidEventTap)
  up?.post(tap: .cghidEventTap)
}

private func globalType(_ text: String) -> Int {
  var n = 0
  for chunk in utf16Chunks(text) {
    postUtf16(chunk, pid: nil, global: true)
    n += chunk.count
  }
  return n
}

private final class HudView: NSView {
  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    ctx.setStrokeColor(CGColor(gray: 0.92, alpha: 0.95))
    ctx.setLineWidth(3)
    let inset: CGFloat = 18
    let arm: CGFloat = 36
    let r = bounds.insetBy(dx: inset, dy: inset)
    let corners: [(CGPoint, CGPoint, CGPoint)] = [
      (CGPoint(x: r.minX, y: r.maxY - arm), CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.minX + arm, y: r.maxY)),
      (CGPoint(x: r.maxX - arm, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY - arm)),
      (CGPoint(x: r.minX, y: r.minY + arm), CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.minX + arm, y: r.minY)),
      (CGPoint(x: r.maxX - arm, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.minY + arm)),
    ]
    for (a, b, c) in corners {
      ctx.beginPath()
      ctx.move(to: a)
      ctx.addLine(to: b)
      ctx.addLine(to: c)
      ctx.strokePath()
    }
  }
}

private func flashHUD(ms: Int) {
  onMain {
    let frame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 800, height: 600)
    let win = NSWindow(
      contentRect: frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false,
    )
    win.isOpaque = false
    win.backgroundColor = .clear
    win.hasShadow = false
    win.level = .statusBar
    win.ignoresMouseEvents = true
    win.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    win.sharingType = .none
    win.contentView = HudView(frame: NSRect(origin: .zero, size: frame.size))
    win.orderFrontRegardless()
    RunLoop.current.run(until: Date().addingTimeInterval(max(Double(ms), 80) / 1000))
    win.orderOut(nil)
  }
}

@discardableResult
private func borrowFocus(pid: pid_t, work: () -> Void) -> TimeInterval {
  flashHUD(ms: 280)
  let prev = NSWorkspace.shared.frontmostApplication
  let started = Date()
  activate(pid: pid)
  Thread.sleep(forTimeInterval: 0.15)
  if !isFrontmost(pid) {
    die("refused: focus", 2)
  }
  work()
  prev?.activate()
  return Date().timeIntervalSince(started)
}

private func shot(_ w: Win, path: String) {
  let box = DispatchGroup()
  box.enter()
  var image: CGImage?
  var fail = ""
  Task {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: false,
      )
      guard let scWindow = content.windows.first(where: { $0.windowID == w.id }) else {
        throw NSError(
          domain: "guildmac",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "capture window not found"],
        )
      }
      let filter = SCContentFilter(desktopIndependentWindow: scWindow)
      let cfg = SCStreamConfiguration()
      cfg.showsCursor = false
      cfg.width = max(Int(w.w), 1)
      cfg.height = max(Int(w.h), 1)
      image = try await SCScreenshotManager.captureImage(
        contentFilter: filter,
        configuration: cfg,
      )
    } catch {
      fail = error.localizedDescription
    }
    box.leave()
  }
  _ = box.wait(timeout: .now() + 12)
  guard let image else { die(fail.isEmpty ? "shot failed" : fail, 1) }
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    die("shot encode failed", 1)
  }
  do {
    try data.write(to: URL(fileURLWithPath: path))
  } catch {
    die("shot write failed", 1)
  }
  print("shot \(Int(w.w))x\(Int(w.h)) \(path)")
}

private func axString(_ el: AXUIElement, _ attr: String) -> String {
  var raw: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(el, attr as CFString, &raw)
  guard err == .success, let raw else { return "" }
  if let s = raw as? String { return s.replacingOccurrences(of: "\n", with: " ") }
  if let n = raw as? NSNumber { return n.stringValue }
  return ""
}

private func axBool(_ el: AXUIElement, _ attr: String) -> Bool {
  var raw: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(el, attr as CFString, &raw)
  guard err == .success, let n = raw as? NSNumber else { return false }
  return n.boolValue
}

private func axPoint(_ el: AXUIElement, originX: Double, originY: Double) -> String {
  var raw: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &raw)
  guard err == .success, let value = raw else { return "" }
  var p = CGPoint.zero
  if AXValueGetValue(value as! AXValue, .cgPoint, &p) {
    return "\(Int(p.x - originX)),\(Int(p.y - originY))"
  }
  return ""
}

private func axSize(_ el: AXUIElement) -> String {
  var raw: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &raw)
  guard err == .success, let value = raw else { return "" }
  var s = CGSize.zero
  if AXValueGetValue(value as! AXValue, .cgSize, &s) {
    return "\(Int(s.width))x\(Int(s.height))"
  }
  return ""
}

private func axChildren(_ el: AXUIElement) -> [AXUIElement] {
  var raw: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &raw)
  guard err == .success, let arr = raw as? [AXUIElement] else { return [] }
  return arr
}

private struct AxRow {
  let el: AXUIElement
  let line: String
}

private func collectAx(_ w: Win) -> [AxRow] {
  if !AXIsProcessTrusted() {
    die("refused: accessibility", 2)
  }
  let app = AXUIElementCreateApplication(w.pid)
  var rows: [AxRow] = []
  func walk(_ el: AXUIElement, _ depth: Int) {
    if rows.count >= axCap || depth > axDepth { return }
    let role = axString(el, kAXRoleAttribute as String)
    if !role.isEmpty && role != "AXGroup" && role != "AXUnknown" {
      let title = axString(el, kAXTitleAttribute as String)
      let value = axString(el, kAXValueAttribute as String)
      let desc = axString(el, kAXDescriptionAttribute as String)
      let n = rows.count + 1
      let focused = axBool(el, kAXFocusedAttribute as String) ? 1 : 0
      let enabled = axBool(el, kAXEnabledAttribute as String) ? 1 : 0
      let line =
        "e\(n) role=\(role) title=\(title) value=\(value) desc=\(desc) pos=\(axPoint(el, originX: w.x, originY: w.y)) size=\(axSize(el)) focused=\(focused) enabled=\(enabled)"
      rows.append(AxRow(el: el, line: line))
    }
    if rows.count >= axCap || depth >= axDepth { return }
    for child in axChildren(el) {
      walk(child, depth + 1)
      if rows.count >= axCap { return }
    }
  }
  walk(app, 0)
  return rows
}

private func dumpAx(_ w: Win) {
  let rows = collectAx(w)
  if rows.isEmpty {
    print("ax none pid=\(w.pid)")
    return
  }
  print("ax pid=\(w.pid) n=\(rows.count)")
  rows.forEach { print($0.line) }
}

private func axSet(_ w: Win, ref: String, text: String) {
  gateWrite(w)
  let rows = collectAx(w)
  let token = ref.trimmingCharacters(in: CharacterSet.alphanumerics.inverted).lowercased()
  let idx: Int
  if token.hasPrefix("e"), let n = Int(token.dropFirst()) {
    idx = n - 1
  } else if let n = Int(token) {
    idx = n - 1
  } else {
    die("axset needs ref like e1", 1)
  }
  guard idx >= 0, idx < rows.count else { die("ax ref not found", 1) }
  let err = AXUIElementSetAttributeValue(
    rows[idx].el,
    kAXValueAttribute as CFString,
    text as CFTypeRef,
  )
  if err != .success {
    die("axset failed (\(err.rawValue))", 1)
  }
  print("axset \(ref) chars=\(text.count)")
}

private func resolveApp(_ name: String) -> URL? {
  let fm = FileManager.default
  if name.hasSuffix(".app") || name.hasPrefix("/") {
    if fm.fileExists(atPath: name) { return URL(fileURLWithPath: name) }
  }
  let roots = [
    "/Applications",
    "/System/Applications",
    NSHomeDirectory() + "/Applications",
  ]
  for root in roots {
    let direct = "\(root)/\(name).app"
    if fm.fileExists(atPath: direct) { return URL(fileURLWithPath: direct) }
  }
  for root in roots {
    guard let items = try? fm.contentsOfDirectory(atPath: root) else { continue }
    for item in items where item.hasSuffix(".app") {
      let path = "\(root)/\(item)"
      if item.lowercased().contains(name.lowercased()) {
        return URL(fileURLWithPath: path)
      }
      if let bundle = Bundle(path: path) {
        let display = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
        let cfname = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
        if display?.localizedCaseInsensitiveContains(name) == true
          || cfname?.localizedCaseInsensitiveContains(name) == true
        {
          return URL(fileURLWithPath: path)
        }
      }
    }
  }
  return NSWorkspace.shared.urlForApplication(withBundleIdentifier: name)
}

private let browserBundleIds: Set<String> = [
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "com.google.Chrome.beta",
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.microsoft.edgemac",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "org.mozilla.firefox",
  "org.chromium.Chromium",
  "com.kagi.kagimacOS",
]

private func isBrowserBundle(_ url: URL) -> Bool {
  let id = (Bundle(url: url)?.bundleIdentifier ?? "").trimmingCharacters(in: .whitespaces)
  if browserBundleIds.contains(id) { return true }
  let path = url.path.lowercased()
  return path.contains("google chrome") || path.contains("/safari.app")
    || path.contains("microsoft edge") || path.contains("/arc.app")
    || path.contains("brave browser") || path.contains("/firefox.app")
    || path.contains("/chromium.app") || path.contains("/orion.app")
}

private func openApp(_ name: String, cdp: Int?) {
  guard let url = resolveApp(name) else { die("app not found: \(name)", 1) }
  if isBrowserBundle(url) { die("refused: browser", 2) }
  let config = NSWorkspace.OpenConfiguration()
  if let cdp, cdp > 0 {
    config.arguments = ["--remote-debugging-port=\(cdp)"]
  }
  let box = DispatchGroup()
  box.enter()
  var err: Error?
  NSWorkspace.shared.openApplication(at: url, configuration: config) { _, error in
    err = error
    box.leave()
  }
  _ = box.wait(timeout: .now() + 20)
  if let err { die(err.localizedDescription, 1) }
  print("opened \(url.path)" + (cdp != nil ? " cdp=\(cdp!)" : ""))
}

private func hasFlag(_ args: [String], _ name: String) -> Bool {
  args.contains(name)
}

private func usage() -> Never {
  die(
    """
    guildmac windows [query]
    guildmac shot <id> <path>
    guildmac see <id> <path>
    guildmac idle
    guildmac open <name-or-path> [--cdp PORT]
    guildmac ax <id>
    guildmac axset <id> <eN> <text>
    guildmac click <id> <x> <y> [--focus]
    guildmac type <id> <text> [--focus]
    guildmac hud [ms]
    """,
    1,
  )
}

_ = NSApplication.shared
let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { usage() }

switch cmd {
case "windows":
  let query = args.dropFirst().first?.lowercased() ?? ""
  let rows = windowList(false).filter { w in
    if query.isEmpty { return true }
    return w.owner.lowercased().contains(query) || w.title.lowercased().contains(query)
      || String(w.id) == query
  }
  if rows.isEmpty { print("none") }
  else { rows.forEach { print(fmt($0)) } }

case "shot":
  guard args.count >= 3, let w = findWin(args[1]) else { die("window not found", 1) }
  shot(w, path: args[2])

case "see":
  guard args.count >= 3, let w = findWin(args[1]) else { die("window not found", 1) }
  print(fmt(w))
  shot(w, path: args[2])
  dumpAx(w)

case "idle":
  let front = NSWorkspace.shared.frontmostApplication
  let name = front?.localizedName ?? "none"
  let pid = front?.processIdentifier ?? 0
  print(String(format: "idle=%.1fs front=%@ pid=%d", userIdleSeconds(), name, pid))

case "open":
  guard args.count >= 2 else { usage() }
  var cdp: Int?
  if let flag = args.firstIndex(of: "--cdp"), flag + 1 < args.count {
    cdp = Int(args[flag + 1])
  }
  openApp(args[1], cdp: cdp)

case "ax":
  guard args.count >= 2, let w = findWin(args[1]) else { die("window not found", 1) }
  dumpAx(w)

case "axset":
  guard args.count >= 4, let w = findWin(args[1]) else { die("axset needs id eN text", 1) }
  let text = args[3...].joined(separator: " ")
  axSet(w, ref: args[2], text: text)

case "click":
  guard args.count >= 4, let w = findWin(args[1]), let x = Double(args[2]), let y = Double(args[3])
  else { die("click needs id x y", 1) }
  gateWrite(w)
  let pt = eventPoint(win: w, localX: x, localY: y)
  if hasFlag(args, "--focus") {
    let borrowed = borrowFocus(pid: w.pid) { globalClick(at: pt) }
    print(String(format: "clicked id=%u %d,%d via=focus borrowed=%.2fs", w.id, Int(x), Int(y), borrowed))
  } else {
    postClick(pid: w.pid, at: pt)
    print("clicked id=\(w.id) \(Int(x)),\(Int(y)) via=pid")
  }

case "type":
  guard args.count >= 3, let w = findWin(args[1]) else { die("type needs id text", 1) }
  let focus = hasFlag(args, "--focus")
  let text = args[2...].filter { $0 != "--focus" }.joined(separator: " ")
  gateWrite(w)
  if focus {
    var posted = 0
    let borrowed = borrowFocus(pid: w.pid) { posted = globalType(text) }
    print(String(format: "typed id=%u chars=%d via=focus borrowed=%.2fs", w.id, posted, borrowed))
  } else {
    let posted = postType(pid: w.pid, text)
    print("typed id=\(w.id) chars=\(posted) via=pid")
  }

case "hud":
  let ms = Int(args.dropFirst().first ?? "400") ?? 400
  flashHUD(ms: ms)
  print("hud \(ms)ms")

default:
  usage()
}
