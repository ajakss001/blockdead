import { type ItemId, ITEMS } from '../data/items';
import type { Inventory } from './Inventory';
import type { PlacedKind } from './Base';

/*
 * Crafting from what is found (Zomboid, much smaller): rags from shirts, bandages and clean water boiled at a
 * fire, tape round a worn handle, nails pulled out of junk — and the things a base is made of, set down in
 * front of the survivor (a fire, a rain collector, a chest, a tripwire with cans). Pure data and checks;
 * the inventory panel lists them, the scene places what is built. Adding a recipe = adding an entry here.
 */

export interface Recipe {
  id: string;
  name: string;
  about: string;
  /** Used up: an item (or any one of several) and how many. */
  needs: [ItemId | ItemId[], number][];
  /** Needed but kept (any one of the list). */
  tool?: ItemId[];
  /** Fire to start it: a lighter, or a match used up. */
  kindle?: boolean;
  /** Only by a burning fire. */
  fire?: boolean;
  gives?: [ItemId, number];
  /** Set down in front of the survivor. */
  place?: PlacedKind;
  /** Tape on the weapon in hand: this much of its wear taken back. */
  repair?: number;
  /** Carpentry XP. */
  xp?: number;
}

/** Shirts that tear into rags (from the bag, not worn). */
const SHIRTS: ItemId[] = ['tshirt', 'officeShirt', 'scrubsTop', 'policeShirt', 'hoodie'];

export const RECIPES: readonly Recipe[] = [
  { id: 'rags', name: 'Порвать на тряпки', about: 'Рубашка или футболка → 3 тряпки', needs: [[SHIRTS, 1]], gives: ['rag', 3] },
  { id: 'bandage', name: 'Прокипятить бинты', about: '2 тряпки → 2 бинта (у костра)', needs: [['rag', 2]], fire: true, gives: ['bandage', 2] },
  { id: 'boil', name: 'Вскипятить воду', about: 'Дождевая вода → чистая (у костра)', needs: [['dirtyWater', 1]], fire: true, gives: ['water', 1] },
  { id: 'repair', name: 'Обмотать рукоять', about: 'Скотч на оружие в руке: прочность +35%', needs: [['tape', 1]], repair: 0.35 },
  { id: 'nails', name: 'Надёргать гвоздей', about: '2 хлама → 5 гвоздей (молоток или монтировка)', needs: [['junk', 2]], tool: ['hammer', 'crowbar'], gives: ['nails', 5] },
  { id: 'fire', name: 'Костёр', about: 'Греет, светит, на нём кипятят. Горит ~4 ч, подбросить доску — ещё 3 ч', needs: [['planks', 1], ['junk', 1]], kindle: true, place: 'fire' },
  { id: 'barrel', name: 'Сборник дождевой воды', about: 'Ставится снаружи, в дождь набирается вода', needs: [['planks', 2], ['junk', 2], ['nails', 6]], tool: ['hammer'], place: 'barrel', xp: 20 },
  { id: 'stash', name: 'Сундук', about: 'Сюда можно сложить вещи — они останутся', needs: [['planks', 3], ['nails', 10]], tool: ['hammer'], place: 'stash', xp: 25 },
  { id: 'trap', name: 'Растяжка с банками', about: 'Звенит, когда зомби задевает её, — и уводит их на звук', needs: [['rope', 1], ['junk', 2]], place: 'trap', xp: 8 },
];

/** What the scene tells the recipe list. */
export interface CraftWorld {
  inventory: Inventory;
  /** A burning fire within reach. */
  nearFire(): boolean;
  /** Puts it down in front of the survivor; an error to show, or null when it stands. */
  place(kind: PlacedKind): string | null;
  onXp(xp: number): void;
}

/** Which of `ids` is in the bag (the first found). */
function have(inv: Inventory, need: ItemId | ItemId[], n: number): ItemId | null {
  for (const id of Array.isArray(need) ? need : [need]) if (inv.count(id) >= n) return id;
  return null;
}

/** Why it can't be made now, or null. */
export function blocker(r: Recipe, w: CraftWorld): string | null {
  const inv = w.inventory;
  for (const [need, n] of r.needs) if (!have(inv, need, n)) return `нет: ${needName(need)}${n > 1 ? ` ×${n}` : ''}`;
  if (r.tool && !r.tool.some((t) => inv.count(t) > 0 || inv.hand === t)) return `нужен ${r.tool.map((t) => ITEMS[t].name.toLowerCase()).join(' или ')}`;
  if (r.kindle && inv.count('lighter') === 0 && inv.count('matches') === 0) return 'нужны спички или зажигалка';
  if (r.fire && !w.nearFire()) return 'нужен горящий костёр рядом';
  if (r.repair && (!inv.hand || !ITEMS[inv.hand].durability)) return 'возьмите оружие в руку';
  if (r.repair && inv.handWear <= 0.01) return 'оружие и так целое';
  if (r.gives && inv.room(r.gives[0]) < 1) return 'рюкзак переполнен';
  return null;
}

/** Makes it: uses the parts up, gives the result. A message for the toast. */
export function craft(r: Recipe, w: CraftWorld): { ok: boolean; text: string } {
  const why = blocker(r, w);
  if (why) return { ok: false, text: `Нельзя: ${why}` };
  const inv = w.inventory;
  if (r.place) {
    const err = w.place(r.place);
    if (err) return { ok: false, text: err };
  }
  for (const [need, n] of r.needs) inv.remove(have(inv, need, n)!, n);
  if (r.kindle && inv.count('lighter') === 0) inv.remove('matches', 1);
  if (r.repair) inv.handWear = Math.max(0, inv.handWear - r.repair);
  if (r.gives) inv.add(r.gives[0], r.gives[1]);
  if (r.xp) w.onXp(r.xp);
  return { ok: true, text: r.gives ? `${ITEMS[r.gives[0]].name} ×${r.gives[1]}` : r.repair ? 'Рукоять обмотана' : `${r.name}: готово` };
}

export function needName(need: ItemId | ItemId[]): string {
  return Array.isArray(need) ? 'рубашка или футболка' : ITEMS[need].name.toLowerCase();
}

/** Ingredient line with what is in the bag: "доска 1/2 · хлам 3/2". */
export function needsLine(r: Recipe, inv: Inventory): { text: string; ok: boolean }[] {
  const out = r.needs.map(([need, n]) => {
    const got = Array.isArray(need) ? Math.max(...need.map((id) => inv.count(id))) : inv.count(need);
    return { text: `${needName(need)} ${Math.min(got, n)}/${n}`, ok: got >= n };
  });
  if (r.tool) out.push({ text: r.tool.map((t) => ITEMS[t].name.toLowerCase()).join(' / '), ok: r.tool.some((t) => inv.count(t) > 0 || inv.hand === t) });
  if (r.kindle) out.push({ text: 'спички / зажигалка', ok: inv.count('lighter') + inv.count('matches') > 0 });
  return out;
}
