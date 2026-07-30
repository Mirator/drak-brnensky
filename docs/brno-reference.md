# Brno Architectural Reference — Central Landmarks and City Fabric

Research dossier for the rebuild of central Brno landmarks and streets. Compiled from Czech/English Wikipedia, Brno city and heritage-register sources (památkovýkatalog.cz, encyklopedie.brna.cz, hrady.cz), TIC Brno (gotobrno.cz, kudyznudy.cz), and DPMB/transit references. Every number below is sourced; where sources disagreed or a figure could only be found once, it is flagged **CONFIDENCE: LOW** — treat those as placeholders to verify against photogrammetry or a site survey before finalizing geometry, not as ground truth.

Coordinate reference: central Brno's old town sits at roughly 237 m above sea level; hills around it (Petrov, Špilberk) rise 30–50 m above the valley floor.

---

## 1. Katedrála sv. Petra a Pavla (Petrov Cathedral)

**Orientation & setting**: Stands atop Petrov hill, south of the old town centre, on a raised platform reached by staircases from Petrská and Biskupská streets. The church is long-axis oriented in the traditional liturgical way — chancel/presbytery to the east, main (west) façade with the twin towers facing west/downhill toward the city, so the towers are the first thing seen approaching from the historic core. It sits on a terraced platform with retaining walls (Petrov terraces) that drop toward Zelný trh and Denisovy sady; a paved south terrace overlooks the Old Town Hall and Zelný trh area.

**Dimensions**:
- Twin west towers: **84 m** to the tip, consistently reported across multiple sources (Wikipedia CS/EN, itras.cz, multiple tourist sites). One source (audiala.com aggregation) mentions a variant "81 m" — **CONFIDENCE: LOW** on the 81 m figure; treat 84 m as the reliable number since it recurs in the largest number of independent sources including the CS and EN Wikipedia articles.
- Main altar (interior): 11 m high, neo-Gothic wood, 1891, carver Josef Leimer.
- Overall church footprint/nave length and width: **not found in any source consulted — CONFIDENCE: LOW / UNKNOWN.** The building is described architecturally (per the heritage catalogue, pamatkovykatalog.cz) as a single-nave longitudinal structure with a long, polygonally-terminated, offset presbytery, with the two towers positioned at the point where nave meets presbytery — i.e. the towers are NOT at the extreme west end of a conventional basilica plan but rather flank the chancel/nave junction. Model this relationship carefully; do not assume a standard twin-west-front basilica silhouette.
- Rose window: present on the façade per general descriptions and visible in photographs, but no diameter was found in any source — **CONFIDENCE: LOW / UNKNOWN**, verify from photographs/photogrammetry.
- Buttresses: stepped/tiered buttresses (odstupňované opěráky) articulate the façades per the heritage catalogue entry.

**Construction history / body**: Core fabric is Gothic (mostly 14th century) over a Romanesque chapel (c. 1140) and later Romanesque basilica remains (late 13th c.). Heavily Baroque-ified inside in the 18th century (architect Mořic Grimm). Presbytery and Marian chapel neo-Gothic rebuild 1879–1891. The current neo-Gothic exterior with twin towers dates from the **1901 competition win by Viennese architect August Kirstein**, executed **1904–1909** (some sources say 1904–1908). So: baroque/gothic body, neo-Gothic west end and towers grafted on early 1900s — the "earlier baroque body, later neo-gothic towers" reading the brief expects is correct.

