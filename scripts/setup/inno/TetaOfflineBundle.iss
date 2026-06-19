#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef MyAppMode
  #define MyAppMode "client"
#endif
#ifndef PayloadDir
  #define PayloadDir "."
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "TetaAI-Offline-Bundle-Setup"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

#if MyAppMode == "vendor"
  #define MyAppName "Teta AI — instalacja silnika offline (vendor)"
#else
  #define MyAppName "Teta AI — instalacja silnika offline (klient)"
#endif

[Setup]
AppId={{E1F7A3B5-C9D6-4E2F-3A4B-5C6D7E8F9A0B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Teta
DefaultDirName={autopf}\Teta AI Offline Bundle
DisableProgramGroupPage=yes
OutputBaseFilename={#OutputBaseFilename}
OutputDir={#OutputDir}
Compression=lzma2/max
PrivilegesRequired=admin
WizardStyle=modern

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Files]
Source: "{#PayloadDir}\bundle\*"; DestDir: "{app}"; Flags: external ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\scripts\setup\*"; DestDir: "{app}\scripts\setup"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Run-OfflineBundleSetup.ps1"" -BundlePath ""{app}"" -Mode {#MyAppMode}"; \
  WorkingDir: "{app}"; \
  StatusMsg: "Instalacja Qdrant, Ollama i modeli…"; \
  Flags: runhidden waituntilterminated

[Code]
function InitializeSetup(): Boolean;
begin
  if not DirExists(ExpandConstant('{#PayloadDir}\bundle')) then
  begin
    MsgBox('Rozpakuj paczkę ZIP (katalog offline-bundle obok instalatora) przed uruchomieniem.', mbError, MB_OK);
    Result := False;
  end
  else
    Result := True;
end;
