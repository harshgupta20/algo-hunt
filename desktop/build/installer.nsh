; Algo Hunt installer — extra pages and checks on top of electron-builder's assisted installer.

; Welcome page (left: build/installerSidebar.bmp).
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Algo Hunt"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Strategy alerts for NSE, BSE and MCX on live Zerodha Kite data, with paper trading and backtests.$\r$\n$\r$\nThis installs Algo Hunt on this computer. It is its own app, so you don't need a web browser.$\r$\n$\r$\nWhen it first opens, a short setup asks for your database, your Kite Connect keys and a password, one at a time, and shows where to get each one.$\r$\n$\r$\nAlgo Hunt never places orders. It is not investment advice.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Electron needs 64-bit Windows 10 or 11.
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Algo Hunt needs Windows 10 or Windows 11 (64-bit)." /SD IDOK
    Quit
  ${EndIf}
!macroend

