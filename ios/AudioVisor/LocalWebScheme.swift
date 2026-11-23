@preconcurrency import WebKit
import UniformTypeIdentifiers

/// WebKit tasks stay on the main actor; only URL and Data cross executors.
@MainActor
final class LocalWebScheme: NSObject, WKURLSchemeHandler {
    private var active: [ObjectIdentifier: any WKURLSchemeTask] = [:]

    static var isAvailable: Bool {
        Bundle.main.url(forResource: "Web/index", withExtension: "html") != nil
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        #if DEBUG
        NSLog("Local resource start: %@", task.request.url?.absoluteString ?? "missing")
        #endif
        guard let url = task.request.url, url.host == "app",
              let bundleRoot = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let imported = url.path.hasPrefix("/imports/")
        let root = imported ? MusicLibrary.directory : bundleRoot
        let path = imported ? String(url.path.dropFirst("/imports/".count)) : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path.isEmpty ? "index.html" : path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"),
              !imported || UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil else {
            task.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        let id = ObjectIdentifier(task)
        active[id] = task
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) { () -> Result<Data, any Error> in
                Result { try Data(contentsOf: file, options: .mappedIfSafe) }
            }.value
            guard let task = self?.active.removeValue(forKey: id) else { return }
            #if DEBUG
            NSLog("Local resource result: %@", file.lastPathComponent)
            #endif
            switch result {
            case .failure(let error): task.didFailWithError(error)
            case .success(let data):
                let ext = file.pathExtension.lowercased()
                let mime = ["js", "mjs"].contains(ext) ? "text/javascript" : UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
                guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                    "Content-Type": mime, "Content-Length": "\(data.count)",
                    "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache",
                ]) else { task.didFailWithError(URLError(.badServerResponse)); return }
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        active.removeValue(forKey: ObjectIdentifier(task))
    }
}
