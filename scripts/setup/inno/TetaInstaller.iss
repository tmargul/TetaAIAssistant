; Teta AI Assistant — instalator pełny (vendor/client, online/offline).
; Kompilacja: scripts\setup\Build-Installer.ps1 -Variant vendor-online -PayloadDir ... -OutputDir ...

#ifndef MyAppVersion
  #define MyAppVersion "0.0.1"
#endif
#ifndef MyAppMode
  #define MyAppMode "vendor"
#endif
#ifndef MyOffline
  #define MyOffline "0"
#endif
#ifndef MyEmbedPayload
  #define MyEmbedPayload "1"
#endif
#ifndef PayloadDir
  #define PayloadDir "."
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "TetaAI-Setup"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

#if MyAppMode == "vendor"
  #if MyOffline == "1"
    #define MyAppName "Teta AI Assistant — Vendor (offline)"
  #else
    #define MyAppName "Teta AI Assistant — Vendor (online)"
  #endif
#else
  #if MyOffline == "1"
    #define MyAppName "Teta AI Assistant — Klient (offline)"
  #else
    #define MyAppName "Teta AI Assistant — Klient (online)"
  #endif
#endif

[Setup]
AppId={{A7B3C9D1-E5F2-4A8B-9C0D-1E2F3A4B5C6D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Teta
DefaultDirName={autopf}\Teta AI Assistant
DefaultGroupName=Teta AI Assistant
DisableProgramGroupPage=yes
OutputBaseFilename={#OutputBaseFilename}
OutputDir={#OutputDir}
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern
SetupIconFile=
UninstallDisplayIcon={app}\apps\web\dist\favicon.ico
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon"; Description: "Ikona na pulpicie"; GroupDescription: "Dodatkowe skróty:"; Flags: unchecked

[Files]
#if MyEmbedPayload == "1"
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#else
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: external ignoreversion recursesubdirs createallsubdirs
#endif

[Icons]
Name: "{group}\Teta AI Assistant"; Filename: "{app}\Start-App.bat"; Comment: "Uruchom aplikację"
Name: "{group}\Odinstaluj {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Teta AI Assistant"; Filename: "{app}\Start-App.bat"; Tasks: desktopicon

[Run]
#if MyAppMode == "vendor"
  #if MyOffline == "1"
Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Normal -ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Setup.ps1"" -Mode vendor -Offline -BundlePath ""{app}\offline-bundle.zip"" -InstallRoot ""{app}"" -NonInteractive -NoStart"; \
  WorkingDir: "{app}"; \
  StatusMsg: "Konfiguracja środowiska (Node, Ollama, Qdrant, modele)…"; \
  Flags: waituntilterminated; \
  Description: "Konfiguracja Teta AI Assistant"
  #else
Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Normal -ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Setup.ps1"" -Mode vendor -InstallRoot ""{app}"" -NonInteractive -NoStart"; \
  WorkingDir: "{app}"; \
  StatusMsg: "Konfiguracja środowiska (Node, Ollama, Qdrant, modele)…"; \
  Flags: waituntilterminated; \
  Description: "Konfiguracja Teta AI Assistant"
  #endif
#else
  #if MyOffline == "1"
Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Normal -ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Setup.ps1"" -Mode client -Offline -BundlePath ""{app}\offline-bundle.zip"" -InstallRoot ""{app}"" -NonInteractive -NoStart"; \
  WorkingDir: "{app}"; \
  StatusMsg: "Konfiguracja środowiska (Node, Ollama, Qdrant, modele)…"; \
  Flags: waituntilterminated; \
  Description: "Konfiguracja Teta AI Assistant"
  #else
Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Normal -ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Setup.ps1"" -Mode client -InstallRoot ""{app}"" -NonInteractive -NoStart"; \
  WorkingDir: "{app}"; \
  StatusMsg: "Konfiguracja środowiska (Node, Ollama, Qdrant, modele)…"; \
  Flags: waituntilterminated; \
  Description: "Konfiguracja Teta AI Assistant"
  #endif
#endif
Filename: "{app}\Start-App.bat"; \
  Description: "Uruchom Teta AI Assistant"; \
  Flags: postinstall nowait skipifdoesntexist

[UninstallRun]
Filename: "{app}\tools\nssm.exe"; Parameters: "stop TetaAI-API"; Flags: runhidden skipifdoesntexist
Filename: "{app}\tools\nssm.exe"; Parameters: "remove TetaAI-API confirm"; Flags: runhidden skipifdoesntexist
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Uninstall-Qdrant.ps1"" -InstallRoot ""{app}"""; \
  Flags: runhidden waituntilterminated

[Code]
function InitializeSetup(): Boolean;
begin
#if MyEmbedPayload == "0"
  if not DirExists(ExpandConstant('{#PayloadDir}')) then
  begin
    MsgBox('Nie znaleziono katalogu TetaAIAssistant obok instalatora. Rozpakuj całą paczkę ZIP przed uruchomieniem.', mbError, MB_OK);
    Result := False;
  end
  else
    Result := True;
#else
  Result := True;
#endif
end;
