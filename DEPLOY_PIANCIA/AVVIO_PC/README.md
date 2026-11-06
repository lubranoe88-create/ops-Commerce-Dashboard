# AVVIO_PC launcher

## Before double-click
Look at File Explorer address bar. It MUST contain `Documents` and must NOT contain `Temp`.

Wrong: `C:\Users\...\AppData\Local\Temp\...zip...\AVVIO_PC`
Right: `C:\Users\...\Documents\ops-Commerce-Dashboard\...\DEPLOY_PIANCIA\AVVIO_PC`

## Setup
1. Clone or Download ZIP from GitHub main
2. Extract All to Documents, then delete/close the zip
3. Open the extracted `DEPLOY_PIANCIA\AVVIO_PC` (address bar = Documents)
4. Double-click `start-plancia-locale.bat`
5. Read the first lines: RUNNING FROM THIS PATH — confirm no Temp
6. Wait for Dashboard listening → http://127.0.0.1:8787

Needs: full repo with `backend\`, Node 20+. LM Studio optional for boot.
