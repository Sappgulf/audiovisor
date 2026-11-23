import XCTest

@MainActor
final class StudioUITests: XCTestCase {
    func testSavedVisualIsAvailableAfterRelaunch() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["Discover"].tap()
        let save = app.buttons["Save visual to favorites"]
        let remove = app.buttons["Remove visual from favorites"]
        if remove.exists { remove.tap() }
        save.tap()
        app.terminate()
        app.launch()
        app.buttons["Discover"].tap()
        XCTAssertTrue(remove.waitForExistence(timeout: 10))
        app.buttons["Browse all 24 visuals"].tap()
        app.switches["Favorites"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Select '")).firstMatch.exists)
    }

    func testPrivacyPolicyIsAccessibleFromNativeAppInformation() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["App information and help"].tap()
        let policy = app.descendants(matching: .any).matching(identifier: "Privacy policy").firstMatch
        XCTAssertTrue(policy.waitForExistence(timeout: 30))
        XCTAssertTrue(policy.isHittable, "The privacy policy must be directly accessible inside the app")
        capture(app, name: "Privacy policy in native About")
    }

    func testDiscoverDemoAndNativePlaybackControls() throws {
        let app = XCUIApplication()
        app.launch()
        app.buttons["Discover"].tap()
        let demo = app.buttons["Play the demo"]
        XCTAssertTrue(demo.waitForExistence(timeout: 60))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: demo)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 60), .completed)
        capture(app, name: "Discover")
        demo.tap()
        let home = app.buttons["Return to studio"]
        XCTAssertTrue(home.waitForExistence(timeout: 60))
        XCTAssertTrue(app.webViews.buttons["Pause"].waitForExistence(timeout: 30))
        capture(app, name: "Reactive stage")
        home.tap()
        let pause = app.buttons["Pause playback"]
        XCTAssertTrue(pause.waitForExistence(timeout: 30))
        pause.tap()
        XCTAssertTrue(app.buttons["Resume playback"].waitForExistence(timeout: 15))
        app.buttons["Browse all 24 visuals"].tap()
        capture(app, name: "Visual worlds")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("Metal")
        app.buttons["Select Fluid Metal"].tap()
        XCTAssertTrue(app.staticTexts["Fluid Metal"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native studio after visual selection"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testImportedAudioPersistsAndPlaysThroughBundledEngine() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest-seed-library"]
        app.launch()
        let music = app.buttons["Play night-voltage"]
        app.buttons["My music"].tap()
        XCTAssertTrue(music.waitForExistence(timeout: 30))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: music)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 120), .completed)
        app.terminate()
        app.launch()
        app.buttons["My music"].tap()
        XCTAssertTrue(music.waitForExistence(timeout: 30))
        let reenabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: music)
        XCTAssertEqual(XCTWaiter.wait(for: [reenabled], timeout: 60), .completed)
        let search = app.textFields["Search your music"]
        search.tap()
        search.typeText("unmatched-title")
        XCTAssertFalse(music.exists)
        app.buttons["Clear music search"].tap()
        XCTAssertTrue(music.exists)
        music.tap()
        XCTAssertTrue(app.webViews.buttons["Pause"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.webViews.staticTexts["night-voltage"].exists)
    }
}
