import SwiftUI
import Metal
import MetalKit

/// The main view when connected to a remote Mac.
/// Shows the Metal-rendered remote display with pan/zoom and a minimap overlay.
struct RemoteScreenView: View {
    @Environment(AppState.self) private var appState
    @State private var renderer: MetalScreenRenderer? = MetalScreenRenderer(device: MTLCreateSystemDefaultDevice()!)
    /// Accumulated translation delta during an active drag; reset to .zero on gesture end.
    @State private var dragTranslation: CGSize = .zero
    @State private var zoomScale: CGFloat = 1.0
    @State private var showMinimap: Bool = true

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let renderer {
                MetalViewRepresentable(renderer: renderer)
                    .gesture(panGesture(renderer: renderer))
                    .gesture(zoomGesture(renderer: renderer))
                    .onTapGesture(count: 2) { resetTransform(renderer: renderer) }

                VStack {
                    topBar

                    Spacer()

                    HStack {
                        Spacer()
                        VStack(alignment: .trailing, spacing: 8) {
                            Button {
                                withAnimation { showMinimap.toggle() }
                            } label: {
                                Image(systemName: showMinimap ? "map.fill" : "map")
                                    .padding(8)
                                    .background(.ultraThinMaterial)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)

                            if showMinimap {
                                MinimapView(renderer: renderer)
                                    .frame(width: 160, height: 90)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                                    )
                                    .transition(.scale.combined(with: .opacity))
                            }
                        }
                        .padding()
                    }
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundStyle(.orange)
                    Text("Metal is not available on this device")
                        .foregroundStyle(.white)
                }
            }
        }
        .navigationTitle(appState.remoteHostName ?? "Remote Mac")
        .toolbar { toolbarItems }
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack {
            HStack(spacing: 6) {
                Circle()
                    .fill(appState.latencyMs.latencyColor)
                    .frame(width: 8, height: 8)
                Text(appState.latencyMs > 0 ? "\(Int(appState.latencyMs))ms" : "Connected")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.black.opacity(0.5))
            .clipShape(Capsule())

            Spacer()

            Text(String(format: "%.0f%%", zoomScale * 100))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.black.opacity(0.5))
                .clipShape(Capsule())
        }
        .padding()
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .automatic) {
            Button("Disconnect") {
                appState.mode = .none
                appState.remoteHostName = nil
            }
            .foregroundStyle(.red)
        }
        ToolbarItem(placement: .automatic) {
            Button {
                if let renderer { resetTransform(renderer: renderer) }
            } label: {
                Label("Reset View", systemImage: "arrow.up.left.and.arrow.down.right")
            }
        }
    }

    // MARK: - Gestures

    private func resetTransform(renderer: MetalScreenRenderer) {
        renderer.resetTransform()
        dragTranslation = .zero
        zoomScale = 1.0
    }

    private func panGesture(renderer: MetalScreenRenderer) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let dx = value.translation.width - dragTranslation.width
                let dy = value.translation.height - dragTranslation.height
                renderer.panOffset.x += dx
                renderer.panOffset.y += dy
                dragTranslation = value.translation
            }
            .onEnded { _ in
                dragTranslation = .zero
            }
    }

    private func zoomGesture(renderer: MetalScreenRenderer) -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                // Apply live preview; zoomScale is updated here so .onEnded
                // reads the correct base when chaining multiple gestures.
                let newScale = (zoomScale * value).clamped(to: 0.25...4.0)
                renderer.zoomScale = newScale
                zoomScale = newScale
            }
            .onEnded { _ in
                // zoomScale already updated in onChanged; sync renderer for safety.
                renderer.zoomScale = zoomScale
            }
    }
}

// MARK: - Minimap

/// A small overview map showing a reduced-scale live view of the remote display.
struct MinimapView: NSViewRepresentable {
    let renderer: MetalScreenRenderer

    func makeNSView(context: Context) -> MTKView {
        guard let device = MTLCreateSystemDefaultDevice() else { return MTKView() }
        let view = MTKView(frame: .zero, device: device)
        view.delegate = renderer
        view.preferredFramesPerSecond = 15
        view.clearColor = MTLClearColor(red: 0.05, green: 0.05, blue: 0.05, alpha: 1)
        return view
    }

    func updateNSView(_ nsView: MTKView, context: Context) {}
}

// MARK: - Comparable clamping helper

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
