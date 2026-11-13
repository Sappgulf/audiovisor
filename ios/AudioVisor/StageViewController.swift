import UIKit
import SafariServices
@preconcurrency import WebKit

/// The whole app is one edge-to-edge stage. It loads the live site so every
/// feature works and updates with each deploy — Spotify sign-in returns to
/// its registered web address, and Apple Music's developer token comes from
/// the site's /api function — and falls back to the bundled build offline.
final class StageViewController: UIViewController {
    private var webView: WKWebView!
    private var popup: PopupViewController?
    private var usingLocal = false
    /// Branded cover shown until the stage's first page finishes loading.
    private let cover = UIView()

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        // keeps Safari's UA (feature detection stays honest) and lets the
        // page know it is inside the native shell
        config.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1 AudioVisorApp/1.0"
        config.setURLSchemeHandler(LocalWebScheme(), forURLScheme: Stage.localScheme)
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
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildCover()
        #if DEBUG
        // `-offline` exercises the bundled fallback without cutting the network
        if ProcessInfo.processInfo.arguments.contains("-offline") { usingLocal = false; fallBackToLocal(); return }
        #endif
        var request = URLRequest(url: Stage.liveURL)
        // a slow network should not hold the stage hostage
        request.timeoutInterval = 8
        webView.load(request)
    }

    private func buildCover() {
        cover.backgroundColor = Stage.background
        cover.translatesAutoresizingMaskIntoConstraints = false
        let mark = UIImageView(image: UIImage(named: "LaunchMark"))
        mark.contentMode = .scaleAspectFit
        mark.layer.cornerRadius = 30
        mark.layer.cornerCurve = .continuous
        mark.clipsToBounds = true
        let name = UILabel()
        name.text = "AUDIOVISOR"
        name.textColor = UIColor(white: 1, alpha: 0.92)
        name.font = .systemFont(ofSize: 22, weight: .heavy)
        let tag = UILabel()
        tag.text = "Tuning the stage…"
        tag.textColor = UIColor(white: 1, alpha: 0.45)
        tag.font = .monospacedSystemFont(ofSize: 12, weight: .medium)
        let stack = UIStackView(arrangedSubviews: [mark, name, tag])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.setCustomSpacing(6, after: name)
        stack.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(stack)
        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            mark.widthAnchor.constraint(equalToConstant: 112),
            mark.heightAnchor.constraint(equalToConstant: 112),
            stack.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
        ])
        // a slow breath on the mark while the page loads
        UIView.animate(withDuration: 1.1, delay: 0, options: [.autoreverse, .repeat, .allowUserInteraction]) {
            mark.alpha = 0.55
            mark.transform = CGAffineTransform(scaleX: 0.94, y: 0.94)
        }
    }

    private func revealStage() {
        guard cover.superview != nil else { return }
        UIView.animate(withDuration: 0.45, delay: 0.15, options: [.curveEaseOut]) {
            self.cover.alpha = 0
        } completion: { _ in
            self.cover.removeFromSuperview()
        }
    }

    private func fallBackToLocal() {
        guard !usingLocal, LocalWebScheme.isAvailable else { return }
        usingLocal = true
        webView.load(URLRequest(url: Stage.localURL))
    }

    /// The stage itself, the auth providers it signs in with, and the local
    /// fallback stay in the app; any other link opens in Safari.
    private func isInApp(_ url: URL) -> Bool {
        if url.scheme == Stage.localScheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return true }
        guard let host = url.host?.lowercased() else { return false }
        let allowed = [Stage.liveHost, "accounts.spotify.com", "authorize.music.apple.com", "idmsa.apple.com", "appleid.apple.com"]
        return allowed.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}

extension StageViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if isInApp(url) || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if ["http", "https"].contains(url.scheme ?? "") {
            present(SFSafariViewController(url: url), animated: true)
        } else {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    /// Reveal once the app has booted (it exposes window.__av). Neither
    /// navigation event is the right signal: `didFinish` waits for every
    /// preview image and font, many seconds after the stage is usable, and
    /// the page paints unstyled before its modules run. Polling starts when
    /// the page commits, capped so a slow device is never left covered.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        waitForBoot(deadline: Date().addingTimeInterval(8))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        revealStage()
    }

    private func waitForBoot(deadline: Date) {
        guard cover.superview != nil else { return }
        webView.evaluateJavaScript("!!window.__av") { [weak self] value, error in
            guard let self else { return }
            #if DEBUG
            NSLog("AV boot check: %@ %@", String(describing: value), String(describing: error))
            #endif
            if (value as? Bool) == true || Date() > deadline {
                self.revealStage()
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.waitForBoot(deadline: deadline) }
            }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        if usingLocal || !LocalWebScheme.isAvailable { revealStage() } else { fallBackToLocal() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        revealStage()
    }

    /// WebKit can kill a backgrounded content process to reclaim memory;
    /// reload instead of leaving a blank stage.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
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
        if let url = action.request.url, !isInApp(url), url.absoluteString != "about:blank" {
            present(SFSafariViewController(url: url), animated: true)
            return nil
        }
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.uiDelegate = self
        let sheet = PopupViewController(webView: child)
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
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        (presentedViewController ?? self).present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        (presentedViewController ?? self).present(alert, animated: true)
    }
}

/// Sheet hosting a sign-in popup with a Done button.
final class PopupViewController: UIViewController {
    private let webView: WKWebView
    init(webView: WKWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let bar = UINavigationBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        let item = UINavigationItem(title: "Sign in")
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
