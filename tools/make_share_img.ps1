Add-Type -AssemblyName System.Drawing

$W = 1080; $H = 1350
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

function C($a, $r, $gg, $b) { return [System.Drawing.Color]::FromArgb($a, $r, $gg, $b) }

# 背景渐变 蓝->紫
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$lg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (C 255 29 78 216), (C 255 124 58 237), 135)
$g.FillRectangle($lg, $rect)

$white = [System.Drawing.Brushes]::White
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'

# Logo 方块 + 链字
$logoRect = New-Object System.Drawing.Rectangle(72, 88, 124, 124)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (C 40 255 255 255)), $logoRect)
$g.DrawString([char]0x94FE, (New-Object System.Drawing.Font('Microsoft YaHei', 44, [System.Drawing.FontStyle]::Bold)), $white, $logoRect, $sf)

# 标题
$g.DrawString('单词接龙', (New-Object System.Drawing.Font('Microsoft YaHei', 82, [System.Drawing.FontStyle]::Bold)), $white, 72, 240)
$g.DrawString('WORD CHAIN', (New-Object System.Drawing.Font('Segoe UI', 36, [System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush (C 230 255 255 255)), 72, 350)

# 标签胶囊
$fTag = New-Object System.Drawing.Font('Microsoft YaHei', 28)
$tagTxt = '新词 · 接上词的末尾 2/3 个字母'
$tsz = $g.MeasureString($tagTxt, $fTag)
$tagRect = New-Object System.Drawing.Rectangle(72, 430, [int]$tsz.Width + 60, [int]$tsz.Height + 20)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (C 40 255 255 255)), $tagRect)
$g.DrawString($tagTxt, $fTag, $white, 102, 432)

# 特色行
function DrawFeat($y, $icon, $title, $desc) {
  $g.FillRectangle((New-Object System.Drawing.SolidBrush (C 26 255 255 255)), (New-Object System.Drawing.Rectangle(72, $y, 936, 156)))
  $icRect = New-Object System.Drawing.Rectangle(104, ($y + 44), 68, 68)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush (C 60 255 255 255)), $icRect)
  $g.DrawString($icon, (New-Object System.Drawing.Font('Microsoft YaHei', 30, [System.Drawing.FontStyle]::Bold)), $white, $icRect, $sf)
  $g.DrawString($title, (New-Object System.Drawing.Font('Microsoft YaHei', 32, [System.Drawing.FontStyle]::Bold)), $white, 210, ($y + 24))
  $g.DrawString($desc, (New-Object System.Drawing.Font('Microsoft YaHei', 23)), (New-Object System.Drawing.SolidBrush (C 215 255 255 255)), 210, ($y + 84))
}
DrawFeat 520 'AI' 'AI 权重操控 + 自主学习画像' '难度贴合你，优先喂你没见过的新词'
DrawFeat 700 '玩' '三种玩法' '人机对战 · 本地同屏 · 多设备联机房间'
DrawFeat 880 '账' '账号跨设备同步' '学习画像 / 对局记录 / 防疲劳 跟随账户'
DrawFeat 1060 '主' '4 套主题 · 零依赖' '原版 / 暖白 / 渐变 / 夜读 · 随时部署'

# 底部
$fF = New-Object System.Drawing.Font('Segoe UI', 22)
$github = 'github.com/laicz-007/word-chain-advanced'
$gsz = $g.MeasureString($github, $fF)
$g.DrawString($github, $fF, $white, 72, 1266)
$g.DrawString('MIT Licensed', $fF, $white, 1080 - 72 - [int]$gsz.Width + 260, 1266)

$out = Join-Path $PSScriptRoot '..\dist-store\单词接龙-分享图.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("已生成: " + $out)