import { CLASSES, type ClassId, classDef, OUTFIT_TINTS, STARTER_OUTFITS } from '../data/classes';
import { classSkillText } from '../systems/Skills';
import { TRAITS, type TraitId, traitDef, traitPointsLeft } from '../data/traits';
import type { ItemId, WearSlot } from '../data/items';
import { type Appearance, HEIGHT_RANGE, baseLook, randomAppearance, REF_CLOTHES, SEX_LABEL, SEXES, type Sex } from '../player/appearance';
import type { Worn } from '../systems/Inventory';
import { CharacterPreview } from './CharacterPreview';

export interface CharacterChoice {
  appearance: Appearance;
  classId: ClassId;
  /** 'uniform' = the class uniform, otherwise a STARTER_OUTFITS id. */
  outfit: string;
  /** Color of the starting top (starter outfits only). */
  tint: number;
  traits: TraitId[];
}

type Tab = 'look' | 'class' | 'traits' | 'outfit';

/** Worn set for a choice (uniform or starter outfit). */
export function choiceWorn(c: CharacterChoice): Worn {
  const src = c.outfit === 'uniform' ? classDef(c.classId).uniform : (STARTER_OUTFITS.find((o) => o.id === c.outfit)?.worn ?? {});
  // Everyone starts with some bag on the back: the class's own, or a school backpack.
  return { outfit: src.outfit ?? null, head: src.head ?? null, face: src.face ?? null, mask: src.mask ?? null, torso: src.torso ?? null, vest: src.vest ?? null, hands: src.hands ?? null, legs: src.legs ?? null, feet: src.feet ?? null, back: src.back ?? (src.bag ? null : 'backpackSchool'), bag: src.bag ?? null };
}

export function choiceTint(c: CharacterChoice): Partial<Record<WearSlot, number>> {
  if (c.outfit === 'uniform') return {};
  // Everyday clothes: the reference sheet's jeans and sneakers for the base.
  const ref = REF_CLOTHES[c.appearance.sex];
  return c.outfit === 'casual' ? { torso: c.tint, legs: ref.jeans, feet: ref.shoes } : { torso: c.tint };
}

/**
 * New game: who the survivor is. Looks (name, man or woman, height), the class
 * (former job) and the starting clothes, with the 3D figure updating live. Phone-first: big touch
 * targets, one scrolling column of options next to the figure.
 */
export class CharacterEditor {
  private readonly root = document.createElement('div');
  private readonly preview = new CharacterPreview('editor__figure');
  private readonly body = document.createElement('div');
  private readonly tabs = document.createElement('div');
  private tab: Tab = 'look';
  private choice: CharacterChoice;
  private startBtn: HTMLButtonElement | null = null;

  /** `legacy`: what the dead survivors of this world leave the new one ("Топоры 2 · Обыск 1"). */
  constructor(
    private readonly parent: HTMLElement,
    private readonly legacy = '',
  ) {
    // The male base as on the reference sheet, in its everyday clothes.
    const look = baseLook('male');
    this.choice = { appearance: look, classId: 'unemployed', outfit: 'casual', tint: REF_CLOTHES.male.tee, traits: [] };
    this.root.className = 'editor';
  }

