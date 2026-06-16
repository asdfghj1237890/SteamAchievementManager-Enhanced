import type { Achievement, Game, Stat } from '../types'

// Ported verbatim from the Claude Design handoff (buildData()).
// Fictional games only — no real Steam titles, to avoid trademark issues.

type AchRow = [name: string, desc: string, rarity: number, unlocked: number, kind?: 'h' | 'p']
type StatRow = [name: string, value: number, extra?: string, protectedFlag?: 0 | 1]

const mk = (g: string, rows: AchRow[]): Achievement[] =>
  rows.map((r, i) => ({
    id: `${g}_a${i}`,
    name: r[0],
    desc: r[1],
    rarity: r[2],
    unlocked: !!r[3],
    hidden: r[4] === 'h',
    protected: r[4] === 'p',
    points: 100 - r[2],
  }))

const st = (rows: StatRow[]): Stat[] =>
  rows.map((r, i) => ({
    id: `st${i}`,
    name: r[0],
    value: r[1],
    extra: r[2] ?? '',
    protected: !!r[3],
  }))

export const GAMES: Game[] = [
  {
    id: '487120', name: 'Nebula Drift', genre: 'Space Racing', type: 'normal', hue: 212, appId: '487120', y: 2024, m: 11, last: '2024/11/02',
    achievements: mk('g1', [
      ['Maiden Voyage', 'Finish your first race', 74, 1], ['Sound Barrier', 'Break the sound barrier in a single boost', 58, 1],
      ['Perfect Cornering', 'Clear 10 corners in a row without scraping', 41, 1], ['Zero-G Stunt', 'Complete three mid-air barrel rolls', 26, 1],
      ['Long Haul', 'Fly 1,000 km in total', 33, 1], ['Full Cargo', 'Collect 50 stardust in one run', 22, 1],
      ['Ring Champion', 'Win the Saturn Ring circuit', 12, 0], ['Lightspeed', 'Set a lap under 40 seconds', 9, 0],
      ['Hangar Collector', 'Unlock all 12 ships', 6, 0], ['Unbeaten Streak', 'Win 15 races in a row', 5, 0],
      ['Hidden Lane', 'Discover the secret wormhole shortcut', 4, 0, 'h'], ['Ranked Elite', 'Reach the online top 100', 2, 0, 'p'],
    ]),
    stats: st([['Total Races', 128, 'cumulative'], ['Top Speed (km/h)', 942, 'season best'], ['Perfect Corners', 317, ''], ['Distance Flown (km)', 1043, 'milestone 1000'], ['Ranked Score', 2480, 'protected', 1]]),
  },
  {
    id: '503310', name: 'Hollow Keep', genre: 'Dark Action RPG', type: 'normal', hue: 282, appId: '503310', y: 2025, m: 1, last: '2025/01/18',
    achievements: mk('g2', [
      ['First Descent', 'Reach the first save bonfire', 81, 1], ['Bellslayer', 'Defeat the boss "Echoing Bell"', 47, 1],
      ['Broken Dawn', 'Obtain the Shattered Moon Blade', 35, 1], ['Untouched', 'Defeat an elite enemy without taking damage', 19, 1],
      ['Scavenger', 'Pick up 200 items', 44, 1], ['Unbroken', 'Die 100 times', 38, 1],
      ['Abyssal Echo', 'Reach the fifth underground level', 23, 0], ['Cartographer', 'Light up every map region', 14, 0],
      ['Soul Hoarder', 'Amass 1,000,000 souls', 11, 0], ['Bare-Handed', 'Defeat a boss with no weapon equipped', 7, 0],
      ['True Ending', 'Reach the hidden true ending', 6, 0, 'h'], ['Speedrun', 'Finish the game within 3 hours', 3, 0, 'p'],
    ]),
    stats: st([['Deaths', 114, ''], ['Souls Earned', 842300, ''], ['Bosses Defeated', 9, 'of 22'], ['Items Collected', 206, ''], ['Playtime', 47, 'hours']]),
  },
  {
    id: '471050', name: 'Bistro Days', genre: 'Cozy Cooking Sim', type: 'normal', hue: 28, appId: '471050', y: 2025, m: 2, last: '2025/02/03',
    achievements: mk('g3', [
      ['Grand Opening', 'Complete your first day of business', 92, 1], ['Five Stars', 'Earn your first five-star review', 71, 1],
      ['Practice Makes Perfect', 'Cook 100 dishes', 55, 1], ['Full House', 'Serve 40 guests in one day', 29, 1],
      ['Farm Owner', 'Grow 50 ingredients', 24, 1], ['Regular', 'Have one guest visit 20 times', 16, 1],
      ['Seasonal', 'Complete every seasonal event', 13, 0], ['Road to Michelin', 'Earn your restaurant three stars', 8, 0],
      ['Perfect Week', 'Seven straight days of all five-stars', 6, 0], ['Secret Recipe', 'Unlock the hidden dessert recipe', 18, 0, 'h'],
    ]),
    stats: st([['Dishes Cooked', 1120, ''], ['Total Revenue', 58400, 'coins'], ['Guests Served', 2043, ''], ['Average Rating', 47, '×0.1 = 4.7'], ['Days Open', 86, '']]),
  },
  {
    id: '492440', name: 'Iron Vanguard', genre: 'Tactical Shooter', type: 'normal', hue: 6, appId: '492440', y: 2024, m: 12, last: '2024/12/21',
    achievements: mk('g4', [
      ['Boot Camp', 'Complete basic training', 95, 1], ['First Win', 'Win your first match', 77, 1],
      ['Sharpshooter', 'Land 100 headshots', 39, 1], ['Bomb Defuser', 'Defuse 25 bombs', 27, 1],
      ['Sergeant', 'Reach the rank of Staff Sergeant', 12, 1], ['Killstreak', 'Get a 10-kill streak in one match', 21, 0],
      ['All-Rounder', 'Get a kill with every weapon', 15, 0], ['Veteran', 'Play 500 matches', 9, 0],
      ['Shutout', 'Win a round without conceding a point', 6, 0], ['Undercover', 'Complete the hidden spy storyline', 5, 0, 'h'],
      ['Ranked Legend', 'Reach the competitive top 50', 2, 0, 'p'],
    ]),
    stats: st([['Total Kills', 8421, ''], ['Headshots', 1033, ''], ['Matches Played', 431, ''], ['Wins', 230, '53% win rate'], ['Accuracy', 24, '%']]),
  },
  {
    id: '466130', name: 'Petal & Tide', genre: 'Atmospheric Puzzle', type: 'demo', hue: 168, appId: '466130', y: 2025, m: 2, last: '2025/02/11',
    achievements: mk('g5', [
      ['First Bloom', 'Solve your first puzzle', 96, 1], ['Eye of the Tide', 'Complete the water chapter', 62, 1],
      ['Language of Flowers', 'Collect all 8 petals', 34, 1], ['In One Breath', 'Finish a chapter without hints', 28, 1],
      ['Gardener', 'Water plants 100 times', 45, 1], ['Stargazer', 'Find every hidden star', 9, 0],
      ['Stillness', 'Play for 10 hours total', 31, 0], ['All Chapters', 'Complete every chapter', 13, 0],
      ['Perfect Symmetry', 'Find the hidden symmetric solution', 11, 0, 'h'],
    ]),
    stats: st([['Puzzles Solved', 214, ''], ['Hints Used', 12, ''], ['Petals Collected', 38, 'of 40'], ['Playtime', 9, 'hours'], ['Perfect Solutions', 47, '']]),
  },
  {
    id: '451780', name: 'Last Transmission', genre: 'Survival Horror', type: 'normal', hue: 142, appId: '451780', y: 2024, m: 10, last: '2024/10/29',
    achievements: mk('g6', [
      ['Signal', 'Receive the first mysterious transmission', 88, 1], ['Survive the Night', 'Make it through the first night', 69, 1],
      ['Fragments of Truth', 'Collect 10 documents', 41, 1], ['Silent Steps', 'Pass an area undetected', 19, 1],
      ['Resourceful', 'Craft 30 items', 26, 1], ['Power Saver', 'Survive a night on minimal power', 22, 0],
      ['Last Transmission', 'Reach the comms tower', 12, 0], ['Dawn', 'Get rescued', 9, 0],
      ['All Alone', 'Finish without relying on allies', 7, 0], ['Into the Abyss', 'Trigger the hidden ending', 4, 0, 'h'],
    ]),
    stats: st([['Nights Survived', 6, 'of 12'], ['Documents Found', 23, ''], ['Items Crafted', 34, ''], ['Times Detected', 8, ''], ['Power Remaining', 62, '%']]),
  },
  {
    id: '512200', name: 'Skybound Saga', genre: 'Open-World Adventure', type: 'normal', hue: 198, appId: '512200', y: 2025, m: 1, last: '2025/01/30',
    achievements: mk('g7', [
      ['Departure', 'Leave the starting village', 93, 1], ['Dragon Tamer', 'Tame your first dragon', 58, 1], ['Treasure Hunter', 'Uncover 25 treasures', 37, 1],
      ['Herbalist', 'Gather 100 plant types', 44, 1], ['Summit', 'Climb the highest peak in the world', 16, 0], ['Full Explorer', 'Unlock the entire world map', 11, 0],
      ['Castle in the Sky', 'Discover the floating ruins', 8, 0, 'h'], ['Legendary Hunter', 'Slay the ancient behemoth', 5, 0, 'p'],
    ]),
    stats: st([['Areas Explored', 58, 'of 80'], ['Creatures Tamed', 12, ''], ['Items Gathered', 640, ''], ['Playtime', 31, 'hours'], ['Quests Completed', 96, '']]),
  },
  {
    id: '528900', name: 'Pixel Forge', genre: 'Pixel Crafting', type: 'normal', hue: 48, appId: '528900', y: 2025, m: 2, last: '2025/02/06',
    achievements: mk('g8', [
      ['First Brick', 'Place your first block', 96, 1], ['Architect', 'Build 50 structures', 49, 1], ['Miner', 'Mine 1,000 ores', 55, 1],
      ['Bountiful Harvest', 'Harvest 500 crops', 38, 1], ['Redstone Master', 'Build an automated contraption', 21, 0], ['Sky City', 'Build a city in the clouds', 13, 0],
      ['Hidden Blueprint', 'Unlock the secret recipe book', 9, 0, 'h'], ['Sleepless Crafter', 'Play for 8 hours straight', 7, 0],
    ]),
    stats: st([['Blocks Placed', 24800, ''], ['Ores Mined', 1042, ''], ['Structures Built', 57, ''], ['Crops Harvested', 511, ''], ['Days Played', 42, '']]),
  },
  {
    id: '533700', name: 'Neon Circuit', genre: 'Cyber Racing', type: 'normal', hue: 320, appId: '533700', y: 2024, m: 12, last: '2024/12/15',
    achievements: mk('g9', [
      ['Neon Debut', 'Finish your first night race', 90, 1], ['Drift King', 'Drift for 5 seconds straight', 46, 1], ['Overclock', 'Enable the top-tier engine', 28, 1],
      ['Night Rider', 'Win every night track', 19, 0], ['Flawless', 'Win without hitting a wall', 14, 0], ['Gearhead', 'Unlock every mod part', 8, 0],
      ['Passcode', 'Find the hidden track', 6, 0, 'h'], ['Ghost Time', 'Beat the developer record', 4, 0, 'p'],
    ]),
    stats: st([['Races', 176, ''], ['Fastest Lap', 41, 'sec'], ['Drift Distance', 12400, 'm'], ['Wins', 88, ''], ['Mod Parts', 23, 'of 40']]),
  },
  {
    id: '540100', name: 'Quiet Harbor', genre: 'Narrative Adventure', type: 'demo', hue: 190, appId: '540100', y: 2025, m: 2, last: '2025/02/09',
    achievements: mk('g10', [
      ['Arrival', 'Reach Quiet Harbor', 97, 1], ['Listen', 'Finish your first conversation', 81, 1], ['Messenger', 'Deliver 10 letters', 43, 1],
      ['Wanderer', 'Visit every location', 24, 1], ['Tidal Zone', 'Collect every seashell', 17, 0], ['Lighthouse', 'Repair the old lighthouse', 12, 0],
      ['Revelation', 'Trigger the hidden memory', 7, 0, 'h'], ['Farewell', 'Reach the ending', 9, 0],
    ]),
    stats: st([['Conversations', 142, ''], ['Letters Delivered', 11, ''], ['Locations Visited', 14, 'of 18'], ['Seashells Found', 22, ''], ['Playtime', 6, 'hours']]),
  },
  {
    id: '547800', name: 'Crimson Legion', genre: 'Tactics Strategy', type: 'normal', hue: 354, appId: '547800', y: 2025, m: 1, last: '2025/01/22',
    achievements: mk('g11', [
      ['First Battle', 'Win your first campaign battle', 88, 1], ['Conqueror', 'Capture 20 cities', 41, 1], ['One Against Many', 'Have one unit destroy 100 enemies', 26, 1],
      ['Master Tactician', 'Clear a stage with no losses', 33, 1], ['Great General', 'Unlock a legendary commander', 15, 0], ['Iron Wall', 'Win every defensive battle', 11, 0],
      ['Shadow Legion', 'Discover the hidden faction', 6, 0, 'h'], ['Unification', 'Conquer the entire map', 3, 0, 'p'],
    ]),
    stats: st([['Campaign Wins', 74, ''], ['Cities Captured', 23, ''], ['Units Destroyed', 5210, ''], ['Commanders Recruited', 9, 'of 30'], ['Playtime', 38, 'hours']]),
  },
  {
    id: '551200', name: 'Star Botanist', genre: 'Space Farming', type: 'normal', hue: 96, appId: '551200', y: 2025, m: 2, last: '2025/02/12',
    achievements: mk('g12', [
      ['First Sprout', 'Plant your first interstellar plant', 95, 1], ['Pollinator', 'Pollinate 50 times', 52, 1], ['Greenhouse Keeper', 'Build a planetary greenhouse', 29, 1],
      ['Alien Garden', 'Cultivate 30 species', 23, 1], ['Harvest Season', 'Harvest 200 in one season', 34, 1], ['Symbiosis', 'Achieve ecological balance', 13, 0],
      ['Gene Wizard', 'Unlock a rare mutation', 8, 0, 'h'], ['Terraformer', 'Green an entire planet', 5, 0],
    ]),
    stats: st([['Plants Grown', 430, ''], ['Species', 28, 'of 40'], ['Pollinations', 61, ''], ['Harvested', 212, ''], ['Days Played', 27, '']]),
  },
  {
    id: '559900', name: 'Dungeon Brew', genre: 'Roguelite Brewing', type: 'normal', hue: 35, appId: '559900', y: 2024, m: 11, last: '2024/11/20',
    achievements: mk('g13', [
      ['Open for Business', 'Sell your first brew', 92, 1], ['Adventurous Mixer', 'Brew 30 recipes', 48, 1], ['Deep Dungeon', 'Reach floor 10', 27, 1],
      ['Winning Streak', 'Win 20 in a row', 22, 1], ['Perfect Pour', 'Earn a perfect rating', 19, 0], ['Black Market', 'Unlock the hidden merchant', 11, 0],
      ['Ulterior Motive', 'Trigger the secret storyline', 7, 0, 'h'], ['Legendary Recipe', 'Brew a legendary potion', 5, 0, 'p'],
    ]),
    stats: st([['Brews Made', 880, ''], ['Recipes', 31, ''], ['Deepest Floor', 12, ''], ['Revenue', 43200, 'coins'], ['Best Streak', 24, '']]),
  },
  {
    id: '562400', name: 'Echo Protocol', genre: 'Sci-Fi Stealth', type: 'normal', hue: 250, appId: '562400', y: 2025, m: 1, last: '2025/01/12',
    achievements: mk('g14', [
      ['Online', 'Complete system calibration', 94, 1], ['Intrusion', 'Hack 25 terminals', 39, 1], ['Overload', 'Take down the mainframe', 21, 1],
      ['Ghost', 'Clear a level without triggering an alarm', 31, 1], ['No Trace', 'Finish with zero kills', 16, 0], ['Data Broker', 'Collect all intel', 12, 0],
      ['Backdoor', 'Discover the hidden path', 8, 0, 'h'], ['Protocol End', 'Reach the true ending', 5, 0],
    ]),
    stats: st([['Levels Infiltrated', 26, 'of 32'], ['Terminals Hacked', 27, ''], ['Alarms Triggered', 9, ''], ['Intel Fragments', 40, ''], ['Playtime', 14, 'hours']]),
  },
  {
    id: '568100', name: 'Meadow Tactics', genre: 'Card Tactics', type: 'mod', hue: 130, appId: '568100', y: 2025, m: 2, last: '2025/02/04',
    achievements: mk('g15', [
      ['Starter Deck', 'Build your first deck', 96, 1], ['Chain', 'Land a 5-hit combo', 54, 1], ['Collector', 'Collect 80 cards', 37, 1],
      ['Perfect Defense', 'Win without losing health', 22, 1], ['Chosen Card', 'Draw a legendary card', 14, 0], ['Hundred Battles', 'Win 100 matches', 12, 0],
      ['Hidden Cartridge', 'Unlock the secret deck', 9, 0, 'h'], ['Card God', 'Reach the top of the ladder', 4, 0, 'p'],
    ]),
    stats: st([['Matches Played', 221, ''], ['Cards Collected', 82, 'of 120'], ['Best Combo', 7, ''], ['Wins', 128, ''], ['Ladder Score', 1640, '']]),
  },
  {
    id: '573600', name: 'Glacier Run', genre: 'Arctic Survival', type: 'demo', hue: 205, appId: '573600', y: 2024, m: 12, last: '2024/12/28',
    achievements: mk('g16', [
      ['Set Out', 'Step onto the ice field', 91, 1], ['Make Fire', 'Survive the first cold night', 70, 1], ['Forager', 'Gather 50 resources', 44, 1],
      ['Hunter', 'Hunt 15 animals', 26, 1], ['Whiteout', 'Navigate through a blizzard', 20, 0], ['Ice Cavern', 'Discover an underground ice cave', 12, 0],
      ['Aurora', 'Witness the hidden aurora', 7, 0, 'h'], ['The End of the Trail', 'Cross the glacier', 9, 0],
    ]),
    stats: st([['Days Survived', 7, 'of 14'], ['Resources Gathered', 58, ''], ['Body Temp', 36, '°C'], ['Distance Traveled', 42, 'km'], ['Animals Hunted', 16, '']]),
  },
]
