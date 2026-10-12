# M0 服务端测试：启动本地服务并验证 HTTP 行为
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-server-tests.ps1
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pass = 0; $fail = 0
function Check($name, $cond, $detail) {
  if ($cond) { Write-Host "PASS  $name"; $script:pass++ }
  else { Write-Host "FAIL  $name  $detail"; $script:fail++ }
}

# 先占用 8801，验证端口自动回退到 8802
$blocker = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 8801)
$blocker.Start()

$server = Start-Process powershell -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'tools\server.ps1'),
  '-StartPort','8801','-NoBrowser'
) -PassThru -WindowStyle Hidden

try {
  Start-Sleep -Seconds 2

  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8802/' -UseBasicParsing -TimeoutSec 10
  Check '根路径返回 200' ($r.StatusCode -eq 200) $r.StatusCode
  Check '根路径为 HTML 且含标题' ($r.Content -match '秦小皇音乐') ''
  Check 'HTML MIME 正确' ($r.Headers['Content-Type'] -match 'text/html') $r.Headers['Content-Type']

  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8802/assets/js/compat.js' -UseBasicParsing
  Check 'js 返回 200 且 MIME 正确' ($r.StatusCode -eq 200 -and $r.Headers['Content-Type'] -match 'text/javascript') $r.Headers['Content-Type']

  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8802/assets/css/style.css' -UseBasicParsing
  Check 'css MIME 正确' ($r.Headers['Content-Type'] -match 'text/css') $r.Headers['Content-Type']

  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8802/assets/img/note.svg' -UseBasicParsing
  Check 'svg MIME 正确' ($r.Headers['Content-Type'] -match 'image/svg\+xml') $r.Headers['Content-Type']

  # 关键音频扩展名 MIME（影响后续播放排查）
  foreach ($pair in @(@('audio-test.mp3','audio/mpeg'), @('x.flac','audio/flac'),
                      @('x.ogg','audio/ogg'), @('x.m4a','audio/mp4'), @('x.wav','audio/wav'))) {
    $f = Join-Path $root $pair[0]
    if (-not (Test-Path $f)) { Set-Content -LiteralPath $f -Value 'x' -Encoding ASCII }
    $rr = Invoke-WebRequest -Uri ("http://127.0.0.1:8802/" + $pair[0]) -UseBasicParsing
    Check ("MIME " + $pair[0]) ($rr.Headers['Content-Type'] -match [regex]::Escape($pair[1])) $rr.Headers['Content-Type']
    Remove-Item -LiteralPath $f -Force
  }

  # 404
  try { Invoke-WebRequest -Uri 'http://127.0.0.1:8802/不存在.html' -UseBasicParsing | Out-Null; Check '不存在文件 404' $false '未报错' }
  catch { Check '不存在文件 404' ($_.Exception.Response.StatusCode.value__ -eq 404) $_.Exception.Response.StatusCode.value__ }

  # 目录穿越（原始路径，不做客户端规范化）
  $code = & curl.exe -s -o NUL -w '%{http_code}' --path-as-is 'http://127.0.0.1:8802/../../../../Windows/win.ini'
  Check '目录穿越被拒(403)' ($code -eq '403') "got $code"
  $code = & curl.exe -s -o NUL -w '%{http_code}' 'http://127.0.0.1:8802/%2e%2e%2f%2e%2e%2fWindows%2fwin.ini'
  Check '编码目录穿越被拒(403)' ($code -eq '403') "got $code"

  # 405
  $code = & curl.exe -s -o NUL -w '%{http_code}' -X POST 'http://127.0.0.1:8802/'
  Check 'POST 返回 405' ($code -eq '405') "got $code"

  # Connection close + no-store
  Check '响应带 Connection: close' ($r.Headers['Connection'] -match 'close') ($r.Headers['Connection'])
}
finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  Get-Process powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne $PID } |
    ForEach-Object {
      try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        if ($cmd -and $cmd -match 'server\.ps1') { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
      } catch {}
    }
  $blocker.Stop()
}

Write-Host ''
Write-Host "RESULT  PASS=$pass  FAIL=$fail"
if ($fail -gt 0) { exit 1 }
