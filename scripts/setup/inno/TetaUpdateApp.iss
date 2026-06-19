#ifndef MyAppVersion
  #define MyAppVersion "0.0.1"
#endif
#ifndef PayloadDir
  #define PayloadDir "."
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "TetaAI-Update-App"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{B8C4D0E2-F6A3-4B9C-0D1E-2F3A4B5C6D7E}
AppName=Teta AI Assistant — aktualizacja aplikacji
AppVersion={#MyAppVersion}
AppPublisher=Teta
DefaultDirName={autopf}\Teta AI Assistant
DisableDirPage=no
DisableProgramGroupPage=yes
OutputBaseFilename={#OutputBaseFilename}
OutputDir={#OutputDir}
Compression=lzma2/max
PrivilegesRequired=admin
WizardStyle=modern

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\setup\Run-AppUpdate.ps1"" -AppRoot ""{app}"""; \
  WorkingDir: "{app}"; \
  StatusMsg: "Aktualizacja zależności i uruchamianie…"; \
  Flags: runhidden waituntilterminated

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if not FileExists(ExpandConstant('{app}\apps\api\dist\main.js')) then
    begin
      if MsgBox('Wybrany katalog nie wygląda na instalację Teta AI (brak apps\api\dist). Kontynuować?', mbConfirmation, MB_YESNO) = IDNO then
        Result := False;
    end;
  end;
end;
