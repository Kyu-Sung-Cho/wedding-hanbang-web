$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$inputPath = $env:HANBANG_OCR_INPUT
$languageTag = $env:HANBANG_OCR_LANGUAGE
if ([string]::IsNullOrWhiteSpace($inputPath) -or [string]::IsNullOrWhiteSpace($languageTag)) {
  throw 'missing bounded OCR input'
}
if ($languageTag -ne 'ko-KR') {
  throw 'unsupported OCR language'
}
if (-not [System.IO.Path]::IsPathRooted($inputPath) -or $inputPath.Length -gt 180) {
  throw 'unsafe OCR input path'
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)] $Operation,
    [Parameter(Mandatory = $true)] [Type] $ResultType
  )
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  if ($null -eq $asTask) {
    throw 'WinRT AsTask bridge unavailable'
  }
  $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

$language = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]::new($languageTag)
$engine = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]::TryCreateFromLanguage($language)
if ($null -eq $engine) {
  throw 'Windows.Media.Ocr ko-KR engine unavailable'
}

$stream = $null
$bitmap = $null
try {
  $fileOperation = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]::GetFileFromPathAsync($inputPath)
  $file = Await-WinRtOperation $fileOperation ([Windows.Storage.StorageFile])
  $streamOperation = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
  $stream = Await-WinRtOperation $streamOperation ([Windows.Storage.Streams.IRandomAccessStream])
  $decoderOperation = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]::CreateAsync($stream)
  $decoder = Await-WinRtOperation $decoderOperation ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmapOperation = $decoder.GetSoftwareBitmapAsync()
  $bitmap = Await-WinRtOperation $bitmapOperation ([Windows.Graphics.Imaging.SoftwareBitmap])
  $recognitionOperation = $engine.RecognizeAsync($bitmap)
  $recognition = Await-WinRtOperation $recognitionOperation ([Windows.Media.Ocr.OcrResult])

  $lines = @()
  $lineNumber = 0
  foreach ($line in $recognition.Lines) {
    $text = ([string]$line.Text) -replace '[\r\n]+', ' '
    $text = $text.Trim()
    if ($text.Length -eq 0) {
      continue
    }
    $lineNumber += 1
    $lines += [ordered]@{ line = $lineNumber; text = $text }
  }

  $engineVersion = 'windows-{0}|powershell-{1}' -f [System.Environment]::OSVersion.Version.ToString(), $PSVersionTable.PSVersion.ToString()
  [ordered]@{
    schema_version = 1
    engine_name = 'Windows.Media.Ocr'
    engine_version = $engineVersion
    language = $languageTag
    lines = $lines
  } | ConvertTo-Json -Compress -Depth 5
} finally {
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
}
