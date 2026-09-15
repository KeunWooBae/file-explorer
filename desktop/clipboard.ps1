$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -eq 'write') {
    $data = New-Object System.Windows.Forms.DataObject
    $files = New-Object System.Collections.Specialized.StringCollection
    $files.AddRange([string[]]$request.sources)
    $data.SetFileDropList($files)
    $effect = if ($request.operation -eq 'move') { 2 } else { 1 }
    $stream = New-Object System.IO.MemoryStream(,[BitConverter]::GetBytes([int]$effect))
    $data.SetData('Preferred DropEffect', $stream)
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 5, 100)
    [Console]::Out.Write('{"ok":true,"value":null}')
  } elseif ($request.action -eq 'read' -or $request.action -eq 'clear') {
    $files = @([System.Windows.Forms.Clipboard]::GetFileDropList())
    if ($request.action -eq 'clear') {
      $expected = @($request.sources)
      if (($files.Count -eq $expected.Count) -and (($files -join "`0") -ceq ($expected -join "`0"))) { [System.Windows.Forms.Clipboard]::Clear() }
      [Console]::Out.Write('{"ok":true,"value":null}')
    } elseif ($files.Count -eq 0) { [Console]::Out.Write('{"ok":true,"value":null}') }
    else {
      $operation = 'copy'
      $data = [System.Windows.Forms.Clipboard]::GetDataObject()
      if ($data.GetDataPresent('Preferred DropEffect')) {
        $effect = $data.GetData('Preferred DropEffect')
        if ($effect -is [System.IO.MemoryStream]) { $bytes = $effect.ToArray(); if ($bytes.Length -ge 4 -and [BitConverter]::ToInt32($bytes,0) -eq 2) { $operation = 'move' } }
      }
      [Console]::Out.Write((@{ok=$true;value=@{sources=@($files);operation=$operation}} | ConvertTo-Json -Depth 4 -Compress))
    }
  } else { throw 'Invalid clipboard action' }
} catch {
  [Console]::Out.Write((@{ok=$false;message=$_.Exception.Message} | ConvertTo-Json -Compress))
  exit 1
}
