#!/usr/bin/env node
/**
 * Extract books from Cornelsen Offline Lernen data.
 *
 * Reads the Cornelsen app container, decrypts the embedded PDF,
 * extracts page text via pdf.js, and exports supplementary materials
 * (HTML tips, additional PDFs).
 *
 * Usage: node bin/cornelsen [--output <dir>] [--book <id>]
 *                           [--no-materials] [--markdown] [--force]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createDecipheriv } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// -- pdf.js for text extraction (no system dependency) --
let pdfjsLib = null;
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pdfjsPath = join(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");
  if (existsSync(pdfjsPath)) {
    pdfjsLib = await import(pdfjsPath);
  }
} catch { /* pdfjs-dist not available */ }

// -- AES-128-CBC decryption (key assembled from app source) --
const CIPHER_B64 = "YWVzLTEyOC1jYmN8RCtEeEpTRn0yQjtrLTtDfQ==";

function decryptBuffer(encrypted) {
  const decoded = Buffer.from(CIPHER_B64, "base64").toString("ascii");
  const [algorithm, key] = decoded.split("|");
  const iv = key.split("").reverse().join("");
  const decipher = createDecipheriv(algorithm, key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// -- Path to Cornelsen app data --
function findCornelsenBase() {
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/CornelsenOfflineLernen.app/Contents/Resources/uma",
      join(homedir(), "Applications", "CornelsenOfflineLernen.app",
        "Contents", "Resources", "uma"),
    );
  } else if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const progFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const progFiles86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

    for (const base of [join(localApp, "Programs"), progFiles, progFiles86]) {
      // Download-Build: resources/uma/
      candidates.push(join(base, "CornelsenOfflineLernen", "resources", "uma"));
      // MSI-Build: uma/ direkt im App-Verzeichnis
      candidates.push(join(base, "CornelsenOfflineLernen", "uma"));
      // Alternativer Name mit Leerzeichen
      candidates.push(join(base, "Cornelsen Offline Lernen", "resources", "uma"));
      candidates.push(join(base, "Cornelsen Offline Lernen", "uma"));
    }
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

// -- Pure Node.js ZIP reader (no external tools) --

function readZipCentralDirectory(zipPath) {
  const buf = readFileSync(zipPath);

  // Find End of Central Directory (scan backwards for signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) return [];

  let cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);

  // Handle ZIP64: if cdOffset is 0xFFFFFFFF, look for ZIP64 EOCD locator
  if (cdOffset === 0xFFFFFFFF) {
    for (let i = eocdOffset - 20; i >= Math.max(0, eocdOffset - 40); i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) {
        const zip64EocdOffset = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(zip64EocdOffset) === 0x06064b50) {
          cdOffset = Number(buf.readBigUInt64LE(zip64EocdOffset + 48));
        }
        break;
      }
    }
  }

  const entries = [];
  let pos = cdOffset;

  while (pos < cdOffset + cdSize && pos + 46 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

    entries.push({ name, method, compSize, uncompSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return { entries, buf };
}

function extractZipEntry(zip, entry) {
  const { buf } = zip;
  const pos = entry.localOffset;
  if (buf.readUInt32LE(pos) !== 0x04034b50) return null;

  const nameLen = buf.readUInt16LE(pos + 26);
  const extraLen = buf.readUInt16LE(pos + 28);
  const dataStart = pos + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compSize);

  if (entry.method === 0) return compressed; // stored
  if (entry.method === 8) return inflateRawSync(compressed); // deflated
  return null; // unsupported method
}

// -- List ZIP entries --
function listZipEntries(zipPath) {
  try {
    const zip = readZipCentralDirectory(zipPath);
    return zip.entries || [];
  } catch {
    return [];
  }
}

// -- Extract single file from ZIP --
function unzipFile(zipPath, entryName) {
  try {
    const zip = readZipCentralDirectory(zipPath);
    const entry = zip.entries.find(e => e.name === entryName);
    if (!entry) return null;
    return extractZipEntry(zip, entry);
  } catch {
    return null;
  }
}

// -- Extract matching files from ZIP to temp directory --
function unzipFilesToDir(zipPath, pattern, destDir) {
  try {
    const zip = readZipCentralDirectory(zipPath);
    const re = new RegExp(pattern);
    const extracted = [];

    for (const entry of zip.entries) {
      if (!re.test(entry.name)) continue;
      const data = extractZipEntry(zip, entry);
      if (!data) continue;

      const dest = join(destDir, basename(entry.name));
      writeFileSync(dest, data);
      extracted.push(dest);
    }

    return extracted;
  } catch {
    return [];
  }
}

// -- Find all books (pairs of _uma.zip + _data.zip) --
function findBooks(basePath) {
  const books = [];
  for (const entry of readdirSync(basePath)) {
    if (entry.endsWith("_uma.zip")) {
      const id = entry.replace("_uma.zip", "");
      books.push({
        id,
        umaZip: join(basePath, entry),
        dataZip: existsSync(join(basePath, `${id}_data.zip`))
          ? join(basePath, `${id}_data.zip`)
          : null,
      });
    }
  }
  return books;
}

// -- Read uma.json from UMA zip --
function readUmaJson(umaZipPath) {
  const buf = unzipFile(umaZipPath, "uma.json");
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

// -- Find encrypted PDF entry in UMA zip --
function findPdfEntry(umaZipPath) {
  const entries = listZipEntries(umaZipPath);
  const pdf = entries.find(e => e.name.endsWith("_sf.pdf") || e.name.endsWith(".pdf"));
  return pdf ? pdf.name : null;
}

// -- Extract text via pdf.js --
async function extractPdfText(pdfPath) {
  if (!pdfjsLib) return null;
  try {
    const data = new Uint8Array(readFileSync(pdfPath));
    const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
    const pages = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push({ id: i, text: text.trim() });
    }

    await doc.destroy();
    return pages;
  } catch {
    return null;
  }
}

// -- Convert HTML to plain text --
function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// -- Main --
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const markdown = args.includes("--markdown");
  const noMaterials = args.includes("--no-materials");
  const bookFilter = args.includes("--book")
    ? args[args.indexOf("--book") + 1]
    : null;
  const outputDir = args.includes("--output")
    ? resolve(args[args.indexOf("--output") + 1])
    : join(process.cwd(), "books");

  const BASE = findCornelsenBase();

  if (!existsSync(BASE)) {
    console.error("Cornelsen Offline Lernen Daten nicht gefunden unter:", BASE);
    console.error("Ist die Cornelsen App installiert und ein Buch heruntergeladen?");
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const books = findBooks(BASE);
  if (books.length === 0) {
    console.error("Keine heruntergeladenen Bücher gefunden.");
    process.exit(1);
  }

  if (!pdfjsLib) {
    console.log("Hinweis: pdfjs-dist nicht installiert — nur PDF wird extrahiert, kein Text.");
    console.log("  npm install pdfjs-dist");
    console.log();
  }

  // Read metadata for all books
  console.log("Gefundene Bücher:");
  const umaCache = {};
  for (const book of books) {
    const uma = readUmaJson(book.umaZip);
    umaCache[book.id] = uma;
    console.log(`  ${uma?.title || book.id} (${book.id})`);
  }

  for (const book of books) {
    if (bookFilter && book.id !== bookFilter) continue;

    const uma = umaCache[book.id];
    const title = uma?.title || book.id;
    const isbn = uma?.isbnSb || "";

    console.log(`\n${title}:`);

    const baseName = title.replace(/[\/\\:*?"<>|]/g, "-");
    const dirName = isbn ? `${baseName} (${isbn})` : `${baseName} (${book.id})`;
    const bookDir = join(outputDir, dirName);

    const ext = markdown ? "md" : "txt";

    if (!force && existsSync(join(bookDir, `${baseName}.pdf`))) {
      console.log("  Bereits vorhanden, überspringe. (--force zum Überschreiben)");
      continue;
    }

    mkdirSync(bookDir, { recursive: true });

    // -- Decrypt and extract PDF --
    const pdfEntry = findPdfEntry(book.umaZip);

    if (pdfEntry) {
      console.log("  PDF entschlüsseln...");
      const encrypted = unzipFile(book.umaZip, pdfEntry);

      if (encrypted) {
        try {
          const decrypted = decryptBuffer(encrypted);
          const destPdf = join(bookDir, `${baseName}.pdf`);
          writeFileSync(destPdf, decrypted);
          const sizeMB = (decrypted.length / 1024 / 1024).toFixed(1);
          console.log(`  PDF: ${sizeMB} MB -> ${destPdf}`);

          if (pdfjsLib) {
            console.log("  Text extrahieren...");
            const pages = await extractPdfText(destPdf);

            if (pages) {
              const nonEmpty = pages.filter(p => p.text);
              console.log(`  Text: ${nonEmpty.length}/${pages.length} Seiten`);

              const outPath = join(bookDir, `${baseName}.${ext}`);
              let content = "";

              if (markdown) {
                content = `# ${title}\n\n`;
                for (const p of pages) {
                  if (!p.text) continue;
                  content += `## Seite ${p.id}\n\n${p.text}\n\n`;
                }
              } else {
                for (const p of pages) {
                  content += `--- Seite ${p.id} ---\n${p.text}\n\n`;
                }
              }

              writeFileSync(outPath, content, "utf8");
              console.log(`  -> ${outPath}`);
            }
          }
        } catch (e) {
          console.error(`  Entschlüsselung fehlgeschlagen: ${e.message}`);
        }
      }
    } else {
      console.log("  Kein PDF im UMA-Archiv gefunden.");
    }

    // -- Export supplementary materials --
    if (!noMaterials && book.dataZip) {
      const entries = listZipEntries(book.dataZip);
      const htmlEntries = entries.filter(e => e.name.endsWith(".html"));
      const pdfEntries = entries.filter(e => e.name.endsWith(".pdf"));

      const totalMat = htmlEntries.length + pdfEntries.length;

      if (totalMat > 0) {
        console.log(`  Materialien: ${htmlEntries.length} Tipps, ${pdfEntries.length} PDFs`);
        const matDir = join(bookDir, "Zusatzmaterial");
        mkdirSync(matDir, { recursive: true });

        // Extract HTML tips into single Tipps.md
        if (htmlEntries.length > 0) {
          // Build elvisId -> asset metadata map from uma.json
          const assetMap = {};
          if (uma?.assets) {
            for (const a of uma.assets) {
              const key = a.elvisId || basename(a.fileName || "", ".html");
              if (key) assetMap[key] = a;
            }
          }

          try {
            const zip = readZipCentralDirectory(book.dataZip);

            // Sort by page number from metadata, then by filename
            const sorted = htmlEntries.slice().sort((a, b) => {
              const idA = basename(a.name, ".html");
              const idB = basename(b.name, ".html");
              const pageA = parseInt(assetMap[idA]?.pageFrom) || 9999;
              const pageB = parseInt(assetMap[idB]?.pageFrom) || 9999;
              return pageA - pageB || idA.localeCompare(idB);
            });

            let md = `# Tipps — ${title}\n\n`;
            md += `${sorted.length} Aufgaben-Tipps.\n\n`;
            let converted = 0;

            for (const entry of sorted) {
              const zipEntry = zip.entries.find(e => e.name === entry.name);
              if (!zipEntry) continue;
              const buf = extractZipEntry(zip, zipEntry);
              if (!buf) continue;

              const html = buf.toString("utf8");
              const text = htmlToText(html);
              if (!text) continue;

              const elvisId = basename(entry.name, ".html");
              const meta = assetMap[elvisId];
              const page = meta?.pageFrom ? `Seite ${meta.pageFrom}` : "";
              const sub = meta?.subtitleHere || "";
              const heading = [page, sub].filter(Boolean).join(" — ") || elvisId;

              md += `## ${heading}\n\n${text}\n\n---\n\n`;
              converted++;
            }

            writeFileSync(join(matDir, "Tipps.md"), md, "utf8");
            console.log(`  -> ${converted} Tipps in Tipps.md zusammengefasst`);
          } catch (e) {
            console.error(`  Tipp-Extraktion fehlgeschlagen: ${e.message}`);
          }
        }

        // Extract non-encrypted PDFs from data zip and convert to markdown
        if (pdfEntries.length > 0) {
          let converted = 0;

          for (const entry of pdfEntries) {
            const buf = unzipFile(book.dataZip, entry.name);
            if (!buf || buf[0] !== 0x25) continue; // not %PDF

            const name = basename(entry.name, ".pdf");
            const tmpPath = join(tmpdir(), `cornelsen_mat_${name}.pdf`);
            writeFileSync(tmpPath, buf);

            const pages = await extractPdfText(tmpPath);
            try { rmSync(tmpPath, { force: true }); } catch {}

            if (pages) {
              const nonEmpty = pages.filter(p => p.text);
              if (nonEmpty.length > 0) {
                let md = `# ${name}\n\n`;
                for (const p of nonEmpty) {
                  md += `${p.text}\n\n`;
                }
                writeFileSync(join(matDir, `${name}.md`), md, "utf8");
                converted++;
              }
            }
          }

          if (converted > 0) console.log(`  -> ${converted} Material-PDFs nach Markdown konvertiert`);
        }

        // Material index from uma.json assets
        if (uma?.assets) {
          let md = `# Zusatzmaterial — ${title}\n\n`;
          md += `Insgesamt ${uma.assets.length} Assets.\n\n`;

          const byType = {};
          for (const a of uma.assets) {
            const type = a.assetType || "sonstige";
            (byType[type] ??= []).push(a);
          }

          for (const [type, items] of Object.entries(byType).sort()) {
            md += `## ${type} (${items.length})\n\n`;
            for (const a of items) {
              md += `- ${a.title || a.fileName || a.id}\n`;
            }
            md += "\n";
          }

          writeFileSync(join(bookDir, "Zusatzmaterial.md"), md, "utf8");
        }
      } else {
        console.log("  Kein Zusatzmaterial gefunden.");
      }
    }
  }

  console.log("\nFertig.");
}

main();
