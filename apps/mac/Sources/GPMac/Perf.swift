// GP_MAC_PERF=<file>: times what a person does in the slides view, each step until the window has laid out and drawn
// again, and writes the medians to <file>, then quits.
import AppKit
import SwiftUI

@MainActor
enum Perf {
    static func run(_ model: Model, out: String) {
        guard let window = NSApp.windows.first(where: { $0.title != "Utgång" && $0.isVisible }) else { return }
        window.setContentSize(NSSize(width: 1500, height: 940))
        model.selectedPresentation = "pres-main"
        settle(window)
        func timed(_ n: Int, _ act: (Int) -> Void) -> (median: Double, worst: Double) {
            var ms: [Double] = []
            for i in 0..<n {
                let t = CFAbsoluteTimeGetCurrent()
                act(i)
                settle(window)
                ms.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
            }
            ms.sort()
            return (ms[ms.count / 2], ms.last!)
        }
        model.live(["type": "start"])
        settle(window)
        let pick = timed(60) { i in model.live(["type": "pick", "delta": i % 20 < 10 ? 1 : -1]) }
        let step = timed(60) { i in model.live(["type": "step", "delta": i % 20 < 10 ? 1 : -1]) }
        let items = model.current?.items.map(\.id) ?? []
        let jump = timed(30) { i in model.selectedItem = items[(i * 7) % items.count] }
        let reload = timed(20) { _ in model.load() }
        // Scrolling the slides as a trackpad does: 20 points a frame through the whole of them, down and back up,
        // once cold (no slide drawn yet) and once again.
        func scrollViews(_ v: NSView) -> [NSScrollView] { (v as? NSScrollView).map { [$0] } ?? [] + v.subviews.flatMap(scrollViews) }
        let slides = scrollViews(window.contentView!).max { $0.frame.width < $1.frame.width }
        func scrollPass() -> String {
            guard let sv = slides else { return "no scroll view" }
            let clip = sv.contentView
            let height = (sv.documentView?.frame.height ?? 0) - clip.bounds.height
            var ms: [Double] = []
            let ys: [CGFloat] = Array(stride(from: 0, through: height, by: 20)) + Array(stride(from: height, through: 0, by: -20))
            for y in ys {
                let t = CFAbsoluteTimeGetCurrent()
                clip.scroll(to: NSPoint(x: 0, y: y))
                sv.reflectScrolledClipView(clip)
                settle(window)
                ms.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
            }
            ms.sort()
            let over = { (limit: Double) in ms.filter { $0 > limit }.count }
            return String(format: "%d steps, median %.1f ms, p95 %.1f ms, worst %.1f ms, %d over 8.3 ms, %d over 16.7 ms",
                          ms.count, ms[ms.count / 2], ms[ms.count * 95 / 100], ms.last!, over(8.3), over(16.7))
        }
        model.selectedItem = nil
        slides?.contentView.scroll(to: .zero)
        let cold = scrollPass()
        let warm = scrollPass()
        // Does choosing an item scroll its slides to the top? Where the view stands after each choice.
        var follows: [String] = []
        for at in [8, 2, 14, 0] where at < items.count {
            model.selectedItem = items[at]
            for _ in 0..<20 { settle(window); RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
            follows.append("\(at): y \(Int(slides?.contentView.bounds.origin.y ?? -1))")
        }
        func line(_ name: String, _ r: (median: Double, worst: Double)) -> String { String(format: "%@: median %.1f ms, worst %.1f ms", name, r.median, r.worst) }
        var report: [String] = ["follows " + follows.joined(separator: ", ")]
        report.append(line("pick (→)", pick))
        report.append(line("step (space)", step))
        report.append(line("jump to an item", jump))
        report.append(line("reload the presentation", reload))
        report.append("scroll, cold: " + cold)
        report.append("scroll, warm: " + warm)
        report.append("display: \(window.screen?.maximumFramesPerSecond ?? 0) Hz")
        let text = report.joined(separator: "\n")
        try? text.write(toFile: out, atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }

    /// Lets SwiftUI apply what changed, then lays out and draws the window at once.
    private static func settle(_ window: NSWindow) {
        RunLoop.main.run(until: Date())
        window.contentView?.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date())
        window.contentView?.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
    }
}
