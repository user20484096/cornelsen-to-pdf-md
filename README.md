# cornelsen-to-pdf-md

Extrahiert offline heruntergeladene Schulbücher aus der **Cornelsen Offline Lernen** Desktop-App (macOS + Windows) als PDF + Text/Markdown.

## Was wird extrahiert?

- **PDF** — das eingebettete Buch-PDF (AES-128-CBC verschlüsselt, wird automatisch entschlüsselt)
- **Volltext** — Seitentext aus dem PDF als `.txt` (oder `.md` mit `--markdown`)
- **Zusatzmaterial** — Aufgaben-Tipps (.html → .md), zusätzliche PDFs (Operatoren etc.)

## Voraussetzungen

- **Node.js** >= 18 (siehe [Installation](#node-installieren))
- **Cornelsen Offline Lernen App** installiert, mindestens ein Buch **offline heruntergeladen**

## Installation

### Node.js

#### macOS

```bash
# Option 1: Homebrew (empfohlen)
brew install node

# Option 2: Installer von https://nodejs.org herunterladen (LTS-Version)
```

#### Windows

1. **https://nodejs.org** aufrufen
2. Die **LTS-Version** (grüner Button) herunterladen und installieren
3. Bei der Installation den Haken bei **"Add to PATH"** gesetzt lassen
4. Nach der Installation ein neues Terminal (CMD oder PowerShell) öffnen
5. Prüfen: `node --version` sollte `v18.x` oder höher anzeigen

Alternativ über **winget** (Windows 10/11):

```powershell
winget install OpenJS.NodeJS.LTS
```

### Abhängigkeiten

```bash
cd cornelsen-to-pdf-md
npm install
```

Dies installiert `pdfjs-dist` (Mozilla PDF.js) für die Textextraktion aus dem entschlüsselten PDF. Ohne `npm install` wird nur das PDF extrahiert, kein Text.

## Verwendung

### macOS (Terminal)

```bash
# In den Projektordner wechseln
cd cornelsen-to-pdf-md

# Alle Bücher extrahieren
node cornelsen.js

# Markdown statt Text
node cornelsen.js --markdown
```

#### Windows (PowerShell oder CMD)

```powershell
# In den Projektordner wechseln
cd cornelsen-to-pdf-md

# Alle Bücher extrahieren
node bin\cornelsen

# Markdown statt Text
node bin\cornelsen --markdown
```

Falls `node` nicht gefunden wird: Terminal schließen und neu öffnen (PATH wird erst nach Neustart der Shell geladen).

### Optionen

```
node cornelsen.js                         # Alle Bücher, Volltext als .txt
node cornelsen.js --markdown              # Volltext als .md statt .txt
node cornelsen.js --book 220062463        # Einzelnes Buch (ID aus der Ausgabe)
node cornelsen.js --output ./meinordner   # Ausgabeverzeichnis festlegen
node cornelsen.js --no-materials          # Ohne Zusatzmaterialien
node cornelsen.js --force                 # Vorhandene Dateien überschreiben
```

## Buch offline herunterladen

Bevor das Script funktioniert, muss das Buch in der Cornelsen Offline Lernen App offline verfügbar sein:

1. **Cornelsen Offline Lernen App** öffnen und einloggen
2. Buch auswählen
3. Auf **Herunterladen** klicken
4. Warten bis der Download abgeschlossen ist (kann bei großen Büchern mehrere Minuten dauern)
5. Erst dann das Script ausführen

## Ausgabestruktur

```
books/
└── Buchtitel (ISBN)/
    ├── Buchtitel.pdf              # Entschlüsseltes Buch-PDF (druckfähig)
    ├── Buchtitel.txt              # Volltext (Klartext, seitenweise)
    ├── Zusatzmaterial.md          # Index aller Materialien
    └── Zusatzmaterial/
        ├── Tipps.md               # Alle Aufgaben-Tipps (sortiert nach Seite)
        └── pdf/                   # Zusätzliche PDFs (Operatoren etc.)
```

Mit `--markdown` wird statt `Buchtitel.txt` eine `Buchtitel.md` erzeugt (mit Überschriften pro Seite).

## Datenpfade

Das Script sucht die Cornelsen-Daten automatisch am richtigen Ort:

| Plattform | Pfad |
|---|---|
| macOS | `/Applications/CornelsenOfflineLernen.app/Contents/Resources/uma/` |
| macOS (User) | `~/Applications/CornelsenOfflineLernen.app/Contents/Resources/uma/` |
| Windows (Download) | `%LOCALAPPDATA%\Programs\CornelsenOfflineLernen\resources\uma\` |
| Windows (MSI) | `%PROGRAMFILES%\CornelsenOfflineLernen\uma\` |

**Besonderheit:** Anders als bei anderen Verlagen speichert Cornelsen die heruntergeladenen Bücher **direkt im App-Verzeichnis**, nicht in einem separaten Datenordner.

Falls das Script den Pfad nicht findet, zeigt es den erwarteten Pfad in der Fehlermeldung an.

## Wie funktioniert es?

Die Cornelsen Offline Lernen App ist eine **Electron-App**, die Bücher als ZIP-Paare speichert:

| Datei | Inhalt |
|---|---|
| `{id}_uma.zip` | Buch-PDF (verschlüsselt), Metadaten (`uma.json`), Version |
| `{id}_data.zip` | Zusatzmaterial: HTML-Tipps, Videos, Audio, Thumbnails |

### Verschlüsselung

Das Buch-PDF innerhalb der UMA-ZIP-Datei ist mit **AES-128-CBC** verschlüsselt. Der Schlüssel ist im Quellcode der App hardcoded (in `dist_electron/utils/unzip.js` innerhalb des `app.asar`-Archivs). Das Script verwendet den gleichen Schlüssel zur Entschlüsselung.

| Inhalt | Verschlüsselt? |
|---|---|
| Buch-PDF (`*_sf.pdf` in UMA-ZIP) | Ja (AES-128-CBC) |
| `uma.json` (Metadaten) | Nein |
| HTML-Tipps (in DATA-ZIP) | Nein |
| Videos/Audio (in DATA-ZIP) | Nein |
| Zusatz-PDFs (in DATA-ZIP) | Nein |

### Metadaten (`uma.json`)

Die Datei `uma.json` innerhalb der UMA-ZIP enthält:

- **Titel und ISBN** des Buches
- **Inhaltsverzeichnis** mit Kapitelstruktur und Seitenzuordnung
- **Asset-Index** mit Verweisen auf alle Zusatzmaterialien (Videos, Tipps, Audio)
- **Seitenkoordinaten** für interaktive Hotspots (wo auf der Seite welches Material angezeigt wird)

### Textextraktion

Der Volltext wird seitenweise aus dem entschlüsselten PDF über `pdfjs-dist` (Mozilla PDF.js) extrahiert — reine JavaScript-Lösung, keine Systemabhängigkeit. Das PDF enthält einen vollständigen Text-Layer und ist durchsuchbar.

### Zusatzmaterial

- **HTML-Tipps**: Aufgaben-Hinweise für Schüler, als einfaches HTML mit inline-Base64-Bildern gespeichert. Werden nach Markdown konvertiert (Bilder entfernt, nur Text).
- **Videos** (`.mp4`): Erklärvideos — werden nicht extrahiert (zu groß, über die App abrufbar)
- **Audio** (`.mp3`): Worterklärungen — werden nicht extrahiert
- **Zusatz-PDFs**: Operatoren-Übersicht u.ä. — werden kopiert falls nicht verschlüsselt

## Bekannte Einschränkungen

- **Mathematische Formeln**: Komplexe Formeln werden als Unicode-Text extrahiert, Brüche und Wurzeln können schwer lesbar sein.
- **Bilder in Tipps**: Inline-Base64-Bilder in HTML-Tipps werden bei der Markdown-Konvertierung entfernt (nur Text).
- **Ohne `npm install`**: Falls `pdfjs-dist` nicht installiert ist, wird nur das PDF extrahiert, kein Text.
- **Windows-Pfade**: Die Windows-Pfaderkennung ist noch nicht vollständig getestet. Falls die App an einem unerwarteten Ort installiert ist, `--output` verwenden.
