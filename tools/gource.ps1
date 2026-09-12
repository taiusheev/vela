# Renders the Vela repository history as a Gource animation.
# Requires: gource (https://gource.io, Windows build on the GitHub releases page) and ffmpeg (https://ffmpeg.org) on PATH.
# Usage (from the repo root, PowerShell):  .\tools\gource.ps1            -> plays live
#                                          .\tools\gource.ps1 -Record    -> writes vela-gource.mp4 next to the repo

param([switch]$Record)

$repo = Split-Path -Parent $PSScriptRoot
$common = @(
  $repo,
  "--title", "Vela",
  "--seconds-per-day", "0.6",
  "--auto-skip-seconds", "0.5",
  "--file-idle-time", "0",
  "--max-files", "0",
  "--hide", "mouse,progress,filenames",
  "--key",
  "--bloom-multiplier", "0.6",
  "--background-colour", "131920",
  "--font-colour", "E6EAF0",
  "-1280x720"
)

if (-not (Get-Command gource -ErrorAction SilentlyContinue)) {
  Write-Host "gource is not installed. Download it from https://gource.io (Windows: the GitHub releases page) and add it to PATH."
  exit 1
}

if ($Record) {
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "ffmpeg is not installed. Download it from https://ffmpeg.org/download.html and add it to PATH."
    exit 1
  }
  $out = Join-Path $repo "vela-gource.mp4"
  & gource @common --stop-at-end -o - | ffmpeg -y -r 60 -f image2pipe -vcodec ppm -i - -vcodec libx264 -preset medium -pix_fmt yuv420p -crf 18 -threads 0 -bf 0 $out
  Write-Host "Written: $out"
} else {
  & gource @common
}
