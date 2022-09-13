# HEFW migration script

A script written to migrate data from the old db to our PayloadCMS instance.

# Setup:

1. `projects.json`, `submissions.json` and `guilds.json` in `/data`, pull from old database.
2. Create an empty array in `data/failed.json`, copy `idmap.empty.json` to `idmap.json` in `/data`.
3. If you have old images/files, put then in `/images/orig/<PROJECT ID>`, code will try to look in there first before
   downloading from url. Doesn't download if the url is the Scaleway, you have to put it in the local data.
4. Copy `.env.example` to `.env`
5. Start PayloadCMS locally, and uncomment the rate limit bypass.
6. Run this script until it's finished. It'll generate some new files in `/data` to help figure out what files were missing.
