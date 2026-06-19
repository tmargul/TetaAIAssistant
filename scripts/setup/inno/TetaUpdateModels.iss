#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef PayloadDir
  #define PayloadDir "."
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "TetaAI-Update-Models"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{D0E6F2A4-B8C5-4D1E-2F3A-4B5C6D7E8F9A}
AppName=Teta AI Assistant — aktualizacja modeli Ollama
AppVersion={#MyAppVersion}
AppPublisher=Teta
DefaultDirName={tmp}\TetaModelsUpdate
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputBaseFilename={#OutputBaseFilename}
OutputDir={#OutputDir}
Compression=lzma2/max
PrivilegesRequired=admin
WizardStyle=modern

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Files]
Source: "{#PayloadDir}\models-pack\*"; DestDir: "{tmp}\models-pack"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\scripts\setup\Run-ModelsImport.ps1"; DestDir: "{tmp}"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{tmp}\Run-ModelsImport.ps1"" -ModelsDir ""{tmp}\models-pack"""; \
  StatusMsg: "Kopiowanie modeli Ollama…"; \
  Flags: runhidden waituntilterminated
