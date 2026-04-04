# Cornelsen — Bücher als PDF und Markdown exportieren

Entschlüsselt offline heruntergeladene Schulbücher aus der Cornelsen Offline Lernen Desktop-App und erzeugt PDFs, Klartext-/Markdown-Dateien und Zusatzmaterialien.
Kein OCR — die Buchtexte werden direkt aus dem entschlüsselten PDF extrahiert. Keine Zugangsdaten nötig, es werden nur die lokal heruntergeladenen Dateien gelesen.
Die Markdown-Ausgabe eignet sich besonders gut zur Weiterverarbeitung durch KI-Modelle.

## Voraussetzungen

- Cornelsen Offline Lernen Desktop-App mit mindestens einem offline heruntergeladenen Buch
  - macOS: `https://ebook.cornelsen.de/uma20/public/v2/uma/offline/mac`
  - Windows: `https://ebook.cornelsen.de/uma20/public/v2/uma/offline/win`

## Download (empfohlen)

Unter [Releases](../../releases) stehen fertige Executables zum Download — keine Installation von Python oder Node.js nötig:

- **macOS**: `cornelsen-macos.zip` — entpacken, dann im Terminal `./cornelsen` ausführen
- **Windows**: `cornelsen.exe` — direkt ausführen oder ins Terminal ziehen

### macOS: Gatekeeper-Warnung

macOS blockiert unsignierte Programme. Beim ersten Start:

1. Doppelklick auf `cornelsen` → "kann nicht geöffnet werden" Meldung
2. **Systemeinstellungen → Datenschutz & Sicherheit** → nach unten scrollen
3. Bei "cornelsen wurde blockiert" auf **Trotzdem öffnen** klicken

Alternativ im Terminal: `xattr -cr cornelsen && ./cornelsen`

### Windows: SmartScreen-Warnung

Beim ersten Start erscheint "Der Computer wurde durch Windows geschützt":

1. Auf **Weitere Informationen** klicken
2. **Trotzdem ausführen** klicken

## Alternative: Python oder Node.js

### uv (Python)

```bash
# uv installieren (macOS / Linux)
curl -LsSf https://astral.sh/uv/install.sh | sh

# uv installieren (Windows)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Ausführen — uv installiert Python und Dependencies (PyMuPDF, cryptography) automatisch
uv run cornelsen.py
```

### Node.js

```bash
npm install && node cornelsen.js
```

## Optionen

| Flag | Beschreibung |
|------|-------------|
| `--output <dir>` | Ausgabeverzeichnis (Standard: `./books`) |
| `--book <id>` | Nur ein bestimmtes Buch (usageProductId) |
| `--no-materials` | Ohne Zusatzmaterialien |
| `--markdown` | Volltext als .md statt .txt |
| `--force` | Vorhandene Bücher überschreiben |

## Ausgabe

```text
books/
  Buchtitel (ISBN)/
    Buchtitel.pdf          — Entschlüsseltes Buch-PDF (druckfähig)
    Buchtitel.txt          — Klartext aller Seiten
    Zusatzmaterial.md      — Übersicht Zusatzmaterialien
    Zusatzmaterial/
      Tipps.md             — Alle Aufgaben-Tipps (sortiert nach Seite)
      pdf/                 — Zusätzliche PDFs (Operatoren etc.)
```

## Wie funktioniert es?

Die Cornelsen Offline Lernen App ist eine Electron-App, die Bücher als ZIP-Paare speichert:

1. **UMA-ZIP** — Buch-PDF (AES-128-CBC verschlüsselt), Metadaten (`uma.json`)
2. **Data-ZIP** — Zusatzmaterial: HTML-Tipps, Videos, Audio, Thumbnails
3. **Entschlüsselung** — AES-128-CBC (Schlüssel hardcoded in der Electron-App)
4. **Textextraktion** — Seitentext via PyMuPDF aus dem entschlüsselten PDF

## Plattform-Unterstützung

| Plattform | Cornelsen-Daten |
|---|---|
| macOS | `/Applications/CornelsenOfflineLernen.app/Contents/Resources/uma/` |
| macOS (User) | `~/Applications/CornelsenOfflineLernen.app/Contents/Resources/uma/` |
| Windows (Download) | `%LOCALAPPDATA%\Programs\CornelsenOfflineLernen\resources\uma\` |
| Windows (MSI) | `%PROGRAMFILES%\CornelsenOfflineLernen\uma\` |
