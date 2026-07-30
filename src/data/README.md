# Brno map data

`brno-map.json` is a processed extract of OpenStreetMap data. It is distributed
under the Open Database License 1.0:

- Map data © OpenStreetMap contributors
- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

`brno-terrain.bin` is a resampled and quantized derivative of the Digital
Terrain Model of the Czech Republic, 5th generation (DMR 5G):

- Terrain derived from DMR 5G © ČÚZK
- Creative Commons Attribution 4.0
- https://creativecommons.org/licenses/by/4.0/
- https://geoportal.cuzk.gov.cz/

The two datasets remain separate and are combined only by the game at runtime.
`brno-checksums.json` records their SHA-256 values and pinned source date.
Regenerate them with `npm run import:brno`; the bare command is date-pinned.
The game itself performs no map or terrain network requests.
