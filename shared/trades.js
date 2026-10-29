// ============================================================================
// Villager jobs and what they trade. Emeralds are the money: villagers buy
// things you have plenty of (wheat, paper, coal...) and sell useful things.
// Each offer: [[give item, count], (optional second item)] -> [get item, count].
// Shared so the server can send a villager's list and the client can show it.
// ============================================================================
export const PROFESSIONS = ['farmer', 'librarian', 'smith', 'butcher', 'cleric', 'fletcher'];

// Robe colours, so you can tell villagers' jobs apart.
export const PROFESSION_COLORS = {
  farmer: ['#6b4a2b', '#5a3d22'], librarian: ['#e8e4dc', '#c8c0b0'], smith: ['#2e2e2e', '#4a3a2a'],
  butcher: ['#d8d0c8', '#a83a2a'], cleric: ['#7a3a9a', '#5a2a72'], fletcher: ['#4a7a3a', '#3a5a2a'],
};

export const TRADES = {
  farmer: [
    [[['wheat', 20]], ['emerald', 1]], [[['carrot', 15]], ['emerald', 1]], [[['potato', 15]], ['emerald', 1]],
    [[['pumpkin', 6]], ['emerald', 1]], [[['emerald', 1]], ['bread', 6]], [[['emerald', 1]], ['apple', 4]],
    [[['emerald', 1]], ['pumpkin_pie', 4]], [[['emerald', 3]], ['golden_carrot', 3]],
  ],
  librarian: [
    [[['paper', 24]], ['emerald', 1]], [[['book', 8]], ['emerald', 1]], [[['emerald', 1]], ['bookshelf', 1]],
    [[['emerald', 1]], ['glass', 4]], [[['emerald', 5], ['book', 1]], ['enchanted_book', 1]],
    [[['emerald', 1]], ['compass', 1]], [[['emerald', 2]], ['clock', 1]], [[['emerald', 8]], ['empty_map', 1]],
  ],
  smith: [
    [[['coal', 15]], ['emerald', 1]], [[['iron_ingot', 6]], ['emerald', 1]], [[['diamond', 1]], ['emerald', 2]],
    [[['emerald', 6]], ['iron_pickaxe', 1]], [[['emerald', 5]], ['iron_sword', 1]], [[['emerald', 4]], ['iron_helmet', 1]],
    [[['emerald', 9]], ['chainmail_chestplate', 1]], [[['emerald', 6]], ['chainmail_leggings', 1]],
    [[['emerald', 3]], ['chainmail_boots', 1]], [[['emerald', 18]], ['diamond_sword', 1]], [[['emerald', 22]], ['diamond_pickaxe', 1]],
  ],
  butcher: [
    [[['raw_porkchop', 14]], ['emerald', 1]], [[['raw_chicken', 14]], ['emerald', 1]], [[['raw_beef', 12]], ['emerald', 1]],
    [[['coal', 16]], ['emerald', 1]], [[['emerald', 1]], ['cooked_porkchop', 6]], [[['emerald', 1]], ['cooked_chicken', 8]],
    [[['emerald', 1]], ['steak', 5]], [[['emerald', 3]], ['leather_chestplate', 1]],
  ],
  cleric: [
    [[['rotten_flesh', 32]], ['emerald', 1]], [[['gold_ingot', 3]], ['emerald', 1]], [[['emerald', 1]], ['redstone', 3]],
    [[['emerald', 1]], ['lapis_lazuli', 2]], [[['emerald', 3]], ['ender_pearl', 1]], [[['emerald', 2]], ['experience_bottle', 1]],
    [[['emerald', 4]], ['glowstone', 1]], [[['emerald', 12]], ['golden_apple', 1]],
  ],
  fletcher: [
    [[['string', 24]], ['emerald', 1]], [[['flint', 16]], ['emerald', 1]], [[['emerald', 1]], ['arrow', 12]],
    [[['emerald', 3]], ['bow', 1]], [[['emerald', 1]], ['fishing_rod', 1]], [[['emerald', 1], ['gravel', 10]], ['flint', 10]],
    [[['emerald', 2]], ['shield', 1]],
  ],
};
