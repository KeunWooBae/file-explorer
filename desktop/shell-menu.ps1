$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -Path (Join-Path $PSScriptRoot 'shell-menu.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing
  if ($request.action -eq 'inspect') {
    $count = [PaneShell.MenuHost]::InspectFiles([string[]]$request.paths)
    [Console]::Out.Write((@{ok=$true;count=$count} | ConvertTo-Json -Compress))
  } else {
    [PaneShell.MenuHost]::ShowFiles([string[]]$request.paths)
    [Console]::Out.Write('{"ok":true}')
  }
} catch {
  [Console]::Out.Write((@{ok=$false;message=$_.Exception.Message} | ConvertTo-Json -Compress))
  exit 1
}
