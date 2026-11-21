// The index along a sectioned list's edge, as Contacts' on an iPhone (the web's ui/LetterIndex.tsx): a tap jumps to a
// caption, and a finger kept on it and moved up and down jumps to the caption under it as it goes, with the letter
// shown big beside the finger. Only on a touch screen; with a mouse or a trackpad, as Contacts on a Mac, there is none.
import SwiftUI

struct LetterIndex: View {
    let letters: [String]
    let jump: (String) -> Void
    @State private var held: (letter: String, y: CGFloat)?

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                ForEach(letters, id: \.self) { l in
                    Text(l).font(.system(size: 11, weight: .semibold)).frame(width: 20, height: geo.size.height / CGFloat(max(letters.count, 1)))
                        .foregroundStyle(held?.letter == l ? Color.sky.opacity(0.75) : Color.sky)
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { jump(l) }
                }
            }
            .contentShape(Rectangle())
            // The key under the finger: the nearest, the first above and the last below, so sliding off an end keeps it.
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { g in
                    guard !letters.isEmpty, geo.size.height > 0 else { return }
                    let i = min(letters.count - 1, max(0, Int(g.location.y / geo.size.height * CGFloat(letters.count))))
                    let l = letters[i]
                    if l != held?.letter { jump(l) }
                    held = (l, min(geo.size.height, max(0, g.location.y)))
                }
                .onEnded { _ in held = nil })
            .overlay(alignment: .topTrailing) {
                if let held {
                    Text(held.letter).font(.largeTitle.weight(.semibold)).foregroundStyle(.white)
                        .frame(width: 56, height: 56).background(Circle().fill(.gray.opacity(0.8)))
                        .offset(x: -32, y: held.y - 28).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
        }
        .frame(width: 20)
        .frame(maxHeight: CGFloat(letters.count) * 18)
        .padding(.trailing, 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("songs.index"))
    }
}
