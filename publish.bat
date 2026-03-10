@echo off
for /f "tokens=1,2 delims==" %%a in (.env) do (
  if "%%a"=="GH_TOKEN" set GH_TOKEN=%%b
)
npm run build:win && npx electron-builder --win --publish always
pause