**Noon-at-eleven bell**: Daily at 11:00 the cathedral bells ring the Angelus/noon peal an hour early. Legend: during the 1645 Swedish siege (Thirty Years' War, under General Torstenson), the Swedish commander vowed to lift the siege if he had not taken the city by noon on a fixed date. Brno's defending commander (Jean-Louis Raduit de Souches) had the noon bells rung an hour early, at 11:00, tricking the Swedes into believing they'd lost their deadline; they withdrew. Brno commemorates this every day at 11:00 ever since. (Corroborated by CS and EN Wikipedia plus multiple Czech news sources.)

**Colour/material**: Grey stone (sandstone-type Gothic/neo-Gothic masonry), consistent with other Moravian Gothic Revival work of the period — no specific quarry/stone-colour source found; **CONFIDENCE: LOW** on exact stone type/colour, treat as pale grey ashlar pending verification.

**Modelling notes**:
- Twin spires: 84 m to tip — high confidence (2+ independent sources).
- Towers sit at the nave/presbytery junction, not at a conventional west front — check plan carefully.
- Long single-nave body with polygonal apse, stepped buttresses.
- Daily 11:00 bell event is a great ambient/gameplay hook — tie an audio cue to it.
- Rose window exists but no diameter sourced — placeholder only, verify visually.
- Sits on a terraced hill with retaining walls facing Zelný trh/Denisovy sady — model the terrace and stairs, not just the building.
- Footprint dimensions: UNKNOWN, need direct measurement/plan.

---

## 2. Špilberk (Castle and Fortress)

**Setting**: Occupies its own hill immediately west/southwest of the old town, within its own 17-hectare municipal park (see City Fabric § Parks). Hilltop elevation **282 m above sea level** (CS Wikipedia) against a town-centre floor of roughly 237 m — i.e. roughly **40–50 m above the surrounding streets**, though the exact differential depends on which street you measure from (**CONFIDENCE: LOW** on the precise relative height; 282 m a.s.l. itself is corroborated only once, verify against a second elevation source/DEM).

**History/form**: Founded 2nd half of 13th century by margrave Přemysl Otakar II as a royal castle; became a margraves' residence in the 14th century; rebuilt into a massive Baroque fortress in the 17th century, expanded further through the 18th century; later served as a prison and Habsburg-era political jail (19th century), now the Brno City Museum.

**Fortification elements**:
- Two four-sided (quadrangular) bastions were built in 1645 specifically to strengthen defence against the Swedish siege from the west.
- Casemates (built 1742 by Colonel Rochepin): the north wing casemates run **109 m**, the south wing **102 m**; internal corridor width approx. **7 m**.
- A deep well in the west courtyard: approx. **112 m** deep, with an adjoining cistern.
- Courtyards: the original single large courtyard was subdivided into two parts by mid-18th-century construction — model as two distinct courtyard spaces, not one.
- Lookout tower: located in a corner turret in the eastern part of the fortress; **103 steps** from the small courtyard to the top.
- Gatehouse: remnants of a gate/portal survive from the southwestern bastion.
- Overall footprint/total area of the fortress complex: **not found — CONFIDENCE: LOW/UNKNOWN**, needs a site plan or aerial measurement.

**Modelling notes**:
- Hilltop keep-and-bastion fortress, not a single tower-castle silhouette — broad, low, star-fort-influenced profile with corner bastions, not a tall central donjon.
- Casemate corridors: ~102–109 m long, ~7 m wide, barrel-vaulted brick/stone (typical of period; exact vault profile not sourced).
- Two subdivided courtyards, not one continuous yard.
- Corner lookout tower, ~103 steps — modest height, not a soaring spire; think squat masonry turret with a viewing platform.
- Approach road: winds up the hill (typical Baroque fortress ramp/switchback approach) — exact geometry not sourced, verify against OSM/site plan.

---

## 3. Stará radnice (Old Town Hall)

**Tower**: **62.66 m** high, **173 steps** to the top (two independent sources agree on both figures — CS Wikipedia and Kudy z nudy/Radio Prague-family sources). Construction history of the tower: base structure from the 13th century (town hall function documented from 1304); tower heightened by roughly 4 m by Pietro Gabri in 1577; heightened again by 5 m during an early-1900s (1904–1905) urban makeover. So the tower's current height is the sum of several building campaigns — do not model a single-period tower.

**Pilgram portal**: Late-Gothic stone portal by sculptor **Anton Pilgram**, dated **1510–1511** (some sources say completed 1511), spanning the vaulted passage between Radnická street and the courtyard. Richly decorated with civic figures and shield-bearers carrying Brno's coat of arms, and topped with five ornamental pinnacles (fiály). The **central pinnacle is visibly bent/crooked**. Legend: the town councillors shorted Pilgram's agreed payment; he had already spent part of his advance on building stone and part on wine, and carved the portal with an unsteady, wine-loosened hand — when the councillors refused to pay for the "flawed" work, Pilgram cursed the portal, leaving the crooked pinnacle as a permanent grudge made stone. (This precise causal chain — bad pay dispute leading to a deliberate/drunken crooked spire — is corroborated by two independent Czech sources: brnensky.denik.cz and the general legend as repeated on multiple heritage sites.)

**Brno Dragon & Brno Wheel**: Both hang in the vaulted passage (same passage as the Pilgram portal).
- The "dragon" (brněnský drak) is a **stuffed/taxidermied crocodile** hanging from the ceiling — its exotic, unfamiliar appearance to medieval Brno residents apparently generated the "dragon" legend. Its true origin is not reliably documented, though a popular tradition holds margrave Matyáš gifted it to the city in 1608; however restoration/archival records show the crocodile was already being maintained (restored, de-wormed) in Brno as early as 1578–1579, meaning it predates the 1608 gift story. The associated folk legend describes a dragon terrorizing the area around a river; a townsman kills it by feeding it a bull's hide stuffed with unslaked lime, which the dragon swallows and then, drinking water, is killed by the resulting reaction.
- The "wheel" (brněnské kolo) is a cartwheel hanging in the same passage. Legend: a wheelwright from Lednice (J. Birk) bet that he could fell a tree, make a complete cart wheel from its wood, and roll it from Lednice to Brno — all within twelve hours. He won the bet, and the mayor had the wheel hung in the town hall passage as a trophy/curiosity.

**Courtyard**: Renaissance arcaded gallery, built **1587–1588**, giving access to the upper floor and contributing much of the town hall's present external appearance.

**Function**: Seat of the city government for roughly six centuries, until 1935.

**Modelling notes**:
- Tower: 62.66 m, 173 internal steps — high confidence (2 sources agree).
- Tower height is a composite of 13th-c. base + 1577 (+4 m) + 1904–05 (+5 m) campaigns — consider subtly varying masonry/weathering by band if going for authenticity.
- Pilgram portal (1510–11): 5 pinnacles, center one crooked/bent — a load-bearing "signature" detail, must not be symmetrical.
- Crocodile ("dragon") and cartwheel hang in the same vaulted passage — both are set-dressing props, not part of the structure.
- Renaissance arcaded courtyard from 1587–88.

---

## 4. Náměstí Svobody (Freedom Square)

**Shape/dimensions**: Roughly **triangular** — formed at the historic junction of three trade roads in the 13th century and has kept that triangular footprint ever since (CS Wikipedia). One secondary source estimates the bounding footprint at roughly **100 × 70 m**; treat that figure as a rough envelope only, not an authoritative area — **CONFIDENCE: LOW**, no source gives an exact m² figure or precise vertex coordinates.

**Marian/Plague column**: Baroque column, built **1679–1683**, commemorating the 1679–1680 plague epidemic. Height **20 m**, made principally of Hořice sandstone with white-grey marble architectural elements (from a quarry near Pernštejn) and Eggenburg limestone sculptural elements. Stands in the north (upper) part of the square. Four corner pedestals carry statues of plague saints — St Sebastian, St Roch, St Charles Borromeo, St Francis Xavier — with the Virgin Mary and Child atop the central column on a composite capital.

**"Astronomical clock" (Brno orloj)**: Not a traditional clock face at all — it is a black stone **projectile/bullet-shaped monolith**, roughly **6 m tall**, carved from a single block of black stone from South Africa (commercially sold as "black granite" but mineralogically closer to gabbro — flagged discrepancy noted directly by a geology expert quoted in a ČT24 article). Unveiled 18 September 2010, marking the 365th anniversary of Brno's successful resistance to the 1645 Swedish siege — the bullet/projectile shape is a deliberate symbol of that siege. Every day at 11:00 it releases a glass marble (a popular tourist "catch the marble" ritual) down an internal channel. Time is shown by rotation of the stone sections: the whole tip rotates once per minute (with a sharp prism edge acting as a seconds pointer), and the uppermost glass section rotates once per hour as the minute indicator. Its elongated, blunt-tipped vertical monolith form is indeed widely and explicitly mocked in Brno as phallic in shape — this is the actual real-world silhouette to model: a tapering rounded-tip black obelisk/shell shape, not a filigree clock mechanism.

**Dům u čtyř mamlasů ("House of the Four Ninnies")**: Built **1899–1902**, architect Germano Wanderley, for the Valentin Gerstbauer Foundation. Historicist rental/commercial palace with four wings around a courtyard, arcaded corridors on every floor, ground-floor passage, originally 21 apartments and 12 shops. Façade is monumental neo-Roman/neo-Romanesque with side risalits ending in towers, rich stucco, and — its namesake feature — **four monumental male Atlas figures** (by sculptor Richard Luksch, executed by Johan Tomola) supporting a full-width balcony/entablature on the main façade.

**"Schwansee" palace — correction**: No building of this name was found in any source. The palace matching the brief's description on náměstí Svobody (no. 17) is the **Schwanzův palác**, also called **Dům pánů z Lipé** (House of the Lords of Lipé) — a Renaissance palace built from 1589 for wealthy merchant Kryštof Schwanz, by builder Antonio Gabri with sculptor Giorgio Gialdi, featuring two cylindrical corner oriel windows with stone relief parapets (mythological/biblical/harvest scenes) and an arcaded courtyard. **Flag this name correction for the team** — if "Schwansee" refers to something else, it wasn't found; treat Schwanzův palác / Dům pánů z Lipé as the intended building.

**Omega palace (Palác Omega)**: A modern (opened **18 January 2006**) infill building replacing the bombed/demolished functionalist "Dům nábytku" (Furniture House, originally by Otto Eisler). Designed by Ladislav Kuba and Tomáš Pilař. 6 above-ground + 2 underground floors, ~3,500 m² usable area; façade is a rhythmic grid of green glass squares and vertical rectangles in an irregular window pattern, grey-green by day, illuminated in changing colours at night. Widely controversial for contrasting sharply with its historicist neighbours — useful as a deliberate "modern intrusion" landmark in the square's silhouette.

**General facade character**: Mixed historicism — Renaissance (Schwanzův palác), late-19th-c. historicist/eclectic rental palaces (Dům u čtyř mamlasů), and one glass-and-colour modern intrusion (Omega) — i.e. do not model the square as uniformly baroque/historicist; it already contains a deliberately dissonant modern building in its middle.

**Modelling notes**:
- Triangular plan, ~100×70 m envelope — LOW CONFIDENCE on exact metrics, verify against cadastral map/OSM footprint.
- Plague column: 20 m, sandstone shaft + marble + limestone figures, north end of square, 4 corner saints + Marian figure on top.
- "Orloj": NOT a clock face — 6 m tall black tapering stone monolith/obelisk, releases a marble at 11:00 daily, rotating sections indicate time. Deliberately projectile/bullet-shaped; explicitly and widely read as phallic in local commentary — model the real silhouette (tapering rounded monolith), not a fantasy clock face.
- Dům u čtyř mamlasů: 4 atlantes on main façade holding up balcony/entablature, corner tower risalits.
- Schwanzův palác (not "Schwansee"): Renaissance, cylindrical corner oriels with figural relief parapets.
- Omega palace: modern glass-grid infill, deliberately jarring — good as a "wrong note" in an otherwise historicist streetscape.

---

## 5. Zelný trh (Cabbage/Vegetable Market)

**General character**: A sloped, roughly trapezoidal square in the historic centre, in continuous market use since at least the 13th century — still an active produce/flower/herb market today (fruit, vegetables, flowers, seedlings, spices, honey — cobbler/potter stalls no longer present). The square noticeably slopes downhill (per multiple general descriptions and its position between the higher Petrov hill and lower town) — model the ground plane with real grade, not flat paving.

**Parnas Fountain**: Baroque fountain by **Johann Bernhard Fischer von Erlach**, designed **1690–1696**, built **1693–95** by Adam Tobiáš Kracker of Vienna, with sculptural work by Brno sculptor Antonín Riga; described as the largest fountain of its type north of the Alps.
- **Basin**: six-pointed star ground plan; the visible basin itself was largely rebuilt at the end of the 19th century and again reconstructed in 2019 for leak repairs.
- **Rock/grotto core**: a triangular rocky mass built from massive crinoid-limestone (Eggenberg limestone) blocks, with a small artificial grotto open on three sides at its centre.
- **Hercules group** (inside the grotto): Hercules clad in the skin of the Nemean lion, club in left hand, leading the three-headed dog Cerberus on a chain with his right hand.
- **Three allegorical continents/empires**, seated female figures around the rock: **Greece** (northeast corner, leaning on a quiver of arrows, crown at her feet, a winged dragon beneath her), **Babylonia** (northwest, crown at her feet, a winged lion beneath her), **Persia** (southwest, holding a cornucopia, crown at her feet, a bear emerging from the rock).
- **Europa**: a figure atop the rock, holding a sceptre, standing over a defeated dragon, symbolizing the Holy Roman Empire.
- **Note on the dragon(s)**: sources describe both a winged dragon beneath the "Greece" figure AND a separate defeated dragon under Europa at the summit — **CONFIDENCE: LOW / possible duplication or conflation across sources** — verify whether these are the same dragon described twice or genuinely two separate dragon sculptures before modelling; do not assume without visual confirmation.

**Reduta Theatre**: Corner building on the square, first mentioned 1608, said to be the oldest theatre building in Central Europe; rebuilt as a tavern/playhouse in the early 17th c., rebuilt again as a proper theatre building 1731–1732; first Czech-language performance in Bohemia/Moravia given here in 1767; an 11-year-old W. A. Mozart performed here. Burned multiple times (last in 1870), was rebuilt as a market hall after that fire, and only returned to theatrical use in 1919; now part of the Brno National Theatre.

**Other notable buildings**: Divadlo Husa na provázku and the Dietrichstein Palace (seat of the Moravian Museum) stand at the upper part of the square.

**Modelling notes**:
- Square slopes — build real grade into the terrain, not a flat plaza.
- Parnas fountain: six-point star basin, central triangular rock/grotto of crinoid limestone, Hercules+Cerberus inside the grotto, three seated allegorical continent figures (Greece/Babylonia/Persia) each with an animal, Europa figure on the summit with sceptre over a defeated dragon.
- Flag the dragon-duplication question for whoever does the fountain model — check reference photos before committing to one or two dragon sculptures.
- Reduta theatre on a corner of the square — plain/reused historic shell, not an ornate purpose-built 18th-c. theatre front, given its checkered fire/rebuild history.
- Active market stalls (produce/flowers) should populate the square, not empty pavement.

---

## 6. Mahenovo divadlo & Janáčkovo divadlo

**Mahenovo divadlo (Mahen Theatre)**:
- Designed by the Vienna architectural firm **Fellner & Helmer** (Ferdinand Fellner, Hermann Helmer), built by Prague builder Josef Arnold under architect J. Nebehostěny.
- Style: eclectic mix of **neo-Renaissance, neo-Baroque, and neo-Classicism** — brief's "neo-renaissance" framing is broadly right but it is genuinely a mixed historicist style, not pure neo-Renaissance.
- **Opened 1882** as the **first theatre in Europe lit entirely by electric light**, replacing gas lighting with brand-new (then 3-year-old) Edison incandescent bulbs. The electrical installation was carried out under Edison's own New Jersey laboratory's project, with on-site electrical work by Paris and Vienna contractors.
- Located on Malinovského náměstí, part of the Brno National Theatre complex.

**Janáčkovo divadlo (Janáček Theatre)**:
- Built early-to-mid 1960s: site prep/design from 1958 (Stavoprojekt Brno studio, lead architect Jan Víšek / studio head Otakar Oplatek, chief engineer Vilém Zavřel), construction January 1960 – completion July 1965, **officially opened 2 October 1965**.
- Style: synthesis of classicizing and neo-functionalist forms — a modernist 1960s box, per the brief. Structure: monolithic reinforced-concrete frame with infill masonry; exterior/interior surfaces combine stone, wood, steel, glass, and aluminium — i.e. a genuine glass-fronted modernist block, not a glass curtain-wall skyscraper aesthetic but a heavy, stone-clad modernist civic building with a glazed front.
- Grounds: forecourt with a water basin and fountain, terraces, and planted greenery, built simultaneously with the theatre — this matches the brief's "fountains" note; there is a forecourt water feature, not necessarily multiple fountains — **CONFIDENCE: LOW** on exact fountain count/arrangement, verify visually.

**Modelling notes**:
- Mahen: Fellner & Helmer historicist eclectic (neo-Renaissance/Baroque/Classical mix), opened 1882 as first electrically-lit theatre in Europe (Edison bulbs) — a genuine "first" worth surfacing in-game.
- Janáček: 1958–65 built, opened Oct 1965, reinforced-concrete modernist civic block, stone/glass/steel/aluminium finish, forecourt with water basin/fountain and terraces.

---

## 7. Moravské náměstí (Moravian Square)

**Layout**: Actually two zones split by a busy tram-carrying road: a paved forecourt in front of the Church of St Thomas, and a separate park area (with fountain, playgrounds, green space, event use in summer).

**Jošt of Luxembourg equestrian statue**: Bronze, by sculptor **Jaroslav Róna**, unveiled marking its location on Moravské náměstí. **Total height 8 m.** Its defining, deliberately controversial feature: the horse has **unnaturally long legs**, roughly **4 m** of leg alone, anchored directly into the square's paving — tall enough that pedestrians can walk underneath between the legs. The sculptor's own stated intent was that lifting the rider to height reads as elegant; the public reception has been mixed, with many likening the horse's proportions to a giraffe rather than a warhorse. Model exactly this: an ordinary-scale mounted-margrave bronze raised on absurdly tall, thin legs rather than a naturalistic horse — this is the point of the piece, not an error to correct.

**St Thomas's Church (Kostel sv. Tomáše)**: Originally a Gothic Augustinian monastery church, founded 14th century (Jan Jindřich/John Henry of Luxembourg); present appearance is Baroque, 17th-century remodel. Sits on the south side of the square.

**Governor's Palace (Místodržitelský palác)**: The adjoining former Augustinian monastery building, remodeled Baroque in the 1730s; after the monastery's dissolution/relocation in 1783 it became a seat of regional administration (hence "Governor's Palace"); today it houses the Moravian Gallery (Moravská galerie v Brně).

**Modelling notes**:
- Square is split by a tram road into a church forecourt + a separate park — do not model as one continuous open plaza.
- Jošt statue: 8 m total height, ~4 m of exaggeratedly long/thin horse legs planted straight into the paving, walkable underneath — a deliberately surreal proportion, not a modelling error.
- St Thomas: Gothic-origin, Baroque exterior, south side of square.
- Governor's Palace/Moravian Gallery: attached former monastery, Baroque 1730s remodel.

---

## 8. Brno hlavní nádraží (Main Railway Station)

**History**: In operation since **1839**, one of the oldest railway stations in the Czech Republic. Current Art Nouveau (secese) appearance dates from a **1902–1905** reconstruction; in **1904** the old vestibule was rebuilt into a large central hall flanked by towers, designed by architect **Josef Oehm** and engineer **Franz Uhl**, built under Josef Nebehosteny.

**Towers**: The symmetrical entrance front was originally flanked by twin clock towers; the right-hand tower was destroyed in a **1944** air raid and not rebuilt — so the historically correct building has an asymmetrical tower arrangement today (one tower, not two), unless you are deliberately modelling a pre-1944 state.

**Facade**: Monumental Art Nouveau entrance front with two pairs of columns supporting sculptural groups celebrating the railway; richly decorated Art Nouveau ornament across the whole complex, applied over an underlying classical massing.

**Platform canopies**: Platforms are covered by restored double-pitched ("dvojitého zalomení" — double-kinked/double-angled) canopy roofs on a **cast-iron (litinová)** structural frame — i.e. classic 19th/early-20th-century train-shed canopy construction: slender cast-iron columns and trusses, glazed/double-pitched roof profile.

**Tram interchange**: A major tram hub sits directly on Nádražní street in front of the station building — a busy interchange with two large tram stopping areas; the current tram loop/terminus arrangement on Nádražní dates from a loop built **1 January 1943**. This is one of the busiest tram interchange points in the city, tying together most north–south lines through the centre.

**Modelling notes**:
- Station front: Art Nouveau (1902–1905), asymmetrical today — only one of the original two clock towers survives (right tower lost to 1944 bombing).
- Platform canopies: cast-iron frame, double-pitched/kinked glazed roof profile — classic train-shed detailing, not a modern flat canopy.
- Dense tram interchange immediately in front of the building on Nádražní street — treat the station forecourt as a major transit hub, not a quiet plaza.

---

## City Fabric

### Typical Brno old-town residential/commercial building
Specific numeric standards (storey heights, bay widths) were **not found in any citable source — CONFIDENCE: LOW/UNKNOWN across this whole subsection.** No source gave hard figures for typical ground-floor shopfront height, upper-storey height, bay width, or cornice profile for generic Brno townhouses (searches returned only generic Central-European descriptions or results for other towns, e.g. Frenštát pod Radhoštěm, Slavonice). Recommend the team commission a direct photogrammetric survey of 5–10 representative Zelný trh/Masarykova/Josefská façades rather than relying on a textual source, OR treat the following as reasonable, clearly-flagged placeholder defaults pending verification:
- Ground floor: taller than upper floors, arcaded/shopfront in many buildings — exact height UNKNOWN.
- Upper storeys: historicist/Baroque-Classicist proportions typical of Central European old towns (3–5 storeys total) — exact height UNKNOWN.
- Roof: pitched, historically clay pantile — colour and exact pitch UNKNOWN, but red-orange fired clay tile is the safe regional default pending verification.
- Courtyard structure: many old-town houses have narrow street frontages opening onto rear courtyards accessed via a central carriage passage (cf. the Old Town Hall's own portal-and-passage arrangement, and Dům u čtyř mamlasů's four-wing courtyard plan) — this passage-to-courtyard typology is well corroborated structurally even though exact dimensions were not sourced.

**CONFIDENCE: LOW across this entire subsection — flagged as the single biggest gap in this dossier. Do not build precise generic townhouse geometry from this document; get it from survey/photogrammetry or a dedicated follow-up source pass (e.g. archaiabrno.org publications, which were identified as a specialist source but not deep-fetched in this pass).**

### Interwar functionalism
Brno is a genuine, UNESCO-anchored centre of functionalist/Bauhaus-adjacent architecture:
- **Vila Tugendhat** (Ludwig Mies van der Rohe, built **1929–1930**, in the Černá Pole district, not the old-town core) — the only modern-architecture monument in the Czech Republic on the **UNESCO World Heritage List** (inscribed 2001). Defining idea: free-flowing open interior space, steel frame construction, large glass walls, minimal ornament. Sits outside the old town proper (Černá Pole), so it is a satellite reference point rather than a central-square building.
- Beyond Tugendhat, Brno has a broader stock of interwar functionalist buildings scattered through the centre and surrounding districts — a full list exists on Czech Wikipedia ("Seznam funkcionalistických staveb v Brně") but was not itemised in this pass. One concrete example already surfaced above: **Otto Eisler's functionalist "Dům nábytku" (Furniture House)** used to stand on náměstí Svobody before WWII bomb damage and 1980s demolition — i.e. the square itself once had a functionalist building where Palác Omega now stands.
- General functionalist material/rhythm: smooth rendered planar façades, flat roofs (contrast with the pitched/tiled roofs of the historic core), large regular horizontal window bands rather than individual punched openings, minimal cornices — standard International/Bauhaus-adjacent vocabulary; no Brno-specific numeric proportions were sourced — **CONFIDENCE: LOW** on specifics, high confidence on the general stylistic contrast with the historicist core.

### Street furniture & surfacing
- **Paving**: Squares and streets in the centre use **stone paving** — granite setts/cobbles (žulové dlažební kostky) are the standard historic Central-European paving unit for squares, plazas, and many streets; gravel/fine-chip paths (mlatové chodníky) in parks are typically edged by two rows of granite setts roughly 200 mm wide. No source gave a Brno-specific breakdown of exactly which streets use setts vs. flag/slab paving vs. asphalt — **CONFIDENCE: LOW** on a street-by-street paving map; granite sett paving on the main squares (Zelný trh, náměstí Svobody) is a safe default, verify exact unit size and colour (typically grey granite) on site/photos.
- **Street lamps**: Historic cast-iron (litinové) lamp standards/candelabra are documented as protected heritage items in Brno (per pamatkovykatalog.cz listing "litinové kandelábry") — exact model/design not itemised in this pass; **CONFIDENCE: LOW** on specific fixture geometry.
- **Street name plates**: Standardised **enamel (smaltované) street-name plates** are the regional norm — double-sided enamelled steel signs, typically two-colour (background colour + text/border colour), weather-resistant; a "Brno standard" enamel street-sign product is explicitly sold/referenced (shop.alerion.cz lists a "brněnská norma" enamel street sign). House numbers use matching enamel plates for street/descriptive/registration numbers. Recommend modelling dark-blue-or-similar background with white/light text and a border — **CONFIDENCE: LOW** on the exact official colour pairing; verify against a reference photo of an actual Brno street corner before finalizing texture colours.
- **Trams**: DPMB's historic livery is a **cream/white body with red** accent bands — the classic Czechoslovak-era tram scheme (white top-half/cream, red lower band, matching Prague-family liveries of the same period); this scheme predominated until after 1989, when full-vehicle advertising wraps became common and diluted the uniform livery. Current fleet mixes: **Škoda VarioLF** (older low-floor partial type) and **Škoda ForCity** (modern fully low-floor type), among others (over a dozen daily lines run through the network). Track gauge: **standard 1435 mm**. Overhead wire: simple single catenary wire per track is standard for tram sections; on multi-track sections, paired masts linked by cable cross-spans or steel beams carry the wire — no Brno-specific mast-spacing figures were sourced. Lines through the centre run via **Rooseveltova and Masarykova streets**, calling at **Česká, náměstí Svobody, Zelný trh, and Hlavní nádraží** — this is the core central spine; **line 4** is one of the services confirmed to run this route, alongside others — **CONFIDENCE: LOW** on the complete, current list of line numbers (network changes over time; verify current line numbers against DPMB's live route map at time of build, since this reference will age).

