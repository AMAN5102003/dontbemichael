'use strict';

/**
 * Reading scans and photos on Windows, with the OCR built into Windows (winOcr.ts).
 *
 * The bug this guards: on Windows a scanned receipt or contract was refused
 * ("scans can only be read on a Mac") and a photo was stored with no text, so
 * nobody on the team could find it. The Windows cases use real fixtures: text
 * drawn into a PNG, and a PDF whose pages are only pictures, like a scanner's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');
const { onWindows, posixOnly } = require('./platform.cjs');

const { winOcr, linesInReadingOrder } = loadTs('src/main/winOcr.ts');
const { extractDocumentText } = loadTs('src/main/docText.ts');
const kg = require('../src/main/kg-core.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'win ocr '));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ─── Reading order (every platform) ──────────────────────────────────────────

const line = (text, x, y, h = 20, w = 100) => ({ text, x, y, w, h });

test('a price in its own column joins the item on its row', () => {
  // Windows reports text blocks: every item name first, then every price.
  const text = linesInReadingOrder([
    line('CORNER CAFE', 40, 30),
    line('Oat latte x2', 40, 100),
    line('Blueberry muffin', 40, 170),
    line('9.00', 600, 102),
    line('3.75', 600, 168)
  ]);
  assert.equal(text, 'CORNER CAFE\nOat latte x2 9.00\nBlueberry muffin 3.75');
});

test('lines on different rows stay on their own lines, top to bottom', () => {
  const text = linesInReadingOrder([line('second', 40, 60), line('first', 40, 20), line('third', 40, 100)]);
  assert.equal(text, 'first\nsecond\nthird');
});

test('empty lines and lines with no height are dropped', () => {
  assert.equal(linesInReadingOrder([line('  ', 0, 0), line('kept', 0, 40), line('flat', 0, 80, 0)]), 'kept');
  assert.equal(linesInReadingOrder([]), '');
});

test('winOcr reports unsupported away from Windows', posixOnly('winOcr is Windows only'), async () => {
  assert.deepEqual(await winOcr(path.join(tmp, 'any.png'), 'image'), { ok: false, reason: 'unsupported' });
});

// ─── Windows: real images and scans ──────────────────────────────────────────

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Whether this Windows has OCR for one of the user's languages (a Server image may not). */
function hasOcrLanguage() {
  if (!onWindows) return false;
  try {
    const out = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]; ' +
      'if ($null -eq [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()) { "no" } else { "yes" }'], { encoding: 'utf8' });
    return out.trim() === 'yes';
  } catch {
    return false;
  }
}

const winSkip = !onWindows
  ? 'Windows only: reads with the OCR built into Windows'
  : !hasOcrLanguage()
    ? 'this Windows has no OCR language for the user profile, so there is nothing to read with'
    : false;

/** Draws one line of text into a white image. `format` is png or jpeg. */
function drawText(name, text, format = 'png') {
  const out = path.join(tmp, name);
  const script =
    'Add-Type -AssemblyName System.Drawing; ' +
    '$bmp = New-Object System.Drawing.Bitmap 1000, 220; $g = [System.Drawing.Graphics]::FromImage($bmp); ' +
    '$g.Clear([System.Drawing.Color]::White); $g.TextRenderingHint = "AntiAlias"; ' +
    '$font = New-Object System.Drawing.Font "Segoe UI", 30; ' +
    '$g.DrawString($env:FIXTURE_TEXT, $font, [System.Drawing.Brushes]::Black, 30, 80); ' +
    '$fmt = if ($env:FIXTURE_FORMAT -eq "jpeg") { [System.Drawing.Imaging.ImageFormat]::Jpeg } else { [System.Drawing.Imaging.ImageFormat]::Png }; ' +
    '$bmp.Save($env:FIXTURE_OUT, $fmt); $g.Dispose(); $bmp.Dispose(); "ok"';
  const res = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, FIXTURE_TEXT: text, FIXTURE_OUT: out, FIXTURE_FORMAT: format }
  }).trim();
  assert.equal(res, 'ok', 'fixture image written');
  return out;
}

