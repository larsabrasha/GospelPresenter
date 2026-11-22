// Where every slide of the middle column stands, worked out exactly rather than guessed by a lazy stack (WWDC26 321:
// a lazy stack estimates what it has not placed, so a place in it cannot be held by arithmetic): each item a heading of
// its measured height over its slides in rows. With it the slide at the top, and how far into it the view stands, is
// held there while the column's width changes and its rows are laid out again (Lars, 2026-11-21).
import SwiftUI

struct SlideGridLayout {
    static let spacing: CGFloat = 18, padding: CGFloat = 28

    /// Each item's number of slides and its heading's height, in the running order.
    let counts: [Int]
    let headings: [CGFloat]
    let columns: Int
    let tileWidth: CGFloat

    var tileHeight: CGFloat { tileWidth * 9 / 16 }
    private var rowStep: CGFloat { tileHeight + Self.spacing }

    func rows(_ i: Int) -> Int { counts[i] == 0 ? 0 : (counts[i] + columns - 1) / columns }

    /// An item's height: its heading, its rows, and the space under them.
    func height(_ i: Int) -> CGFloat {
        let n = CGFloat(rows(i))
        return headings[i] + (n > 0 ? n * tileHeight + (n - 1) * Self.spacing : 0) + Self.spacing
    }

    /// Where an item's heading starts, in the content.
    func top(_ i: Int) -> CGFloat { Self.padding + (0..<i).reduce(0) { $0 + height($1) } }

    /// Every slide's tile as it stands in the content, for ↑ ↓ (the core's `slideAcrossView`): its key
    /// (`itemId/part`) and its box, items given in the running order with their ids.
    func tiles(_ ids: [String]) -> [[String: Any]] {
        ids.indices.flatMap { i in
            (0..<counts[i]).map { n -> [String: Any] in
                let left = Self.padding + CGFloat(n % columns) * (tileWidth + Self.spacing)
                let top = top(i) + headings[i] + CGFloat(n / columns) * rowStep
                return ["key": "\(ids[i])/\(n)", "left": left, "top": top, "right": left + tileWidth, "bottom": top + tileHeight]
            }
        }
    }

    /// A place in the slides: the item, the first slide of the row (nil in its heading), and how far into that row or
    /// heading, as a share of its height.
    struct Anchor: Equatable { let item: Int, slide: Int?, share: CGFloat }

    /// The place at `y` in the content.
    func anchor(atY y: CGFloat) -> Anchor? {
        guard !counts.isEmpty else { return nil }
        var i = 0
        while i < counts.count - 1 && top(i + 1) <= y { i += 1 }
        let local = y - top(i)
        if local < headings[i] || rows(i) == 0 { return Anchor(item: i, slide: nil, share: max(0, local) / max(1, headings[i])) }
        let row = min(rows(i) - 1, Int((local - headings[i]) / rowStep))
        return Anchor(item: i, slide: row * columns, share: (local - headings[i] - CGFloat(row) * rowStep) / rowStep)
    }

    /// Where `anchor` stands in this layout, which may have another width and another number of slides to a row.
    /// (The scroll view's content starts at 0; `top` counts the padding.)
    func y(of anchor: Anchor) -> CGFloat {
        let i = min(anchor.item, counts.count - 1)
        guard i >= 0 else { return 0 }
        guard let slide = anchor.slide, rows(i) > 0 else { return top(i) + anchor.share * headings[i] }
        let row = min(rows(i) - 1, slide / columns)
        return top(i) + headings[i] + CGFloat(row) * rowStep + anchor.share * rowStep
    }
}

/// Holds the place at the top of a scroll view of a SlideGridLayout: followed as it scrolls; while `holding` (the width
/// changing, and the rows laid out again) not followed but given back, at its place in the layout as it is now, each
/// time the layout changes. From macOS 15 and iOS 18, which can read and set the offset; before, the scroll view's own.
struct KeepsPlace: ViewModifier {
    let layout: SlideGridLayout
    @Binding var anchor: SlideGridLayout.Anchor?
    let holding: Bool

    func body(content: Content) -> some View {
        if #available(macOS 15, iOS 18, *) { content.modifier(Held(layout: layout, anchor: $anchor, holding: holding)) } else { content }
    }

    @available(macOS 15, iOS 18, *)
    private struct Held: ViewModifier {
        let layout: SlideGridLayout
        @Binding var anchor: SlideGridLayout.Anchor?
        let holding: Bool
        @State private var position = ScrollPosition(edge: .top)

        /// What moves the slides under the view: the width and the number to a row, and the headings' heights.
        private struct Shape: Equatable { let columns: Int, width: CGFloat, headings: [CGFloat] }

        func body(content: Content) -> some View {
            content
                .scrollPosition($position)
                .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in
                    if !holding { anchor = layout.anchor(atY: y) }
                }
                .onChange(of: Shape(columns: layout.columns, width: layout.tileWidth, headings: layout.headings)) { _, _ in
                    if holding, let anchor { position.scrollTo(y: layout.y(of: anchor)) }
                }
        }
    }
}
