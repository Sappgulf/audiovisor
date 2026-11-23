import UIKit
import SafariServices
import SwiftUI
import UniformTypeIdentifiers
@preconcurrency import WebKit

/// Owns the bundled stage and a persistent native studio above it.
final class StageViewController: UIViewController {
    private var webView: WKWebView!
    private var popup: PopupViewController?
    private let studio = StudioModel()
    private var home: UIHostingController<StudioView>!
    private var bootTimeout: Task<Void, Never>?
    private let studioButton = UIButton(type: .system)

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { home?.view.isHidden == true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        // The stage uses its in-window cinema mode so native navigation stays reachable.
        config.preferences.isElementFullscreenEnabled = false
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        // keeps Safari's UA (feature detection stays honest) and lets the
        // page know it is inside the native shell
        config.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1 AudioVisorApp/1.0"
        config.setURLSchemeHandler(LocalWebScheme(), forURLScheme: Stage.localScheme)
        config.userContentController.add(StudioMessageHandler(owner: self), name: "studio")
        config.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('is-native', 'native-home-visible')", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG
        // Debug builds forward page errors to the unified log
        // (log stream --predicate 'subsystem == "app.audiovisor.web"').
        let bridge = """
        (() => {
          const send = (kind, args) => { try { webkit.messageHandlers.avlog.postMessage(kind + ': ' + [...args].map(String).join(' ')); } catch {} };
          for (const k of ['error', 'warn', 'log']) { const o = console[k]; console[k] = (...a) => { send(k, a); o.apply(console, a); }; }
          addEventListener('error', (e) => send('uncaught', [e.message, e.filename + ':' + e.lineno]));
          addEventListener('unhandledrejection', (e) => send('rejection', [e.reason && (e.reason.stack || e.reason)]));
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(WebLog(), name: "avlog")
        #endif

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = Stage.background
        webView.scrollView.backgroundColor = Stage.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
        view = UIView()
        view.backgroundColor = Stage.background
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        studio.command = { [weak self] method, arguments in
            guard let self else { throw URLError(.cancelled) }
            try await self.perform(method, arguments: arguments)
        }
        studio.importMusic = { [weak self] in self?.importMusic() }
        studio.openStage = { [weak self] in self?.showHome(false) }
        studio.retry = { [weak self] in self?.loadStage() }
        home = UIHostingController(rootView: StudioView(model: studio))
        addChild(home)
        home.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(home.view)
        NSLayoutConstraint.activate([
            home.view.topAnchor.constraint(equalTo: view.topAnchor),
            home.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            home.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            home.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        home.didMove(toParent: self)
        var returnStyle = UIButton.Configuration.plain()
        returnStyle.title = "Studio"
        returnStyle.image = UIImage(systemName: "chevron.left")
        returnStyle.imagePadding = 6
        returnStyle.baseForegroundColor = UIColor(red: 0.72, green: 0.65, blue: 1, alpha: 1)
        returnStyle.background.backgroundColor = Stage.background.withAlphaComponent(0.95)
        returnStyle.background.cornerRadius = 22
        returnStyle.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 16)
        studioButton.configuration = returnStyle
        studioButton.accessibilityLabel = "Return to studio"
        studioButton.addAction(UIAction { [weak self] _ in self?.showHome(true) }, for: .touchUpInside)
        studioButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(studioButton)
        NSLayoutConstraint.activate([
            studioButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            studioButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 6),
            studioButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        loadStage()
        #if DEBUG
        // A real bundled track exercises persistent import/playback in UI tests.
        if ProcessInfo.processInfo.arguments.contains("-uitest-seed-library") {
            Task {
                if (try? await studio.library.load())?.isEmpty == true,
                   let source = Bundle.main.url(forResource: "night-voltage", withExtension: "mp3", subdirectory: "Web/samples") {
                    studio.add([source])
                }
            }
        }
        #endif
    }

    private func loadStage() {
        bootTimeout?.cancel()
        studio.ready = false
        studio.startupSlow = false
        studio.playing = false
        studio.hasTrack = false
        showHome(true)
        guard LocalWebScheme.isAvailable else {
            studio.error = "The visual engine is missing from this installation. Reinstall the app to restore it."
            return
        }
        webView.load(URLRequest(url: Stage.localURL))
        bootTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard !Task.isCancelled, let self, !self.studio.ready else { return }
            self.studio.startupSlow = true
        }
    }

    private func perform(_ method: String, arguments: [String: Any]) async throws {
        let scripts = [
            "mode": "window.AudioVisorNative.mode(id)",
            "demo": "window.AudioVisorNative.demo()",
            "open": "await window.AudioVisorNative.open(tracks)",
            "toggle": "window.AudioVisorNative.toggle()",
            "pause": "window.AudioVisorNative.pause()",
        ]
        guard let script = scripts[method], studio.ready else { throw URLError(.cannotLoadFromNetwork) }
        _ = try await webView.callAsyncJavaScript(script, arguments: arguments, in: nil, contentWorld: .page)
    }

    private func showHome(_ visible: Bool) {
        home?.view.isHidden = !visible
        studioButton.isHidden = visible
        webView.accessibilityElementsHidden = visible
        if studio.ready {
            webView.evaluateJavaScript("document.documentElement.classList.toggle('native-home-visible', \(visible ? "true" : "false"))", completionHandler: nil)
        }
        refreshActivity()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    func refreshActivity() {
        UIApplication.shared.isIdleTimerDisabled = home?.view.isHidden == true && studio.playing
    }

    private func importMusic() {
        guard presentedViewController == nil else { return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: false)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        present(picker, animated: true)
    }

    fileprivate func receive(_ message: WKScriptMessage) {
        #if DEBUG
        NSLog("Studio message: %@ origin %@ %@ frame %@", String(describing: message.body), message.frameInfo.securityOrigin.protocol, message.frameInfo.securityOrigin.host, String(describing: message.frameInfo.request.url))
        #endif
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == Stage.localScheme,
              message.frameInfo.securityOrigin.host == "app",
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            bootTimeout?.cancel()
            studio.ready = true
            studio.startupSlow = false
        case "state":
            studio.playing = body["playing"] as? Bool ?? false
            studio.hasTrack = body["hasTrack"] as? Bool ?? false
            studio.title = body["title"] as? String ?? ""
            refreshActivity()
        case "home": showHome(true)
        case "look":
            if let id = body["id"] as? String, let look = VisualLook.all.first(where: { $0.id == id }) { studio.selectedLook = look }
        case "import": showHome(true); importMusic()
        default: break
        }
    }

    /// The stage itself, the auth providers it signs in with, and the local
    /// fallback stay in the app; any other link opens in Safari.
    private func isInApp(_ url: URL) -> Bool {
        if url.scheme == Stage.localScheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return true }
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        let allowed = [Stage.liveHost, "accounts.spotify.com", "authorize.music.apple.com", "idmsa.apple.com", "appleid.apple.com"]
        return allowed.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Frames inside the page: the in-app hosts plus the player SDKs the
    /// streaming connections embed (Spotify Web Playback, MusicKit).
    private func isAllowedFrame(_ url: URL) -> Bool {
        if isInApp(url) { return true }
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        return ["sdk.scdn.co", "js-cdn.music.apple.com"].contains(host)
    }

    /// Non-web links the app will hand to iOS, and only on a real tap.
    private static let externalSchemes: Set<String> = ["mailto", "spotify", "music", "itms-apps"]

    /// One navigation policy for the stage and its sign-in popups: in-app
    /// pages load, allowed frames load, tapped web links go to Safari,
    /// tapped links with a known scheme go to iOS, everything else is dropped.
    fileprivate func policy(for action: WKNavigationAction) -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        let isMain = action.targetFrame?.isMainFrame ?? true
        if isMain ? isInApp(url) : isAllowedFrame(url) { return .allow }
        let tapped = action.navigationType == .linkActivated
        guard isMain, tapped else { return .cancel }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "https" || scheme == "http" {
            (presentedViewController ?? self).present(SFSafariViewController(url: url), animated: true)
        } else if Self.externalSchemes.contains(scheme) {
            UIApplication.shared.open(url)
        }
        return .cancel
    }
}

extension StageViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        #if DEBUG
        webView.evaluateJavaScript("JSON.stringify({url: location.href, boot: !!window.__av, native: !!window.AudioVisorNative, handlers: !!window.webkit?.messageHandlers?.studio})") { result, error in
            NSLog("Studio boot: %@ %@", String(describing: result), String(describing: error))
        }
        #endif
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        decisionHandler(policy(for: action))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        studio.ready = false
        showHome(true)
        studio.error = "The visual engine couldn’t load. \(error.localizedDescription)"
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        self.webView(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        studio.playing = false
        studio.hasTrack = false
        loadStage()
        studio.error = "iOS stopped the visual engine to reclaim memory. Your imported music is still in My music."
    }

}

extension StageViewController: WKUIDelegate {
    /// Live-input mode uses getUserMedia. iOS still shows its own microphone
    /// prompt (NSMicrophoneUsageDescription); WebKit's second prompt is
    /// skipped for the stage's own pages.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        let ours = origin.host == Stage.liveHost || origin.protocol == Stage.localScheme
        decisionHandler(ours && type == .microphone ? .grant : .prompt)
    }

    /// MusicKit and OAuth flows sign in through a popup that posts back to
    /// window.opener, so the popup must be a real child web view, shown as a
    /// sheet, not a Safari tab.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // only the stage's own main frame may open a popup
        guard action.sourceFrame.isMainFrame, isInApp(webView.url ?? Stage.liveURL) else { return nil }
        if let url = action.request.url, !isInApp(url) {
            if ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                present(SFSafariViewController(url: url), animated: true)
            }
            return nil
        }
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.uiDelegate = self
        let sheet = PopupViewController(webView: child, policy: { [weak self] in self?.policy(for: $0) ?? .cancel })
        popup = sheet
        present(sheet, animated: true)
        return child
    }

    func webViewDidClose(_ webView: WKWebView) {
        popup?.dismiss(animated: true)
        popup = nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        guard frame.isMainFrame else { return completionHandler() }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        (presentedViewController ?? self).present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        guard frame.isMainFrame else { return completionHandler(false) }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        (presentedViewController ?? self).present(alert, animated: true)
    }
}

/// Sheet hosting a sign-in popup with a Done button.
final class PopupViewController: UIViewController, WKNavigationDelegate {
    private let webView: WKWebView
    private let policy: (WKNavigationAction) -> WKNavigationActionPolicy
    private let item = UINavigationItem(title: "Sign in")
    private var hostWatch: NSKeyValueObservation?

    init(webView: WKWebView, policy: @escaping (WKNavigationAction) -> WKNavigationActionPolicy) {
        self.webView = webView
        self.policy = policy
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        webView.navigationDelegate = self
        // show where the sign-in actually is, so a page cannot pose as one
        hostWatch = webView.observe(\.url, options: [.initial, .new]) { [weak self] view, _ in
            MainActor.assumeIsolated { self?.item.title = view.url?.host ?? "Sign in" }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        decisionHandler(policy(action))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let bar = UINavigationBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        item.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        bar.items = [item]
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
}

#if DEBUG
import os
/// Receives console output from the page in debug builds.
final class WebLog: NSObject, WKScriptMessageHandler {
    private let log = Logger(subsystem: "app.audiovisor.web", category: "console")
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        log.notice("\(String(describing: message.body), privacy: .public)")
    }
}
#endif


extension StageViewController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard urls.count <= 30 else { studio.error = "Import up to 30 tracks at a time."; return }
        studio.add(urls)
    }
}

/// WebKit retains its handlers; a weak adapter avoids retaining the controller.
private final class StudioMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: StageViewController?
    init(owner: StageViewController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(message)
    }
}
