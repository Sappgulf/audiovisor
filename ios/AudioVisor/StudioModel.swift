import SwiftUI

struct VisualLook: Identifiable, Sendable {
    let id: String
    let name: String
    let category: String

    var image: UIImage? {
        UIImage(named: "VisualPreviews/\(id).jpg")
    }
    static let all: [VisualLook] = [
        .init(id: "bars", name: "Spectrum Bars", category: "Spectral"),
        .init(id: "waves", name: "Linear Wave", category: "Spectral"),
        .init(id: "scope", name: "Vectorscope", category: "Instrument"),
        .init(id: "particles", name: "Particle Field", category: "Cosmic"),
        .init(id: "kaleido", name: "Kaleidoscope", category: "Geometric"),
        .init(id: "spectro", name: "Spectrogram", category: "Spectral"),
        .init(id: "tunnel", name: "Radial Tunnel", category: "Geometric"),
        .init(id: "plasma", name: "Plasma Rings", category: "Organic"),
        .init(id: "terrain", name: "Aurora Terrain", category: "Organic"),
        .init(id: "city", name: "Neon City", category: "Cosmic"),
        .init(id: "nebula", name: "Nebula Clouds", category: "Cosmic"),
        .init(id: "spiral", name: "Spiral Galaxy", category: "Cosmic"),
        .init(id: "orb", name: "Pulse Orb", category: "Cosmic"),
        .init(id: "fluid", name: "Fluid Metal", category: "Organic"),
        .init(id: "tensor", name: "Tensor Grid", category: "Geometric"),
        .init(id: "prism", name: "Prism Ray", category: "Geometric"),
        .init(id: "void", name: "Void Core", category: "Cosmic"),
        .init(id: "bloomfield", name: "Bloom Field", category: "Organic"),
        .init(id: "fractal", name: "Fractal Bloom", category: "Geometric"),
        .init(id: "radar", name: "Beat Radar", category: "Instrument"),
        .init(id: "lava", name: "Lava Lamp", category: "Organic"),
        .init(id: "gpu", name: "GPU Core", category: "Geometric"),
        .init(id: "vinyl", name: "Vinyl Groove", category: "Instrument"),
        .init(id: "chladni", name: "Chladni Field", category: "Geometric"),
    ]
}

@MainActor
final class StudioModel: ObservableObject {
    @Published var ready = false
    @Published var startupSlow = false
    @Published var busy = false
    @Published var error: String?
    @Published var tracks: [LibraryTrack] = []
    @Published private(set) var completedImports = 0
    @Published var title = ""
    @Published var playing = false
    @Published var hasTrack = false
    @Published var selectedLook = VisualLook.all.first { $0.id == UserDefaults.standard.string(forKey: "selectedLook") } ?? VisualLook.all[10] {
        didSet { UserDefaults.standard.set(selectedLook.id, forKey: "selectedLook") }
    }
    @Published private(set) var favorites = Set(UserDefaults.standard.stringArray(forKey: "favoriteVisuals") ?? [])

    func toggleFavorite(_ look: VisualLook) {
        if favorites.contains(look.id) { favorites.remove(look.id) }
        else { favorites.insert(look.id) }
        UserDefaults.standard.set(favorites.sorted(), forKey: "favoriteVisuals")
    }

    @Published var showLooks = false
    @Published var showInfo = false
    let library = MusicLibrary()
    var openStage: (() -> Void)?
    var importMusic: (() -> Void)?
    var retry: (() -> Void)?
    var command: ((String, [String: Any]) async throws -> Void)?

    func loadLibrary() async {
        do { tracks = try await library.load() }
        catch { self.error = "Couldn’t open your library: \(error.localizedDescription)" }
    }

    func select(_ look: VisualLook) {
        selectedLook = look
        showLooks = false
        UISelectionFeedbackGenerator().selectionChanged()
    }

    func start(track: LibraryTrack? = nil) {
        guard ready, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                guard let command else { throw URLError(.cancelled) }
                try await command("mode", ["id": selectedLook.id])
                if let track { try await command("open", ["tracks": [track.bridgeValue]]) }
                else if !hasTrack { try await command("demo", [:]) }
                openStage?()
            } catch { self.error = "Couldn’t open the stage. \(error.localizedDescription)" }
        }
    }

    func add(_ urls: [URL]) {
        busy = true
        Task {
            defer { busy = false }
            do {
                tracks = try await library.add(urls)
                completedImports += 1
            }
            catch { self.error = "Couldn’t import music. \(error.localizedDescription)" }
        }
    }

    func remove(_ track: LibraryTrack) {
        Task {
            do { tracks = try await library.remove(track) }
            catch { self.error = "Couldn’t remove this copy. \(error.localizedDescription)"; await loadLibrary() }
        }
    }

    func toggle() {
        Task {
            do { try await command?("toggle", [:]) }
            catch { self.error = "Playback is unavailable. Return to the stage to try again." }
        }
    }
}
