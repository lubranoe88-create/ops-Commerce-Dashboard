# AVVIO_PC launcher

## Access denied / Accesso negato
1. Right-click `start-plancia-locale.bat` -> Properties -> if you see Unblock, check it -> Apply -> OK
2. Same for `start-plancia-locale.ps1`
3. If Documents is OneDrive: right-click the folder -> Always keep on this device
4. Or move the whole `ops-Commerce-Dashboard-main` folder to `C:\Atlas\` (outside OneDrive) and run from there
5. Open last-run.txt in AVVIO_PC (or `%TEMP%\plancia-avvio-last-run.txt`) and read it aloud

## Normal start
Extract full repo to a local folder -> open DEPLOY_PIANCIA\AVVIO_PC -> double-click the bat -> wait for Dashboard listening -> http://127.0.0.1:8787

Needs Node 20+. LM Studio optional for boot.
