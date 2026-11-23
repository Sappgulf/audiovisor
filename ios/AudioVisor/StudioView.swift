import SwiftUI

private let studioAccent = Color(red: 0.72, green: 0.65, blue: 1)
private let studioBackground = Color(red: 0.035, green: 0.035, blue: 0.055)

struct StudioView: View {
    @ObservedObject var model: StudioModel
    @State private var section = 0
    @State private var removing: LibraryTrack?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var heroTitleSize = 35.0

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header
                    Picker("Studio section", selection: $section) {
                        Text("Discover").tag(0)
                        Text("My music").tag(1)
                    }
                    .pickerStyle(.segmented)
                    if section == 0 { discover(wide: geometry.size.width > 700) }
                    else { library }
                }
                .padding(.horizontal, geometry.size.width > 700 ? 48 : 24)
                .padding(.top, 12)
                .padding(.bottom, 32)
                .frame(maxWidth: 1100)
                .frame(maxWidth: .infinity)
            }
            .background(studioBackground)
            .safeAreaInset(edge: .bottom, spacing: 0) { footer }
        }
        .accessibilityHidden(model.showLooks || model.showInfo)
        .foregroundStyle(.white)
        .tint(studioAccent)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $model.showLooks) { LooksView(model: model) }
        .sheet(isPresented: $model.showInfo) { info }
        .alert("Something needs attention", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .confirmationDialog("Remove this imported copy? Your original file will stay in Files.", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove from library", role: .destructive) { if let removing { model.remove(removing) }; removing = nil }
        }
        .task { await model.loadLibrary() }
        .onChange(of: model.tracks.count) { old, new in if new > old { section = 1 } }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: section)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image("LaunchMark").resizable().scaledToFit().frame(width: 34, height: 34).clipShape(.rect(cornerRadius: 9)).accessibilityHidden(true)
            Text("Audiovisor").font(.system(.title2, design: .rounded, weight: .bold)).tracking(-0.7)
            Spacer()
            Button { model.showInfo = true } label: {
                Image(systemName: "slider.horizontal.3").font(.body.weight(.medium)).frame(width: 44, height: 44)
                    .background(.white.opacity(0.06), in: Circle())
            }.accessibilityLabel("App information and help")
        }
    }

    private func discover(wide: Bool) -> some View {
        VStack(alignment: .leading, spacing: 26) {
            VStack(alignment: .leading, spacing: 8) {
                Text("SOUND, IN ANOTHER DIMENSION").font(.system(.caption2, design: .monospaced, weight: .medium)).tracking(1.7).foregroundStyle(studioAccent)
                Text("See what you hear.").font(.system(size: wide ? heroTitleSize * 1.48 : heroTitleSize, weight: .semibold, design: .rounded)).tracking(-1.8).fixedSize(horizontal: false, vertical: true)
            }
            ZStack(alignment: .bottomLeading) {
                LookArtwork(look: model.selectedLook)
                    .frame(height: wide ? 340 : 270)
                    .clipped()
                LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .center, endPoint: .bottom)
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SELECTED VISUAL").font(.system(.caption2, design: .monospaced)).tracking(1.6).foregroundStyle(.white.opacity(0.65))
                        Text(model.selectedLook.name).font(.title2.weight(.semibold))
                    }
                    Spacer()
                    Button { model.showLooks = true } label: {
                        Image(systemName: "square.grid.2x2").frame(width: 48, height: 48).background(.ultraThinMaterial, in: Circle())
                    }.accessibilityLabel("Browse all 24 visuals")
                }.padding(22)
            }
            .clipShape(.rect(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(.white.opacity(0.08)))
            VStack(spacing: 12) {
                Button { model.start() } label: {
                    HStack(spacing: 10) {
                        if model.busy { ProgressView().tint(.black) }
                        else { Image(systemName: model.hasTrack ? "waveform" : "play.fill") }
                        Text(model.hasTrack ? "Return to stage" : "Play the demo").fontWeight(.semibold)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                    }.padding(18).frame(maxWidth: .infinity).background(studioAccent, in: .rect(cornerRadius: 17)).foregroundStyle(.black)
                }.disabled(!model.ready || model.busy)
                Button { model.importMusic?() } label: {
                    Label("Import your music", systemImage: "plus").fontWeight(.medium).frame(maxWidth: .infinity).padding(16)
                        .background(.white.opacity(0.06), in: .rect(cornerRadius: 17))
                }.disabled(model.busy)
            }
            HStack(spacing: 7) {
                Image(systemName: "lock.shield")
                Text("On your device. In your own world.")
            }.font(.caption).foregroundStyle(.white.opacity(0.55)).frame(maxWidth: .infinity)
            HStack {
                Text("Find your frequency").font(.title3.weight(.semibold))
                Spacer()
                Button("View all") { model.showLooks = true }.font(.subheadline.weight(.medium)).frame(minHeight: 44)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(["nebula", "fluid", "city", "kaleido"], id: \.self) { id in
                        if let look = VisualLook.all.first(where: { $0.id == id }) {
                            Button { model.select(look) } label: {
                                VStack(alignment: .leading, spacing: 9) {
                                    LookArtwork(look: look).frame(width: 148, height: 112).clipped().clipShape(.rect(cornerRadius: 14))
                                        .overlay(alignment: .topTrailing) { if model.selectedLook.id == id { Image(systemName: "checkmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.black, studioAccent).padding(9) } }
                                    Text(look.name).font(.subheadline.weight(.medium))
                                    Text(look.category).font(.caption).foregroundStyle(.white.opacity(0.5))
                                }.frame(width: 148, alignment: .leading)
                            }.buttonStyle(.plain).accessibilityLabel("Select \(look.name)").accessibilityAddTraits(model.selectedLook.id == id ? .isSelected : [])
                        }
                    }
                }
            }.contentMargins(.bottom, 4)
        }
    }

    private var library: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Your collection").font(.largeTitle.bold()).tracking(-1)
                    Text("\(model.tracks.count) imported \(model.tracks.count == 1 ? "track" : "tracks") · available offline").font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Button { model.importMusic?() } label: { Image(systemName: "plus").frame(width: 44, height: 44).background(studioAccent.opacity(0.14), in: Circle()) }.accessibilityLabel("Import audio files").disabled(model.busy)
            }
            if model.tracks.isEmpty {
                VStack(spacing: 18) {
                    Image(systemName: "waveform.path").font(.system(size: 50, weight: .ultraLight)).foregroundStyle(studioAccent).padding(.bottom, 10)
                    Text("Make room for your sound.").font(.title3.weight(.semibold))
                    Text("Import audio from Files or iCloud Drive. Your originals stay where they are; a private copy lives here.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("Choose audio files") { model.importMusic?() }.buttonStyle(.borderedProminent).foregroundStyle(.black).controlSize(.large).disabled(model.busy)
                    Text("MP3 · M4A · WAV · FLAC · up to 100 MB per track").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.padding(.vertical, 65).frame(maxWidth: .infinity)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(model.tracks) { track in
                        HStack(spacing: 13) {
                            Button { model.start(track: track) } label: {
                                HStack(spacing: 13) {
                                    Image(systemName: "waveform").font(.title3).foregroundStyle(studioAccent).frame(width: 50, height: 54).background(studioAccent.opacity(0.1), in: .rect(cornerRadius: 12))
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(track.name).font(.body.weight(.medium)).lineLimit(2)
                                        Text(track.subtitle).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "play.fill").font(.caption).foregroundStyle(studioAccent)
                                }.padding(.vertical, 14).contentShape(Rectangle())
                            }.buttonStyle(.plain).disabled(!model.ready || model.busy).accessibilityLabel("Play \(track.name)")
                            Menu {
                                Button("Remove imported copy", role: .destructive) { removing = track }
                            } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }.accessibilityLabel("Options for \(track.name)")
                        }
                        Divider().overlay(.white.opacity(0.04))
                    }
                }
            }
            if model.busy { HStack { ProgressView(); Text("Preparing your music…").font(.subheadline) }.frame(maxWidth: .infinity) }
        }
    }

    @ViewBuilder private var footer: some View {
        if !model.ready {
            HStack(spacing: 12) {
                ProgressView()
                Text(model.startupSlow ? "Still preparing your stage…" : "Preparing your stage…").font(.subheadline)
                Spacer()
                Button("Retry") { model.retry?() }.frame(minHeight: 44)
            }.padding(.horizontal, 24).padding(.vertical, 8).background(.regularMaterial)
        } else if model.hasTrack {
            HStack(spacing: 14) {
                Image(systemName: "waveform").foregroundStyle(studioAccent)
                Button { model.start() } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.title.isEmpty ? "Your stage" : model.title).font(.subheadline.weight(.medium)).lineLimit(1)
                        Text(model.playing ? "Playing · Open stage" : "Paused · Open stage").font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain)
                Button { model.toggle() } label: { Image(systemName: model.playing ? "pause.fill" : "play.fill").frame(width: 48, height: 48) }.accessibilityLabel(model.playing ? "Pause playback" : "Resume playback")
            }.padding(.horizontal, 24).padding(.vertical, 10).background(.regularMaterial)
        }
    }

    private var info: some View {
        NavigationStack {
            List {
                Section {
                    Label("Built for getting lost in music", systemImage: "waveform")
                    Text("Import your audio, choose one of 24 visual worlds, and shape the color and sound from the stage controls. Double-tap the stage for an immersive view.")
                } header: { Text("Your personal visual instrument") }
                Section("Privacy") {
                    Text("Imported audio is copied into this app and analyzed on your device. It is never uploaded. No account, advertising or tracking is required.")
                    Text("Removing a track here deletes only the app’s copy. Your original in Files or iCloud Drive is unchanged.")
                    Link("Privacy policy", destination: Stage.liveURL.appending(path: "privacy.html"))
                }
                Section("Help") {
                    Text("No sound? Check the volume and your selected audio output. Protected streaming downloads cannot be imported. Use an unprotected audio file.")
                    Button("Reload visual engine") { model.showInfo = false; model.retry?() }
                    Link("Support website", destination: Stage.liveURL.appending(path: "support.html"))
                    Link("Contact support", destination: URL(string: "mailto:sappgulf@gmail.com")!)
                }
                Section { Text("Audiovisor \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")").foregroundStyle(.secondary) }
            }
            .navigationTitle("About Audiovisor")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { model.showInfo = false } } }
        }.preferredColorScheme(.dark)
    }
}

