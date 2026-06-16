// Candidate Steam App IDs to test ownership against (Phase 2 slice).
//
// The original SAM downloads the full master list from gib.me/sam/games.xml and
// checks every entry. As a self-contained slice we ship a spread of well-known
// public App IDs so owned titles surface with their real Steam names. Replacing
// this with the live games.xml fetch is a documented follow-up.
export const STEAM_APP_IDS: number[] = [
  480, // Spacewar (Steamworks SDK sample)
  220, 240, 320, 340, 360, 380, 400, 420, 620, // Valve
  440, 500, 550, 570, 730, 4000, // TF2, L4D, Dota2, CS2, GMod
  8930, 105600, 22380, 72850, 489830, 377160, // Civ5, Terraria, FNV, Skyrim(+SE), FO4
  271590, 292030, 374320, 814380, 1245620, // GTAV, Witcher3, DS3, Sekiro, Elden Ring
  1085660, 230410, 252490, 304930, 322330, 413150, 945360, // Destiny2, Warframe, Rust, Unturned, DST, Stardew, Among Us
  1086940, 367520, 268910, 504230, 588650, 646570, 632360, 1145360, // BG3, Hollow Knight, Cuphead, Celeste, Dead Cells, StS, RoR2, Hades
  236850, 294100, 255710, 427520, 813780, // Stellaris, RimWorld, Cities Skylines, Factorio, AoE2 DE
  49520, 397540, 1172470, 359550, 578080, // Borderlands2/3, Apex, R6 Siege, PUBG
  1091500, 275850, 526870, 648800, 211820, 239140, 261550, // Cyberpunk, NMS, Satisfactory, Raft, Starbound, Dying Light, Bannerlord
  1174180, 1593500, 990080, // RDR2, God of War, Hogwarts Legacy
]
