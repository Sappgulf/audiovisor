import XCTest
@testable import AudioVisor

@MainActor
final class MusicLibraryTests: XCTestCase {
    func testImportPersistsAndRemovingCopyPreservesOriginal() async throws {
        let fixture = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: fixture) }
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        let original = fixture.appending(path: "My track.mp3")
        try Data("test audio bytes".utf8).write(to: original)
        let root = fixture.appending(path: "Library")
        let library = MusicLibrary(directory: root)
        let tracks = try await library.add([original])
        XCTAssertEqual(tracks.count, 1)
        XCTAssertEqual(tracks[0].name, "My track")
        XCTAssertEqual(tracks[0].bytes, 16)
        let reopened = MusicLibrary(directory: root)
        let restored = try await reopened.load()
        XCTAssertEqual(restored.first?.id, tracks[0].id)
        let afterRemoval = try await reopened.remove(tracks[0])
        XCTAssertTrue(afterRemoval.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appending(path: tracks[0].filename).path))
    }

    func testFailedBatchRollsBackCopiesAndKeepsExistingManifest() async throws {
        let fixture = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: fixture) }
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        let valid = fixture.appending(path: "Track.mp3")
        try Data([1, 2, 3]).write(to: valid)
        let root = fixture.appending(path: "Library")
        let library = MusicLibrary(directory: root)
        let before = try await library.add([valid])
        do {
            _ = try await library.add([valid, fixture.appending(path: "Unsupported.txt")])
            XCTFail("Unsupported batches must fail")
        } catch LibraryError.unsupported { }
        let after = try await library.load()
        XCTAssertEqual(after.map(\.id), before.map(\.id))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path).count, 2)
    }

    func testCorruptManifestIsReportedWithoutOverwritingIt() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let manifest = root.appending(path: "library.json")
        let bytes = Data("not JSON".utf8)
        try bytes.write(to: manifest)
        do { _ = try await MusicLibrary(directory: root).load(); XCTFail("Corrupt data must be reported") }
        catch is DecodingError { }
        XCTAssertEqual(try Data(contentsOf: manifest), bytes)
    }

    func testEmptyFileIsRejectedWithoutLeavingAnImportedCopy() async throws {
        let fixture = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: fixture) }
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        let empty = fixture.appending(path: "Empty.mp3")
        try Data().write(to: empty)
        let root = fixture.appending(path: "Library")
        do { _ = try await MusicLibrary(directory: root).add([empty]); XCTFail("Empty files must fail") }
        catch LibraryError.size { }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    func testOversizedFileIsRejectedBeforeCopying() async throws {
        let fixture = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: fixture) }
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        let source = fixture.appending(path: "Large.wav")
        try Data().write(to: source)
        let handle = try FileHandle(forWritingTo: source)
        try handle.truncate(atOffset: 100 * 1024 * 1024 + 1)
        try handle.close()
        let root = fixture.appending(path: "Library")
        do { _ = try await MusicLibrary(directory: root).add([source]); XCTFail("Oversized files must fail before copying") }
        catch LibraryError.size { }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }
}
