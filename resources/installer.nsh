!macro customInstall
  ; Verificar si Tesseract esta instalado
  ReadRegStr $0 HKLM "SOFTWARE\Tesseract-OCR" "Install_Dir"
  
  ${If} $0 == ""
    DetailPrint "Instalando Tesseract OCR..."
    
    SetOutPath "$TEMP"
    File "${BUILD_RESOURCES_DIR}\tesseract-installer.exe"
    
    ExecWait '"$TEMP\tesseract-installer.exe" /S' $1
    
    DetailPrint "Tesseract instalado OK"
    Delete "$TEMP\tesseract-installer.exe"
  ${Else}
    DetailPrint "Tesseract ya instalado"
  ${EndIf}
!macroend