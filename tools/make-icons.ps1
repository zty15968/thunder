# Generates the PWA / favicon PNGs. Requires Windows PowerShell + System.Drawing.
# Usage: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$S = 512
$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Deep-space background.
$bgRect = New-Object System.Drawing.Rectangle 0, 0, $S, $S
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect, '#101d38', '#04060d', 90
$g.FillRectangle($bg, $bgRect)

# Nebula glow.
for ($i = 12; $i -ge 1; $i--) {
  $r = 70 + $i * 17
  $a = [int](10 + (12 - $i) * 2.2)
  $c = [System.Drawing.Color]::FromArgb($a, 90, 150, 255)
  $br = New-Object System.Drawing.SolidBrush $c
  $g.FillEllipse($br, 256 - $r, 226 - $r, $r * 2, $r * 2)
  $br.Dispose()
}

# Orbital rings.
$ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(34, 130, 190, 255)), 6
$g.DrawEllipse($ringPen, 66, 66, 380, 380)
$ringPen.Dispose()
$ringPen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(18, 190, 225, 255)), 18
$g.DrawEllipse($ringPen2, 44, 44, 424, 424)
$ringPen2.Dispose()

# Stars (deterministic).
$rand = New-Object System.Random 7
for ($i = 0; $i -lt 42; $i++) {
  $x = $rand.Next(24, 488)
  $y = $rand.Next(24, 488)
  $r = 1 + $rand.NextDouble() * 1.8
  $a = 40 + $rand.Next(0, 150)
  $c = [System.Drawing.Color]::FromArgb($a, 220, 238, 255)
  $br = New-Object System.Drawing.SolidBrush $c
  $g.FillEllipse($br, $x, $y, $r * 2, $r * 2)
  $br.Dispose()
}

# Lightning bolt.
$pts = @(
  (New-Object System.Drawing.PointF 306, 58),
  (New-Object System.Drawing.PointF 166, 292),
  (New-Object System.Drawing.PointF 246, 292),
  (New-Object System.Drawing.PointF 202, 454),
  (New-Object System.Drawing.PointF 356, 214),
  (New-Object System.Drawing.PointF 272, 214),
  (New-Object System.Drawing.PointF 322, 58)
)
$bolt = New-Object System.Drawing.Drawing2D.GraphicsPath
$bolt.AddPolygon($pts)

# Bolt glow.
for ($i = 8; $i -ge 1; $i--) {
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb([int](10 + $i * 2), 255, 190, 70)), ($i * 5)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($pen, $bolt)
  $pen.Dispose()
}

$brBolt = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
  (New-Object System.Drawing.Rectangle 160, 55, 210, 405)), '#fff3a8', '#ff6a2a', 90
$g.FillPath($brBolt, $bolt)
$brBolt.Dispose()

$outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 48, 20, 4)), 9
$outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($outline, $bolt)
$outline.Dispose()

$shine = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 255, 255, 235)), 3
$shine.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($shine, $bolt)
$shine.Dispose()

# Rounded dark frame to keep the icon readable on light launchers.
$frame = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 120, 180, 255)), 4
$g.DrawRectangle($frame, 3, 3, 505, 505)
$frame.Dispose()

$bolt.Dispose()
$g.Dispose()

function Save-Scaled([string]$path, [int]$size) {
  $dst = New-Object System.Drawing.Bitmap $size, $size
  $dg = [System.Drawing.Graphics]::FromImage($dst)
  $dg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $dg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $dg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $dg.DrawImage($bmp, 0, 0, $size, $size)
  $dg.Dispose()
  $dst.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

Save-Scaled (Join-Path $outDir 'icon-512.png') 512
Save-Scaled (Join-Path $outDir 'icon-192.png') 192
Save-Scaled (Join-Path $outDir 'apple-touch-icon.png') 180
Save-Scaled (Join-Path $outDir 'favicon-32.png') 32
$bmp.Dispose()

Write-Host 'Icons written to' $outDir
