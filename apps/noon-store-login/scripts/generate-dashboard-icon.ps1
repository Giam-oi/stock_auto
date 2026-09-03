$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assetDirectory = Join-Path $root 'assets'
$iconPath = Join-Path $assetDirectory 'NoonDashboard.ico'
$previewPath = Join-Path $assetDirectory 'NoonDashboardIcon.png'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = New-Object System.Collections.Generic.List[byte[]]

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

foreach ($size in $sizes) {
  $scale = $size / 256.0
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $outer = New-RoundedPath (8 * $scale) (8 * $scale) (240 * $scale) (240 * $scale) (46 * $scale)
    $yellow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 196, 0))
    $graphics.FillPath($yellow, $outer)

    $panel = New-RoundedPath (30 * $scale) (28 * $scale) (196 * $scale) (200 * $scale) (30 * $scale)
    $charcoal = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 32, 33, 36))
    $graphics.FillPath($charcoal, $panel)

    $font = New-Object System.Drawing.Font 'Segoe UI', (104 * $scale), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString('N', $font, $white, (New-Object System.Drawing.RectangleF (38 * $scale), (22 * $scale), (180 * $scale), (142 * $scale)), $format)

    $colors = @(
      [System.Drawing.Color]::FromArgb(255, 245, 196, 0),
      [System.Drawing.Color]::FromArgb(255, 54, 179, 126),
      [System.Drawing.Color]::FromArgb(255, 75, 143, 232),
      [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
      [System.Drawing.Color]::FromArgb(255, 240, 104, 96),
      [System.Drawing.Color]::FromArgb(255, 116, 214, 185)
    )
    for ($index = 0; $index -lt 6; $index++) {
      $column = $index % 3
      $row = [math]::Floor($index / 3)
      $tile = New-RoundedPath ((55 + $column * 51) * $scale) ((158 + $row * 32) * $scale) (34 * $scale) (22 * $scale) (6 * $scale)
      $brush = New-Object System.Drawing.SolidBrush $colors[$index]
      $graphics.FillPath($brush, $tile)
      $brush.Dispose()
      $tile.Dispose()
    }

    if ($size -eq 256) { $bitmap.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png) }
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $images.Add($stream.ToArray())
    $stream.Dispose()

    $format.Dispose(); $font.Dispose(); $white.Dispose(); $charcoal.Dispose(); $yellow.Dispose(); $panel.Dispose(); $outer.Dispose()
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$file = [System.IO.File]::Create($iconPath)
$writer = New-Object System.IO.BinaryWriter $file
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$images.Count)
  $offset = 6 + (16 * $images.Count)
  for ($index = 0; $index -lt $images.Count; $index++) {
    $size = $sizes[$index]
    $dimension = if ($size -eq 256) { 0 } else { $size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$index].Length)
    $writer.Write([uint32]$offset)
    $offset += $images[$index].Length
  }
  foreach ($image in $images) { $writer.Write($image) }
} finally {
  $writer.Dispose()
  $file.Dispose()
}

Write-Output $iconPath
