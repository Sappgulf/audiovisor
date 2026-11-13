import UIKit
import AVFoundation

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        configureAudioSession()
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Stage", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    /// Playback keeps a loaded track going with the screen locked or the app
    /// in the background (UIBackgroundModes: audio). It mixes politely with
    /// other apps only until AUDIOVISOR itself starts playing.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
    }

}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.backgroundColor = Stage.background
        window.rootViewController = StageViewController()
        window.makeKeyAndVisible()
        self.window = window
    }

    // A visualizer is watched, not touched: don't let the screen dim mid-song.
    func sceneDidBecomeActive(_ scene: UIScene) { UIApplication.shared.isIdleTimerDisabled = true }
    func sceneWillResignActive(_ scene: UIScene) { UIApplication.shared.isIdleTimerDisabled = false }
}

enum Stage {
    /// Matches --bg in src/style.css so launch, load and page share one colour.
    static let background = UIColor(red: 0.031, green: 0.027, blue: 0.043, alpha: 1)
    static let liveURL = URL(string: "https://audiovisor-one.vercel.app/")!
    static let liveHost = "audiovisor-one.vercel.app"
    static let localScheme = "audiovisor-local"
    static let localURL = URL(string: "\(localScheme)://app/index.html")!
}
