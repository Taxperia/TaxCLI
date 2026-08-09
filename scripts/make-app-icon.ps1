Add-Type -AssemblyName System.Drawing

$srcPath = (Resolve-Path (Join-Path $PSScriptRoot "..\src\logo.png")).Path
$dstPath = Join-Path (Split-Path $srcPath) "logo-icon.png"
$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$size = 256
$bg = [System.Drawing.Color]::FromArgb(255, 0x14, 0x14, 0x14)
$mid = [System.Drawing.Color]::FromArgb(255, 0x17, 0x17, 0x17)

$canvas = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear($bg)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $size, $size)
$g.Dispose()

for ($y = 0; $y -lt $size; $y++) {
  for ($x = 0; $x -lt $size; $x++) {
    $c = $canvas.GetPixel($x, $y)
    $l = ($c.R + $c.G + $c.B) / 3.0
    if ($l -lt 38) {
      # near-black original bg -> #141414
      $canvas.SetPixel($x, $y, $bg)
    } elseif ($l -lt 55) {
      # soft shadow zone -> #171717
      $canvas.SetPixel($x, $y, $mid)
    } else {
      # silhouette: lift mid-greys so dragon reads on dark chip
      $t = [Math]::Min(255, [int](70 + ($l - 40) * 1.85))
      $canvas.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $t, $t, $t))
    }
  }
}

$canvas.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
$src.Dispose()
$canvas.Dispose()
Write-Output "wrote $dstPath"
