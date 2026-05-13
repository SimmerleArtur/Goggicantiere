$ErrorActionPreference = "Stop"
$port = 8787
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-ContentType($file) {
  $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
  switch ($ext) {
    ".html" { "text/html; charset=utf-8"; break }
    ".css" { "text/css; charset=utf-8"; break }
    ".js" { "application/javascript; charset=utf-8"; break }
    ".json" { "application/json; charset=utf-8"; break }
    ".webmanifest" { "application/manifest+json; charset=utf-8"; break }
    ".png" { "image/png"; break }
    ".jpg" { "image/jpeg"; break }
    ".jpeg" { "image/jpeg"; break }
    ".svg" { "image/svg+xml; charset=utf-8"; break }
    ".txt" { "text/plain; charset=utf-8"; break }
    default { "application/octet-stream" }
  }
}

try {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$port/")
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "FEHLER: Der lokale Startserver konnte nicht gestartet werden." -ForegroundColor Red
  Write-Host "Mögliche Ursache: Port $port ist schon belegt oder Windows blockiert den lokalen Server."
  Write-Host "Details: $($_.Exception.Message)"
  Write-Host ""
  Write-Host "Notfall-Start: Du kannst auch direkt die Datei index.html im Ordner öffnen."
  pause
  exit 1
}

$url = "http://localhost:$port/index.html"
Write-Host "Goggicantiere läuft auf $url" -ForegroundColor Green
Write-Host "Zum Beenden dieses Fenster schließen."
Start-Process $url

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rawPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rawPath)) { $rawPath = 'index.html' }
    $safePath = $rawPath -replace '/', [IO.Path]::DirectorySeparatorChar
    $file = Join-Path $root $safePath

    if (!(Test-Path $file -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes("404 - Datei nicht gefunden")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
      $ctx.Response.Close()
      continue
    }

    $ctx.Response.ContentType = Get-ContentType $file
    $ctx.Response.Headers.Add("Cache-Control", "no-cache")
    $bytes = [IO.File]::ReadAllBytes($file)
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  } catch {
    try { if ($ctx) { $ctx.Response.Close() } } catch {}
  }
}
