# Integrated School Management Suite

Integrated School Management Suite is a school operations platform for Destiny Christian Academy. It includes admissions, parent portal, accounts, online payments, student wallet/POS, clinic, kitchen, inventory, and Firestore backend support.

## Current Release

Version: 3.0.0

Major changes in v3.0.0:

- Renamed from DCA Admissions Suite to Integrated School Management Suite.
- Added Firestore backend migration support.
- Added CSV import support for all former Google Sheets tabs.
- Added PC/SC NFC wallet card reading support for compatible Windows NFC readers.
- Added Firestore wallet card setup, wallet account lookup, wallet purchase recording, and billing category update actions.

## Desktop Installer

Download the latest installer from the GitHub Releases page:

https://github.com/Jozcefhs/dcs/releases

## Update Feed

The desktop app checks this file for updates:

https://raw.githubusercontent.com/Jozcefhs/dcs/main/version.json

When publishing a new release, update `version.json` with the new version and installer URL.
