@preconcurrency import WebKit
import UniformTypeIdentifiers

/// Serves the bundled web build (AudioVisor/Web, copied from dist/ by
/// `npm run ios:web`) under audiovisor-local://app/ so the app still opens
/// with no network. Vite emits root-absolute asset paths (/assets/...),
/// which resolve against this scheme's root exactly like they do on Vercel.
///
/// Files are read off the main thread: reading them inline blocked the UI
/// thread for every sample, font and preview, which stalled the page's own
/// boot and pushed the offline launch to ~10s.
final class LocalWebScheme: NSObject, WKURLSchemeHandler {
    private let root: URL? = Bundle.main.url(forResource: "Web", withExtension: nil)
    private let io = DispatchQueue(label: "app.audiovisor.local-web", qos: .userInitiated, attributes: .concurrent)
    /// Tasks WebKit has cancelled; answering one of those raises an exception.
    private var stopped = Set<ObjectIdentifier>()

    static var isAvailable: Bool {
        Bundle.main.url(forResource: "Web/index", withExtension: "html") != nil
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let root, let url = task.request.url else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        let id = ObjectIdentifier(task)
        // never serve anything outside the bundled folder
        guard file.path.hasPrefix(root.standardizedFileURL.path) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        io.async { [weak self] in
            let data = try? Data(contentsOf: file, options: .mappedIfSafe)
            DispatchQueue.main.async {
                guard let self, self.stopped.remove(id) == nil else { return }
                guard let data else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
                let ext = file.pathExtension
                let mime = UTType(filenameExtension: ext)?.preferredMIMEType
                    ?? (ext == "js" || ext == "mjs" ? "text/javascript" : "application/octet-stream")
                let response = HTTPURLResponse(
                    url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": mime, "Content-Length": "\(data.count)", "Cache-Control": "no-cache",
                        // Vite tags module scripts crossorigin; WebKit drops them without this
                        "Access-Control-Allow-Origin": "*",
                    ]
                )!
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }
}