### Vegetation
- **Denisovy sady**: The oldest public park in the Czech lands, founded by the Moravian estates **1814–1818**; features species from across Moravia plus 150+ foreign/exotic tree and shrub species — a genuinely arboretum-like, botanically varied park rather than a simple single-species avenue.
- **Lužánky**: **20 ha**, oldest municipal park open to the public in the Czech lands, a protected cultural monument.
- **Špilberk park**: **17 ha**, wraps the Špilberk hill, jointly protected as a National Cultural Monument together with the castle itself.
- Together, Denisovy sady + Špilberk park + Koliště + Moravské náměstí's park form a **green ring around the historic core**, tracing the line of the demolished medieval city walls — a useful macro-layout fact: model a continuous green belt just outside the old town proper, not isolated pocket parks.
- Street tree species for specific Brno avenues were only found for one example outside the core (a roughly 1 km, nearly-century-old **linden/lime avenue on Vodova street**, first appearing on the 1931 city plan) — **CONFIDENCE: LOW** on which species specifically line the central squares/streets covered by this brief; linden (lípa) is the safe regional default street tree for Central European cities of this type, but this was not directly confirmed for náměstí Svobody, Zelný trh, or Moravské náměstí's own tree planting.

---

## Summary of flagged uncertainties (do not build blind on these)

