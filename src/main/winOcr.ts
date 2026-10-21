/**
 * Reading text out of scans and photos, with the OCR built into Windows (F7).
 *
 * WHY THIS WAY. The same reasoning as macOcr.ts: use what the system ships
 * instead of bundling Tesseract. Windows 10 and 11 have an OCR engine
 * (Windows.Media.Ocr) and a PDF renderer (Windows.Data.Pdf), and Windows
 * PowerShell 5.1, on every such PC, reaches both. A receipt photo or a one page
 * scan reads in under a second, PowerShell start included.
 *
 * READING ORDER. Windows groups lines by text block, so a price column comes back
 * after every item name. The script reports each line with its box, and
 * linesInReadingOrder rejoins lines that share a row.
 *
 * SAFETY. The script is fixed text passed as an encoded command; the file path,
 * kind and page limit arrive as environment variables it reads as plain strings,
 * so `$(…)` or `;` in a file name does nothing. Only Windows; everywhere else
 * reports `unsupported`.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { MAX_OCR_PAGES, OCR_TIMEOUT_MS, type OcrResult } from './macOcr';

/** One recognised line and its box, in the pixels of the image Windows read. */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Prints JSON: { pages: OcrLine[][], truncated: boolean }, or { error: string }.
 * Reads DBM_OCR_KIND (image | pdf), DBM_OCR_PATH and DBM_OCR_MAX.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Write-Json($o) { [Console]::Out.Write((ConvertTo-Json -InputObject $o -Compress -Depth 6)) }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]

  # WinRT calls are async; AsTask turns each into a .NET task to wait on.
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
  $asTaskOp = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -match '^IAsyncOperation.1$' } | Select-Object -First 1
  $asTaskAction = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  function Wait-Op($op, [Type]$type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(); $t.Result }
  function Wait-Action($action) { $null = $asTaskAction.Invoke($null, @($action)).Wait() }

  # The owner's own languages; null when Windows has no OCR for any of them.
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { Write-Json @{ error = 'no-language' }; exit 0 }
  $limit = [double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

  function Read-Lines($stream) {
    $decoder = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    # A phone photo is turned upright, and one past the engine's size limit is scaled down to it.
    $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
    $longest = [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight)
    if ($longest -gt $limit) {
      $scale = $limit / $longest
      $transform.ScaledWidth = [uint32][Math]::Floor($decoder.PixelWidth * $scale)
      $transform.ScaledHeight = [uint32][Math]::Floor($decoder.PixelHeight * $scale)
    }
    $bitmap = Wait-Op ($decoder.GetSoftwareBitmapAsync(
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
      $transform,
      [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,
      [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Wait-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = New-Object System.Collections.ArrayList
    foreach ($line in $result.Lines) {
      $x1 = [double]::MaxValue; $y1 = [double]::MaxValue; $x2 = 0.0; $y2 = 0.0
      foreach ($word in $line.Words) {
        $r = $word.BoundingRect
        $x1 = [Math]::Min($x1, $r.X); $y1 = [Math]::Min($y1, $r.Y)
        $x2 = [Math]::Max($x2, $r.X + $r.Width); $y2 = [Math]::Max($y2, $r.Y + $r.Height)
      }
      if ($x2 -gt 0) { $null = $lines.Add(@{ text = $line.Text; x = $x1; y = $y1; w = $x2 - $x1; h = $y2 - $y1 }) }
    }
    return ,$lines
  }

  $kind = $env:DBM_OCR_KIND
  $max = [int]$env:DBM_OCR_MAX
  $file = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:DBM_OCR_PATH)) ([Windows.Storage.StorageFile])
  $pages = New-Object System.Collections.ArrayList
  $truncated = $false
  if ($kind -eq 'image') {
    $stream = Wait-Op ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $null = $pages.Add((Read-Lines $stream))
    $stream.Dispose()
  } else {
    $pdf = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    $count = [int]$pdf.PageCount
    $truncated = $count -gt $max
    for ($i = 0; $i -lt [Math]::Min($count, $max); $i++) {
      $page = $pdf.GetPage([uint32]$i)
      # Twice the page's own size (about 192 dpi), enough for small print, within the engine's limit.
      $scale = [Math]::Min(2.0, $limit / [Math]::Max($page.Size.Width, $page.Size.Height))
      $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $options.DestinationWidth = [uint32][Math]::Floor($page.Size.Width * $scale)
      $options.DestinationHeight = [uint32][Math]::Floor($page.Size.Height * $scale)
      $image = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      Wait-Action ($page.RenderToStreamAsync($image, $options))
      $null = $pages.Add((Read-Lines $image))
      $image.Dispose()
      $page.Dispose()
    }
  }
  Write-Json @{ pages = $pages; truncated = $truncated }
} catch {
  Write-Json @{ error = 'failed' }
  exit 1
}
`;

const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/** Windows PowerShell 5.1, by its full path so a `powershell.exe` earlier on PATH is never run. */
function powershellPath(): string {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Puts recognised lines back in reading order: top to bottom, and left to right
 * within a row. Lines whose vertical centres sit within half a line height of
 * each other are one row and are joined with a space.
 */
export function linesInReadingOrder(lines: OcrLine[]): string {
  const sorted = lines
    .filter((l) => l.text.trim() && l.h > 0)
    .map((l) => ({ ...l, cy: l.y + l.h / 2 }))
    .sort((a, b) => a.cy - b.cy);
  const rows: Array<{ cy: number; h: number; items: typeof sorted }> = [];
  for (const line of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(line.cy - row.cy) <= Math.min(line.h, row.h) / 2) row.items.push(line);
    else rows.push({ cy: line.cy, h: line.h, items: [line] });
  }
  return rows
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((l) => l.text.trim()).join(' '))
    .join('\n');
}

function isLine(v: unknown): v is OcrLine {
  const l = v as OcrLine;
  return !!l && typeof l.text === 'string' && [l.x, l.y, l.w, l.h].every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function winOcr(path: string, kind: 'image' | 'pdf', maxPages = MAX_OCR_PAGES): Promise<OcrResult> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    execFile(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT],
      {
        env: { ...process.env, DBM_OCR_KIND: kind, DBM_OCR_PATH: path, DBM_OCR_MAX: String(maxPages) },
        timeout: OCR_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      },
      (err, stdout) => {
        let parsed: { pages?: unknown; truncated?: unknown; error?: unknown } = {};
        try { parsed = JSON.parse(String(stdout)); } catch { /* reported below */ }
        if (parsed.error === 'no-language') { resolve({ ok: false, reason: 'no-language' }); return; }
        if (err) {
          resolve({ ok: false, reason: (err as NodeJS.ErrnoException & { killed?: boolean }).killed ? 'timeout' : 'failed' });
          return;
        }
        if (!Array.isArray(parsed.pages)) { resolve({ ok: false, reason: 'failed' }); return; }
        const pages = parsed.pages.map((p) => linesInReadingOrder(Array.isArray(p) ? p.filter(isLine) : []));
        resolve({ ok: true, pages, truncated: parsed.truncated === true, extractor: 'windows-ocr@1' });
      }
    );
  });
}
