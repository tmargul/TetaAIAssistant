#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef RagZipName
  #define RagZipName "global-rag.zip"
#endif
#ifndef PayloadDir
  #define PayloadDir "."
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "TetaAI-Update-RAG"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{C9D5E1F3-A7B4-4C0D-1E2F-3A4B5C6D7E8F}
AppName=Teta AI Assistant — import RAG globalnego
AppVersion={#MyAppVersion}
AppPublisher=Teta
DefaultDirName={tmp}\TetaRagImport
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
Source: "{#PayloadDir}\{#RagZipName}"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "{#PayloadDir}\scripts\setup\Run-RagImport.ps1"; DestDir: "{tmp}"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{tmp}\Run-RagImport.ps1"" -RagZipPath ""{tmp}\{#RagZipName}"""; \
  StatusMsg: "Import bazy RAG do Qdrant…"; \
  Flags: runhidden waituntilterminated
