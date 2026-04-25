# Setup Notes

## Goal

Get the backend running locally, import the TornPDA script, and connect TornPDA to the backend with the base URL only.

## Versions

- Backend: `1.8.7`
- Script: `1.8.7`

## Local Setup

```powershell
Set-Location 'C:\Users\Anthony\Downloads\Torn'
Copy-Item .env.example .env
npm install
npm run check
```

## Start The Backend

```powershell
Set-Location 'C:\Users\Anthony\Downloads\Torn'
npm run dev
```

## Test The Backend In A Browser

- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/status`

## TornPDA Import

1. Open `Settings -> Advanced Browser Settings -> Manage Scripts`
2. Import `tornpda-script/tornpda-market-watcher.json`
3. Confirm the imported script version is `1.8.7`

## Correct TornPDA Base URL

Use the base URL only.

Example:

- `http://YOUR-LAN-IP:3000`

Do not enter:

- `http://YOUR-LAN-IP:3000/api/status`
- `http://YOUR-LAN-IP:3000/api/slots`
- `http://127.0.0.1:3000` when using TornPDA on a phone

## Current UX Rules

- fresh loads start with the menu closed
- `Open Menu` restores current state and syncs if needed
- listing panels stay collapsed until opened manually
- `Notifications: On/Off` is separate from watching on or off
- compact mode is for viewing
- manage mode is for setup and editing

## Backup Notes

Export includes:

- backend slots
- backend timing settings
- backend URL
- view mode
- notification preference

Import:

- validates JSON shape
- validates backend slot payload
- replaces canonical backend slot config
- restores safe local UI preferences

## Version Compatibility Notes

If the backend and script versions are not compatible:

- the UI shows a warning
- risky actions are disabled
- the message tells the user to update backend or script