1. Petrov cathedral overall footprint (length/width) and rose-window diameter — not found anywhere.
2. Petrov tower height: 84 m is well corroborated; one aggregator mentions 81 m — treat as an outlier.
3. Špilberk hill's precise height above the surrounding streets, and the fortress's total footprint/area — not found; only absolute elevation (282 m a.s.l., itself single-sourced) available.
4. Náměstí Svobody's exact area/vertex geometry — only a rough, single-sourced 100×70 m envelope estimate exists for a square that is actually triangular.
5. Parnas fountain: possible duplication/conflation between the dragon beneath the "Greece" figure and the "defeated dragon" under Europa — verify from photos whether these are one feature described twice or genuinely two dragons.
6. "Schwansee palace" as named in the original brief could not be located; the real building matching its description and location is the Schwanzův palác / Dům pánů z Lipé. Flagged for confirmation.
7. Janáčkovo divadlo forecourt "fountains" (plural) — sources describe a single water basin/fountain feature, not confirmed multiples.
8. Generic old-town townhouse dimensions (storey heights, bay widths, cornice profiles, shopfront proportions) — essentially unsourced; this is the largest gap in the whole dossier and should be closed with a direct site/photogrammetric survey, not further web research.
9. Street-name-plate and house-number enamel colour scheme — the "Brno standard" format is confirmed to exist as a product, but its specific official colours were not confirmed from a heritage source.
10. Current DPMB tram line numbers through the centre — confirmed the general route corridor (Rooseveltova/Masarykova via Česká–nám. Svobody–Zelný trh–Hlavní nádraží) and that line 4 runs it, but not a complete, current, authoritative line list; verify against DPMB's live map before hardcoding line numbers/colours in-game.

