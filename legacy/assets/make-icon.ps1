Add-Type -AssemblyName System.Drawing

$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sizes  = @(16, 32, 48, 64, 128, 256)
$pngs   = @()

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # Fundo azul
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 29, 78, 216))
    $g.FillRectangle($bgBrush, 0, 0, $s, $s)
    $bgBrush.Dispose()

    # Texto LSP (só acima de 24px)
    if ($s -ge 24) {
        $fontSize  = [float]($s * 0.30)
        $font      = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $sf        = New-Object System.Drawing.StringFormat
        $sf.Alignment     = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
        $rect = New-Object System.Drawing.RectangleF(0, 0, $s, $s)
        $g.DrawString("LSP", $font, $textBrush, $rect, $sf)
        $font.Dispose()
        $textBrush.Dispose()
    }

    $out = Join-Path $outDir "tmp_${s}.png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += $out
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Gerado: $out"
}

# Montar ICO manualmente (formato ICO = header + directory + dados PNG)
$icoPath = Join-Path $outDir "icon.ico"
$stream  = [System.IO.File]::OpenWrite($icoPath)
$writer  = New-Object System.IO.BinaryWriter($stream)

$count = $pngs.Count
$pngData = @()
foreach ($p in $pngs) { $pngData += ,[System.IO.File]::ReadAllBytes($p) }

# ICO header: reserved=0, type=1, count
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$count)

# Cada entrada do directory ocupa 16 bytes
$offset = 6 + ($count * 16)
for ($i = 0; $i -lt $count; $i++) {
    $s    = $sizes[$i]
    $data = $pngData[$i]
    $w    = if ($s -ge 256) { 0 } else { [byte]$s }
    $h    = if ($s -ge 256) { 0 } else { [byte]$s }
    $writer.Write([byte]$w)         # width  (0 = 256)
    $writer.Write([byte]$h)         # height (0 = 256)
    $writer.Write([byte]0)          # color count
    $writer.Write([byte]0)          # reserved
    $writer.Write([uint16]1)        # color planes
    $writer.Write([uint16]32)       # bits per pixel
    $writer.Write([uint32]$data.Length)
    $writer.Write([uint32]$offset)
    $offset += $data.Length
}

foreach ($data in $pngData) { $writer.Write($data) }

$writer.Close()
$stream.Close()

# Limpar PNGs temporários
foreach ($p in $pngs) { Remove-Item $p -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "icon.ico gerado em: $icoPath" -ForegroundColor Green
Write-Host "Tamanhos: $($sizes -join ', ')px"