  /** Shows the editor; resolves when the player presses "Начать". */
  open(): Promise<CharacterChoice> {
    return new Promise((resolve) => {
      const left = div('editor__left');
      const figure = div('editor__figure-wrap');
      figure.append(this.preview.canvas, div('editor__drag', '↔ повернуть'));
      const name = document.createElement('input');
      name.className = 'editor__name';
      name.maxLength = 20;
      name.placeholder = 'Имя';
      name.value = this.choice.appearance.name;
      name.addEventListener('input', () => (this.choice.appearance.name = name.value));
      left.append(div('editor__title', 'Новый выживший'), figure, name);
      if (this.legacy) left.append(div('editor__legacy', `Наследие погибших: ${this.legacy}`));

      const right = div('editor__right');
      this.tabs.className = 'editor__tabs';
      for (const [id, label] of [
        ['look', 'Внешность'],
        ['class', 'Класс'],
        ['traits', 'Черты'],
        ['outfit', 'Одежда'],
      ] as [Tab, string][]) {
        const b = button(label, 'editor__tab');
        b.dataset.tab = id;
        b.addEventListener('click', () => {
          this.tab = id;
          this.renderBody();
        });
        this.tabs.append(b);
      }
      this.body.className = 'editor__body';
      const footer = div('editor__footer');
      const random = button('Случайный персонаж', 'editor__btn editor__btn--quiet');
      random.addEventListener('click', () => {
        this.choice.appearance = randomAppearance();
        this.choice.classId = CLASSES[Math.floor(Math.random() * CLASSES.length)].id;
        this.choice.outfit = Math.random() < 0.5 ? 'uniform' : STARTER_OUTFITS[Math.floor(Math.random() * STARTER_OUTFITS.length)].id;
        this.choice.tint = OUTFIT_TINTS[Math.floor(Math.random() * OUTFIT_TINTS.length)];
        this.choice.traits = randomTraits(this.choice.classId);
        name.value = this.choice.appearance.name;
        this.renderBody();
      });
      const start = button('Начать', 'editor__btn');
      this.startBtn = start;
      start.addEventListener('click', () => {
        if (traitPointsLeft(this.choice.classId, this.choice.traits) < 0) {
          this.tab = 'traits';
          this.renderBody();
          return;
        }
        this.choice.appearance.name = name.value.trim() || 'Выживший';
        this.preview.dispose();
        this.root.remove();
        resolve(this.choice);
      });
      footer.append(random, start);
      right.append(this.tabs, this.body, footer);
      this.root.append(left, right);
      this.parent.append(this.root);
      this.renderBody();
      this.preview.start();
    });
  }

  private refreshFigure(): void {
    const c = this.choice;
    this.preview.setAppearance(c.appearance, c.classId);
    this.preview.setOutfit(choiceWorn(c), classDef(c.classId).hand as ItemId | null, undefined, choiceTint(c));
  }

  private renderBody(): void {
    for (const b of this.tabs.children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.tab === this.tab);
    // Re-rendering the same tab (a choice was made) keeps the scroll position.
    const keep = this.body.dataset.tab === this.tab ? this.body.scrollTop : 0;
    this.body.dataset.tab = this.tab;
    this.body.replaceChildren();
    if (this.tab === 'look') this.renderLook();
    else if (this.tab === 'class') this.renderClass();
    else if (this.tab === 'traits') this.renderTraits();
    else this.renderOutfit();
    this.body.scrollTop = keep;
    this.refreshFigure();
    const left = traitPointsLeft(this.choice.classId, this.choice.traits);
    if (this.startBtn) {
      this.startBtn.classList.toggle('editor__btn--off', left < 0);
      this.startBtn.textContent = left < 0 ? `Не хватает очков черт: ${-left}` : 'Начать';
    }
  }

  /** Good traits cost points, bad ones give them; the class brings its own; opposites exclude each other. */
  private renderTraits(): void {
    const c = this.choice;
    const left = traitPointsLeft(c.classId, c.traits);
    const own = classDef(c.classId).mods.traitPoints ?? 0;
    this.body.append(div(`editor__points${left < 0 ? ' editor__points--short' : ''}`, `Очки черт: ${left}${own ? ` (класс даёт ${own})` : ''}`));
    this.body.append(div('editor__note', 'Хорошие черты стоят очков, плохие — дают их.'));
    for (const good of [true, false]) {
      const list = div('editor__traits');
      for (const t of TRAITS.filter((x) => x.cost > 0 === good)) {
        const on = c.traits.includes(t.id);
        const blocked = !on && c.traits.some((o) => o === t.not || traitDef(o)?.not === t.id);
        const b = button('', `editor__trait${good ? ' editor__trait--good' : ' editor__trait--bad'}${on ? ' on' : ''}${blocked ? ' off' : ''}`);
        b.append(div('editor__trait-name', `${t.name}  ${t.cost > 0 ? '−' : '+'}${Math.abs(t.cost)}`), div('editor__trait-about', t.about));
        b.disabled = blocked;
        b.addEventListener('click', () => {
          c.traits = on ? c.traits.filter((x) => x !== t.id) : [...c.traits, t.id];
          this.renderBody();
        });
        list.append(b);
      }
      this.body.append(div('editor__label', good ? 'Хорошие' : 'Плохие'), list);
    }
  }