---

## Sources

- [Katedrála svatého Petra a Pavla – Wikipedie (cs)](https://cs.wikipedia.org/wiki/Katedr%C3%A1la_svat%C3%A9ho_Petra_a_Pavla)
- [Cathedral of St. Peter and Paul, Brno – Wikipedia (en)](https://en.wikipedia.org/wiki/Cathedral_of_St._Peter_and_Paul,_Brno)
- [katedrála sv. Petra a Pavla – Památkový katalog](https://pamatkovykatalog.cz/katedrala-sv-petra-a-pavla-15243306)
- [Petrov, Katedrála sv. Petra a Pavla – encyklopedie.brna.cz](https://encyklopedie.brna.cz/home-mmb/?acc=profil-domu&load=714)
- [Katedrála sv. Petra a Pavla, Brno – hrady.cz](https://www.hrady.cz/katedrala-sv-petra-a-pavla)
- [Katedrála sv. Petra a Pavla Brno | poledne už v 11 hodin – itras.cz](https://itras.cz/katedrala-sv-petra-a-pavla-brno/)
- [Švédové odtáhli od Brna, zastavily je zvony z Petrova – Brněnský deník](https://brnensky.denik.cz/zpravy_region/svedsti-vojaci-odtahli-od-brna-zastavily-je-zvony-z-petrova-i-po-369-letech-2014.html)
- [Legenda o obléhání Brna Švédy – Miluji Brno](https://www.milujibrno.cz/legenda-o-oblehani-brna-svedy/)
- [Špilberk – Wikipedie (cs)](https://cs.m.wikipedia.org/wiki/%C5%A0pilberk)
- [Kasematy - věznice – Muzeum města Brna / spilberk.cz](https://www.spilberk.cz/kasematy-veznice/t1278)
- [Hrad Špilberk – Muzeum města Brna](https://www.spilberk.cz/)
- [Hrad Špilberk - rozhledna – Turistika.cz](https://www.turistika.cz/mista/hrad-spilberk-rozhledna/detail)
- [Navštivte Špilberk, vojenskou pevnost s úžasným výhledem na Brno – Novinykraje.cz](https://www.novinykraje.cz/blog/2022/01/19/navstivte-spilberk-vojenskou-pevnost-s-uzasnym-vyhledem-na-brno)
- [Stará radnice (Brno) – Wikipedie](https://cs.wikipedia.org/wiki/Star%C3%A1_radnice_(Brno))
- [Stará radnice v Brně – Kudy z nudy](https://www.kudyznudy.cz/aktivity/stara-radnice-v-brne)
- [Brněnská Stará radnice: křivá věž, kolo a drak – Radio Prague International](https://cesky.radio.cz/brnenska-stara-radnice-kriva-vez-kolo-a-drak-8094566)
- [Kameník Pilgram proklel svůj portál – Brněnský deník](https://brnensky.denik.cz/serialy/chodec_kamenik_pilgram_2007103.html)
- [Brněnský drak – Wikipedie](https://cs.wikipedia.org/wiki/Brn%C4%9Bnsk%C3%BD_drak)
- [Brněnská Stará radnice a pověst o Brněnském draku a kolu – cestovniky.cz](https://www.cestovniky.cz/2025/08/brnenska-stara-radnice-povest-o.html)
- [Náměstí Svobody (Brno) – Wikipedie](https://cs.wikipedia.org/wiki/N%C3%A1m%C4%9Bst%C3%AD_Svobody_(Brno))
- [Morový sloup (Brno) – Wikipedie](https://cs.wikipedia.org/wiki/Morov%C3%BD_sloup_(Brno))
- [Morový sloup – Památky Brno](https://pamatkybrno.cz/morovy-sloup/)
- [Brněnský orloj – Wikipedie](https://cs.wikipedia.org/wiki/Brn%C4%9Bnsk%C3%BD_orloj)
- [Brněnský orloj není z černé žuly, tvrdí odborník z VUT – ČT24](https://ct24.ceskatelevize.cz/clanek/archiv/brnensky-orloj-neni-z-cerne-zuly-tvrdi-odbornik-z-vut-281150)
- [Dům nadace Valentina Gerstbauera – Wikipedie](https://cs.wikipedia.org/wiki/D%C5%AFm_U_%C4%8Cty%C5%99_mamlas%C5%AF)
- [náměstí Svobody 10/74, dům U čtyř mamlasů – encyklopedie.brna.cz](https://encyklopedie.brna.cz/home-mmb/?acc=profil_domu&load=406)
- [náměstí Svobody 17/86, Schwanzův palác – encyklopedie.brna.cz](https://encyklopedie.brna.cz/home-mmb/?acc=profil-domu&load=3)
- [Dům pánů z Lipé – Wikipedie](https://cs.wikipedia.org/wiki/D%C5%AFm_p%C3%A1n%C5%AF_z_Lip%C3%A9)
- [archiweb.cz - Palác OMEGA](https://www.archiweb.cz/b/palac-omega)
- [Palác Omega budil po otevření kontroverzní reakce – Brněnský deník](https://brnensky.denik.cz/zpravy-region/brno-omega-palac-namesti-svobody-kontroverze-orloj-stavba-20-let/)
- [Zelný trh (Brno) – Wikipedie](https://cs.wikipedia.org/wiki/Zeln%C3%BD_trh_(Brno))
- [Kašna Parnas – Wikipedie](https://cs.wikipedia.org/wiki/Ka%C5%A1na_Parnas)
- [Divadlo Reduta – Wikipedie](https://cs.wikipedia.org/wiki/Divadlo_Reduta)
- [Reduta Theatre – Wikipedia (en)](https://en.wikipedia.org/wiki/Reduta_Theatre)
- [Brno-Zelný trh - divadlo Reduta – Turistika.cz](https://www.turistika.cz/mista/brno-zelny-trh-divadlo-reduta/detail)
- [Mahenovo divadlo – Wikipedie](https://cs.wikipedia.org/wiki/Mahenovo_divadlo)
- [Mahen Theatre – Národní divadlo Brno](https://www.ndbrno.cz/en/about-us/buildings/mahen-theatre/)
- [Mahenovo divadlo – první divadlo s elektrickým osvětlením v Evropě – Kudy z nudy](https://www.kudyznudy.cz/ceska-nej/kulturni/mahenovo-divadlo)
- [Janáčkovo divadlo – Wikipedie](https://cs.wikipedia.org/wiki/Jan%C3%A1%C4%8Dkovo_divadlo)
- [Moravian Square (Moravské náměstí) – Go To Brno](https://www.gotobrno.cz/en/place/moravian-square-moravske-namesti/)
- [Kostel svatého Tomáše (Brno) – Wikipedie](https://cs.wikipedia.org/wiki/Kostel_svat%C3%A9ho_Tom%C3%A1%C5%A1e_(Brno))
- [Moravské náměstí – srdce Brna, které nikdy nespí – Památky Brno](https://pamatkybrno.cz/moravske-namesti-srdce-brna-ktere-nikdy-nespi/)
- [Brněnský jezdec, který pobavil svět: Socha Jošta slaví 10 let – Radio Prague International](https://cesky.radio.cz/brnensky-jezdec-ktery-pobavil-svet-socha-josta-slavi-10-let-8865850)
- [Socha markraběte Jošta v Brně – Kudy z nudy](https://www.kudyznudy.cz/aktivity/socha-markrabete-josta-v-brne)
- [Brno hlavní nádraží – Wikipedie](https://cs.m.wikipedia.org/wiki/Brno_hlavn%C3%AD_n%C3%A1dra%C5%BE%C3%AD)
- [Secesní přestavba budovy hlavního nádraží – Brněnský architektonický manuál](https://www.bam.brno.cz/objekt/B001-secesni-prestavba-budovy-hlavniho-nadrazi)
- [Hlavní nádraží (terminál MHD v Brně) – Wikipedie](https://cs.wikipedia.org/wiki/Hlavn%C3%AD_n%C3%A1dra%C5%BE%C3%AD_(termin%C3%A1l_MHD_v_Brn%C4%9B))
- [Vila Tugendhat Brno: Ikonický symbol funkcionalismu – Kudy z nudy](https://www.kudyznudy.cz/ceska-nej/unesco/vila-tugendhat-brne)
- [Seznam funkcionalistických staveb v Brně – Wikipedie](https://cs.wikipedia.org/wiki/Seznam_funkcionalistick%C3%BDch_staveb_v_Brn%C4%9B)
- [Smaltované uliční cedule a domovní čísla – Alerion](https://www.alerion.cz/smaltovane-ulicni-cedule-domovni-cisla)
- [Smaltovaná uliční tabule s názvem ulice (brněnská norma) – Alerion shop](https://shop.alerion.cz/smaltovana-ulicni-tabule-s-nazvem-ulice-brnenska-norma)
- [Novinky ve vozovém parku DPMB - rok 2023 – bmhd.cz](https://www.bmhd.cz/aktuality/?rubrika=1&rok=2023)
- [Trams in Brno – Wikipedia (en)](https://en.wikipedia.org/wiki/Trams_in_Brno)
- [Tramvajová doprava v Brně – Wikipedie](https://cs.wikipedia.org/wiki/Tramvajov%C3%A1_doprava_v_Brn%C4%9B)
- [Nový design tramvají může na lidi působit jako stroboskop – Aktuálně.cz](https://zpravy.aktualne.cz/domaci/design-tramvaje-je-umeni-rika-historik-pavel-fojtik/r~f36e5b4ad64e11ea80e60cc47ab5f122/?lp=1)
- [Tramvajová doprava v Brně (1900–1918) – Wikipedie](https://cs.wikipedia.org/wiki/Tramvajov%C3%A1_doprava_v_Brn%C4%9B_(1900%E2%80%931918))
- [Významné parky města Brna (PDF) – brno.cz](https://www.brno.cz/documents/20121/236120/vyznamne_parky_mesta_Brna.pdf/cf3e4bea-2efa-dae8-1c38-e8e4bb43d3a6)
- [Lipová alej na Vodově v Brně – alejroku.cz](https://alejroku.cz/2025/lipova-alej-na-vodove-v-brne)

---

## Addendum: townhouse proportions (added by the lead, not web-sourced)

Gap #8 above is the one that matters most in practice — it governs ~1400 buildings, i.e.
most of every frame — so leaving it as UNKNOWN is not workable. The figures below are
**Central European historicist/baroque-classicist building convention**, not Brno-specific
survey data. They are the numbers a period-accurate old-town block is built from anywhere
between Vienna and Wrocław, and Brno's core is squarely in that tradition. Treat them as
defensible defaults, and label anything derived from them as convention rather than fact.

**Vertical rhythm** (street level upward, metres):

| Storey | Height | Notes |
| --- | --- | --- |
| Parter (ground, commercial) | 3.8–4.5 | tallest; shopfront glazing 2.4–3.0 with a sign band above |
| Mezzanine (where present) | 2.4–2.8 | squat windows, often a lower cornice below it |
| Piano nobile (1st) | 3.4–4.0 | tallest residential floor, richest window surround, sometimes a balcony |
| Upper floors (2nd–3rd) | 3.0–3.4 | diminishing slightly with height |
| Top floor / attic storey | 2.6–3.0 | plainer surrounds, smaller windows |

- Eaves height for a typical 4-storey house: **15–18 m**. Ridge: **22–26 m**.
- Storey heights *diminish* going up. Equal floor heights are the single most common
  tell of procedurally generated architecture — vary them.

**Horizontal rhythm:**

- Bay spacing (axis to axis): **2.6–3.6 m**, most commonly ~3.0. The existing
  `BAY_W = 3.4` / `FLOOR_H = 3.6` in `src/textures.js` sits at the upper end of both
  ranges — acceptable, but a little generous; consider 3.1 / 3.4.
- Window opening: **1.1–1.4 m wide × 1.8–2.4 m tall**, i.e. roughly **1 : 1.7 portrait**.
  Never square. Squareness is the second tell.
- Plot frontage: **8–14 m** (medieval plot widths survive under later facades), so a
  typical house is only **3–5 bays wide**. Long unbroken 12-bay facades are wrong for
  the old core — break the street wall into narrow houses with differing eaves heights,
  plaster colours and roof ridges. This is the highest-impact single note in this file.
- Plot depth **30–50 m**, with a carriage passage to a rear courtyard (corroborated
  typology in the sourced section above).

**Detail:**

- Roof pitch **40–50°** for clay pantile; steeper (50–60°) on gothic-origin gables.
- Main cornice projection **0.4–0.8 m**, with a string course at each floor line on
  richer facades and none on plainer ones.
- Ground floor often rusticated or banded; upper floors smooth plaster.
- Downpipes at every party wall, wall staining below every sill and downpipe.
- Roof ridges run **parallel to the street** on later facades, gable-to-street on
  surviving gothic/renaissance houses. Mix both; gable-to-street should be the minority.

**CONFIDENCE: these are conventions, deliberately generic.** They will read as correct
period architecture. They are not a survey of any specific Brno street, and nothing
built from them should be described as measured.
