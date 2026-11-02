# Builds the firmware from any PowerShell: activates ESP-IDF (installed with Espressif's EIM), then runs idf.py.
#   ./build.ps1            -> idf.py build
#   ./build.ps1 flash -p COM3 monitor
param([Parameter(ValueFromRemainingArguments)] [string[]] $IdfArgs = @('build'))

. 'C:\Espressif\tools\Microsoft.v6.0.3.PowerShell_profile.ps1' | Out-Null
Push-Location $PSScriptRoot
try { idf.py @IdfArgs } finally { Pop-Location }
