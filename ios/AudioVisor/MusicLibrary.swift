import Foundation

struct LibraryTrack: Identifiable, Codable, Sendable {
    let id: UUID
    let name: String
    let filename: String
    let bytes: Int64

    var subtitle: String { ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) }
    var bridgeValue: [String: String] {
        ["name": "\(name).\(URL(fileURLWithPath: filename).pathExtension)", "url": "\(Stage.localScheme)://app/imports/\(filename)"]
    }
}

/// Files and their manifest are owned by one executor; no file IO blocks UI.
actor MusicLibrary {
    static let directory = URL.applicationSupportDirectory.appending(path: "Music", directoryHint: .isDirectory)
    private let root: URL
    init(directory: URL = MusicLibrary.directory) { root = directory }
    private var manifest: URL { root.appending(path: "library.json") }
    private let extensions: Set<String> = ["mp3", "wav", "flac", "m4a", "aac", "aif", "aiff", "ogg", "opus"]

    func load() throws -> [LibraryTrack] {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        guard FileManager.default.fileExists(atPath: manifest.path) else { return [] }
        return try JSONDecoder().decode([LibraryTrack].self, from: Data(contentsOf: manifest))
    }

    func add(_ urls: [URL]) throws -> [LibraryTrack] {
        var tracks = try load()
        var copied: [URL] = []
        do {
            for source in urls {
                guard extensions.contains(source.pathExtension.lowercased()) else {
                    throw LibraryError.unsupported
                }
                let access = source.startAccessingSecurityScopedResource()
                defer { if access { source.stopAccessingSecurityScopedResource() } }
                let sourceBytes = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard sourceBytes > 0, sourceBytes <= 100 * 1024 * 1024 else { throw LibraryError.size }
                let id = UUID()
                let filename = "\(id.uuidString).\(source.pathExtension.lowercased())"
                let target = root.appending(path: filename)
                copied.append(target)
                var coordinationError: NSError?
                var copyError: (any Error)?
                NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { url in
                    do { try FileManager.default.copyItem(at: url, to: target) }
                    catch { copyError = error }
                }
                if let error = coordinationError ?? copyError { throw error }
                let bytes = try target.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard bytes > 0, bytes <= 100 * 1024 * 1024 else { throw LibraryError.size }
                tracks.insert(LibraryTrack(id: id, name: source.deletingPathExtension().lastPathComponent, filename: filename, bytes: Int64(bytes)), at: 0)
            }
            try JSONEncoder().encode(tracks).write(to: manifest, options: .atomic)
            return tracks
        } catch {
            for file in copied { try? FileManager.default.removeItem(at: file) }
            throw error
        }
    }

    func remove(_ track: LibraryTrack) throws -> [LibraryTrack] {
        var tracks = try load()
        tracks.removeAll { $0.id == track.id }
        // Commit the manifest first. A leftover copy is safer than a lost entry.
        try JSONEncoder().encode(tracks).write(to: manifest, options: .atomic)
        try FileManager.default.removeItem(at: root.appending(path: track.filename))
        return tracks
    }
}

enum LibraryError: LocalizedError {
    case unsupported, size
    var errorDescription: String? {
        switch self {
        case .unsupported: "Choose MP3, M4A, WAV, FLAC, AAC, AIFF, OGG or Opus audio files."
        case .size: "Choose a non-empty audio file under 100 MB. Larger files can exceed the visualizer’s memory budget."
        }
    }
}
