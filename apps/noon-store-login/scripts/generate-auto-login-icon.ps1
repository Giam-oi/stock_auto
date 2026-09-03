$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assetDirectory = Join-Path $root 'assets'
$iconPath = Join-Path $assetDirectory 'NoonAutoLogin.ico'
$previewPath = Join-Path $assetDirectory 'NoonAutoLoginIcon.png'
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
    $teal = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 118, 110))
    $graphics.FillPath($teal, $outer)

    $panel = New-RoundedPath (27 * $scale) (27 * $scale) (202 * $scale) (202 * $scale) (34 * $scale)
    $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 19, 43, 47))
    $graphics.FillPath($dark, $panel)

    $yellowColor = [System.Drawing.Color]::FromArgb(255, 245, 196, 0)
    $shackle = New-Object System.Drawing.Pen $yellowColor, (22 * $scale)
    $shackle.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $shackle.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawArc($shackle, (76 * $scale), (43 * $scale), (104 * $scale), (106 * $scale), 180, 180)

    $body = New-RoundedPath (50 * $scale) (91 * $scale) (156 * $scale) (123 * $scale) (27 * $scale)
    $yellow = New-Object System.Drawing.SolidBrush $yellowColor
    $graphics.FillPath($yellow, $body)

    $font = New-Object System.Drawing.Font 'Segoe UI', (72 * $scale), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString('N', $font, $dark, (New-Object System.Drawing.RectangleF (62 * $scale), (96 * $scale), (132 * $scale), (78 * $scale)), $format)

    $dotColors = @(
      [System.Drawing.Color]::White,
      [System.Drawing.Color]::FromArgb(255, 54, 179, 126),
      [System.Drawing.Color]::White,
      [System.Drawing.Color]::FromArgb(255, 75, 143, 232),
      [System.Drawing.Color]::White,
      [System.Drawing.Color]::FromArgb(255, 54, 179, 126)
    )
    for ($index = 0; $index -lt 6; $index++) {
      $brush = New-Object System.Drawing.SolidBrush $dotColors[$index]
      $graphics.FillEllipse($brush, ((68 + $index * 22) * $scale), (178 * $scale), (12 * $scale), (12 * $scale))
      $brush.Dispose()
    }

    if ($size -eq 256) { $bitmap.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png) }
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $images.Add($stream.ToArray())
    $stream.Dispose()

    $format.Dispose(); $font.Dispose(); $yellow.Dispose(); $body.Dispose(); $shackle.Dispose(); $dark.Dispose(); $panel.Dispose(); $teal.Dispose(); $outer.Dispose()
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