/** A PDF with one picture per page and no text layer, as a scanner writes it. */
function jpegsToPdf(name, jpegs) {
  const objects = [];
  const pageIds = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pages = add(null);
  for (const file of jpegs) {
    const jpg = fs.readFileSync(file);
    let i = 2, w = 0, h = 0;
    while (i < jpg.length) {
      const marker = jpg[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3) { h = jpg.readUInt16BE(i + 5); w = jpg.readUInt16BE(i + 7); break; }
      i += 2 + jpg.readUInt16BE(i + 2);
    }
    const pw = 612, ph = Math.round((612 * h) / w);
    const image = add([`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
    const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    const content = add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let size = parts[0].length;
  objects.forEach((body, n) => {
    offsets.push(size);
    for (const piece of [`${n + 1} 0 obj\n`, ...[].concat(body), '\nendobj\n']) {
      const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece, 'latin1');
      parts.push(buf);
      size += buf.length;
    }
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  const out = path.join(tmp, name);
  fs.writeFileSync(out, Buffer.concat(parts));
  return out;
}

test('a photo of a sign or receipt: its words become searchable text', { skip: winSkip }, async () => {
  const r = await extractDocumentText(drawText('receipt.png', 'Catering deposit is 50 percent'));
  assert.equal(r.kind, 'text');
  assert.equal(r.extractor, 'windows-ocr@1');
  assert.match(r.text, /Catering deposit is 50 percent/);
});

test('a photo with no writing is still stored, not refused', { skip: winSkip }, async () => {
  const r = await extractDocumentText(drawText('blank.png', ''));
  assert.equal(r.kind, 'passthrough', 'kg-core keeps the file and indexes its name');
});

test('a scanned PDF (pages are pictures, no text layer) is read page by page', { skip: winSkip }, async () => {
  const scan = jpegsToPdf('signed contract.pdf', [
    drawText('p1.jpg', 'Deposit due 7 days before the event', 'jpeg'),
    drawText('p2.jpg', 'We deliver within 15 miles', 'jpeg')
  ]);
  const r = await extractDocumentText(scan);
  assert.equal(r.kind, 'text');
  assert.equal(r.extractor, 'windows-ocr@1', 'read by OCR, not a text layer');
  assert.match(r.text, /^Page 1\n.*Deposit due 7 days before the event/s);
  assert.match(r.text, /Page 2\n.*We deliver within 15 miles/s);
});

test('a scan past the page limit says so', { skip: winSkip }, async () => {
  const scan = jpegsToPdf('long scan.pdf', [drawText('l1.jpg', 'First page', 'jpeg'), drawText('l2.jpg', 'Second page', 'jpeg')]);
  const r = await winOcr(scan, 'pdf', 1);
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 1);
  assert.equal(r.truncated, true);
});

test('a file name is only ever a name, never a command', { skip: winSkip }, async () => {
  // Run as a command, the name would create this file in PowerShell's working folder.
  const marker = 'dbm-ocr-name-ran';
  const odd = drawText(`odd $(New-Item ${marker}) ; name.png`, 'Opening hours are 9 to 5');
  const r = await extractDocumentText(odd);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /Opening hours are 9 to 5/);
  for (const dir of [process.cwd(), tmp]) {
    assert.equal(fs.existsSync(path.join(dir, marker)), false, 'nothing in the name ran');
  }
});

test('end to end: a scanned document is findable after ingest', { skip: winSkip }, async () => {
  const root = path.join(tmp, 'kg-ocr');
  const src = jpegsToPdf('scan.pdf', [drawText('s.jpg', 'Health inspection passed in March', 'jpeg')]);
  const ex = await extractDocumentText(src);
  const { docId } = kg.ingest(root, { srcPath: src, text: ex.text, modality: ex.modality, extractor: ex.extractor, mime: ex.mime });
  const hits = kg.search(root, 'health inspection', { limit: 3 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].docId, docId);
});