  private renderLook(): void {
    const a = this.choice.appearance;
    // A man or a woman (the model); the name and the height after.
    this.chips('Персонаж', SEXES.map((s) => [s, SEX_LABEL[s]]), a.sex, (v) => {
      const sex = v as Sex;
      if (sex === a.sex) return;
      if (this.choice.tint === REF_CLOTHES[a.sex].tee) this.choice.tint = REF_CLOTHES[sex].tee;
      this.choice.appearance = baseLook(sex, a.name.trim() || undefined);
    });
    // Height slider.
    const row = div('editor__row');
    const label = div('editor__label', `Рост: ${a.height} см`);
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'editor__range';
    range.min = String(HEIGHT_RANGE[0]);
    range.max = String(HEIGHT_RANGE[1]);
    range.value = String(a.height);
    range.addEventListener('input', () => {
      a.height = Number(range.value);
      label.textContent = `Рост: ${a.height} см`;
      this.refreshFigure();
    });
    row.append(label, range);
    this.body.append(row);
  }

  private renderClass(): void {
    for (const c of CLASSES) {
      const card = div(`editor__class${c.id === this.choice.classId ? ' on' : ''}`);
      card.append(div('editor__class-name', c.name), div('editor__class-about', c.about));
      const lists = div('editor__class-lists');
      const pros = document.createElement('ul');
      pros.className = 'editor__pros';
      for (const p of c.pros) pros.append(li(p));
      const cons = document.createElement('ul');
      cons.className = 'editor__cons';
      for (const p of c.cons) cons.append(li(p));
      lists.append(pros, cons);
      card.append(lists);
      const skills = classSkillText(c.id);
      if (skills) card.append(div('editor__class-skills', `Навыки: ${skills}`));
      card.addEventListener('click', () => {
        this.choice.classId = c.id;
        this.renderBody();
      });
      this.body.append(card);
    }
  }

  private renderOutfit(): void {
    const cls = classDef(this.choice.classId);
    const options: [string, string][] = [['uniform', `Форма: ${cls.name.toLowerCase()}`], ...STARTER_OUTFITS.map((o) => [o.id, o.name] as [string, string])];
    this.chips('Стартовая одежда', options, this.choice.outfit, (v) => (this.choice.outfit = v));
    if (this.choice.outfit !== 'uniform') this.swatches('Цвет верха', OUTFIT_TINTS, this.choice.tint, (v) => (this.choice.tint = v));
    else this.body.append(div('editor__note', 'Форма класса — свой цвет и защита. Её можно снять и найти другую одежду в мире.'));
  }

  private chips(title: string, options: [string, string][], current: string, set: (v: string) => void): void {
    const row = div('editor__row');
    row.append(div('editor__label', title));
    const list = div('editor__chips');
    for (const [value, label] of options) {
      const b = button(label, `editor__chip${value === current ? ' on' : ''}`);
      b.addEventListener('click', () => {
        set(value);
        this.renderBody();
      });
      list.append(b);
    }
    row.append(list);
    this.body.append(row);
  }

  private swatches(title: string, colors: readonly number[], current: number, set: (v: number) => void): void {
    const row = div('editor__row');
    row.append(div('editor__label', title));
    const list = div('editor__chips');
    for (const c of colors) {
      const b = button('', `editor__swatch${c === current ? ' on' : ''}`);
      b.style.background = `#${c.toString(16).padStart(6, '0')}`;
      b.addEventListener('click', () => {
        set(c);
        this.renderBody();
      });
      list.append(b);
    }
    row.append(list);
    this.body.append(row);
  }
}

function randomTraits(classId: ClassId): TraitId[] {
  const out: TraitId[] = [];
  const free = (id: TraitId) => !out.includes(id) && !out.some((o) => o === traitDef(id)?.not || traitDef(o)?.not === id);
  const pick = (good: boolean) => {
    const pool = TRAITS.filter((t) => t.cost > 0 === good && free(t.id) && (!good || traitPointsLeft(classId, [...out, t.id]) >= 0));
    if (pool.length) out.push(pool[Math.floor(Math.random() * pool.length)].id);
  };
  for (let n = Math.floor(Math.random() * 3); n > 0; n--) pick(false);
  for (let n = 3; n > 0; n--) if (Math.random() < 0.7) pick(true);
  return out;
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function button(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  return b;
}

function li(text: string): HTMLLIElement {
  const l = document.createElement('li');
  l.textContent = text;
  return l;
}
