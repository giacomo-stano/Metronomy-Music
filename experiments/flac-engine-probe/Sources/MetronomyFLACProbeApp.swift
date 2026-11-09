import SwiftUI
import UniformTypeIdentifiers
import AudioStreaming

@MainActor
final class FLACProbeModel: ObservableObject {
    @Published var sourceURL: String = ""
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var state: String = "Non avviato"
    @Published private(set) var firstSoundCandidate: String = "—"
    @Published private(set) var errorMessage: String = ""
    @Published private(set) var requestedSeek: Double = 0
    @Published private(set) var secondsBeyondDuration: Double = 0
    @Published private(set) var wallElapsed: Double = 0

    private let player = AudioPlayer()
    private var timer: Timer?
    private var startedAt: Date?
    private var initialProgressObserved = false
    private var localCopy: URL?

    init() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        let nativeDuration = player.duration
        let nativeProgress = player.progress
        duration = nativeDuration.isFinite && nativeDuration > 0 ? nativeDuration : 0
        position = nativeProgress.isFinite && nativeProgress >= 0 ? nativeProgress : 0
        state = String(describing: player.state)
        secondsBeyondDuration = duration > 0 ? max(0, position - duration) : 0
        if let startedAt {
            wallElapsed = Date().timeIntervalSince(startedAt)
        }
        if !initialProgressObserved && position > 0, let startedAt {
            // First observed progress is not an acoustic measurement.
            initialProgressObserved = true
            firstSoundCandidate = String(format: "%.2f s (primo progresso)", Date().timeIntervalSince(startedAt))
        }
    }

    func play() {
        guard let url = URL(string: sourceURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else {
            errorMessage = "Inserisci un URL HTTP(S) o importa un FLAC locale."
            return
        }
        errorMessage = ""
        player.stop()
        initialProgressObserved = false
        firstSoundCandidate = "—"
        position = 0
        startedAt = Date()
        player.play(url: url)
        refresh()
    }

    func pause() { player.pause(); refresh() }
    func resume() { player.resume(); refresh() }
    func stop() {
        player.stop()
        startedAt = nil
        refresh()
    }

    func seek(_ fraction: Double) {
        guard duration > 0 else { return }
        requestedSeek = min(duration, max(0, fraction * duration))
        player.seek(to: requestedSeek)
        refresh()
    }

    func importFile(_ input: URL) {
        let access = input.startAccessingSecurityScopedResource()
        defer { if access { input.stopAccessingSecurityScopedResource() } }
        do {
            let target = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString + ".flac")
            try FileManager.default.copyItem(at: input, to: target)
            // Keep a private copy so the document picker can release its security scope.
            if let previous = localCopy { try? FileManager.default.removeItem(at: previous) }
            localCopy = target
            sourceURL = target.absoluteString
            errorMessage = ""
        } catch {
            errorMessage = "Importazione locale non riuscita: \(error.localizedDescription)"
        }
    }
}

struct ContentView: View {
    @StateObject private var model = FLACProbeModel()
    @State private var importFile = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Motore alternativo: AudioStreaming")
                        .font(.headline)
                    Text("Prototipo separato da Metronomy. Non usa expo-audio/AVPlayer per la riproduzione.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    TextField("URL HTTP(S) del FLAC, con token già incluso", text: $model.sourceURL, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.URL)
                        .lineLimit(2...4)
                        .padding(10)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 9))
                    Button("Importa FLAC dall'app File") { importFile = true }
                    HStack {
                        Button("Riproduci") { model.play() }.buttonStyle(.borderedProminent)
                        Button("Pausa") { model.pause() }.buttonStyle(.bordered)
                        Button("Riprendi") { model.resume() }.buttonStyle(.bordered)
                        Button("Stop") { model.stop() }.buttonStyle(.bordered)
                    }
                    .font(.caption)
                    Divider()
                    Text("Durata nativa: \(format(model.duration)) s")
                    Text("Posizione nativa: \(format(model.position)) s")
                    Text("Posizione seek richiesta: \(format(model.requestedSeek)) s")
                    Text("Oltre la durata: \(format(model.secondsBeyondDuration)) s")
                    Text("Stato player: \(model.state)")
                    Text("Tempo dall'avvio: \(format(model.wallElapsed)) s")
                    Text("Primo avanzamento: \(model.firstSoundCandidate)")
                    if !model.errorMessage.isEmpty {
                        Text(model.errorMessage).foregroundStyle(.red)
                    }
                    HStack {
                        Button("Seek 50%") { model.seek(0.5) }
                        Spacer()
                        Button("Seek 94%") { model.seek(0.94) }
                        Spacer()
                        Button("Seek 99%") { model.seek(0.99) }
                    }
                    .buttonStyle(.bordered)
                    .font(.caption)
                    ProgressView(value: min(model.duration, model.position), total: max(1, model.duration))
                    Text("La posizione nativa non viene limitata alla durata nei valori diagnostici. Il player non viene fermato automaticamente quando raggiunge il 100%.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("FLAC Probe")
            .fileImporter(isPresented: $importFile, allowedContentTypes: [.audio, .data]) { result in
                switch result {
                case .success(let url): model.importFile(url)
                case .failure: break
                }
            }
        }
    }

    private func format(_ value: Double) -> String {
        value.isFinite ? String(format: "%.3f", value) : "—"
    }
}

@main
struct MetronomyFLACProbeApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