private struct LookArtwork: View {
    let look: VisualLook
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black
                if let image = look.image {
                    Image(uiImage: image).resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped()
                }
                else { Image(systemName: "waveform.path").font(.system(size: 60)).foregroundStyle(studioAccent) }
            }
        }.accessibilityHidden(true)
    }
}

private struct LooksView: View {
    @ObservedObject var model: StudioModel
    @State private var query = ""
    private var filtered: [VisualLook] { VisualLook.all.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.category.localizedCaseInsensitiveContains(query) } }
    var body: some View {
        NavigationStack {
            ScrollView {
                if filtered.isEmpty { ContentUnavailableView.search(text: query) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14)], spacing: 22) {
                    ForEach(filtered) { look in
                        Button { model.select(look) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                LookArtwork(look: look).frame(height: 132).clipped().clipShape(.rect(cornerRadius: 16))
                                    .overlay(alignment: .topTrailing) { if model.selectedLook.id == look.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(studioAccent).padding(10) } }
                                Text(look.name).font(.subheadline.weight(.medium)).foregroundStyle(.white)
                                Text(look.category).font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.plain).accessibilityLabel("Select \(look.name)").accessibilityAddTraits(model.selectedLook.id == look.id ? .isSelected : [])
                    }
                }.padding(20)
            }
            .background(studioBackground)
            .navigationTitle("Visual worlds")
            .searchable(text: $query, prompt: "Search 24 visuals")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { model.showLooks = false } } }
        }.preferredColorScheme(.dark).tint(studioAccent)
    }
}
