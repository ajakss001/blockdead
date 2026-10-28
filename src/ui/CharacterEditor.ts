import { CLASSES, type ClassId, classDef, OUTFIT_TINTS, STARTER_OUTFITS } from '../data/classes';
import type { ItemId, WearSlot } from '../data/items';
import {
  type Appearance,
  BEARD_LABEL,
  BEARDS,
  BUILD_LABEL,
  BUILDS,
  FACES,
  HAIR_COLORS,
  HAIR_LABEL,
  HAIR_STYLES,
  HEIGHT_RANGE,
  randomAppearance,
  SKIN_TONES,
} from '../player/appearance';
import type { Worn } from '../systems/Inventory';
import { CharacterPreview } from './CharacterPreview';

export interface CharacterChoice {
  appearance: Appearance;
  classId: ClassId;
  /** 'uniform' = the class uniform, otherwise a STARTER_OUTFITS id. */
  outfit: string;
  /** Color of the starting top (starter outfits only). */
  tint: number;
}

type Tab = 'look' | 'class' | 'outfit';

/** Worn set for a choice (uniform or starter outfit). */
export function choiceWorn(c: CharacterChoice): Worn {
  const src = c.outfit === 'uniform' ? classDef(c.classId).uniform : (STARTER_OUTFITS.find((o) => o.id === c.outfit)?.worn ?? {});
  return { head: src.head ?? null, torso: src.torso ?? null, legs: src.legs ?? null, feet: src.feet ?? null };
}

export function choiceTint(c: CharacterChoice): Partial<Record<WearSlot, number>> {
  return c.outfit === 'uniform' ? {} : { torso: c.tint };
}

/**
 * New game: who the survivor is. Looks (name, build, height, skin, face, hair, beard), the class
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

  constructor(private readonly parent: HTMLElement) {
    const look = randomAppearance();
    this.choice = { appearance: look, classId: 'unemployed', outfit: 'casual', tint: OUTFIT_TINTS[0] };
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

      const right = div('editor__right');
      this.tabs.className = 'editor__tabs';
      for (const [id, label] of [
        ['look', 'Внешность'],
        ['class', 'Класс'],
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
        name.value = this.choice.appearance.name;
        this.renderBody();
      });
      const start = button('Начать', 'editor__btn');
      start.addEventListener('click', () => {
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
    this.preview.setAppearance(c.appearance);
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
    else this.renderOutfit();
    this.body.scrollTop = keep;
    this.refreshFigure();
  }

  private renderLook(): void {
    const a = this.choice.appearance;
    this.chips('Телосложение', BUILDS.map((b) => [b, BUILD_LABEL[b]]), a.build, (v) => (a.build = v as Appearance['build']));
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
    this.swatches('Кожа', SKIN_TONES, a.skin, (v) => (a.skin = v));
    this.chips('Лицо', Array.from({ length: FACES }, (_, i) => [String(i), String(i + 1)]), String(a.face), (v) => (a.face = Number(v)));
    this.chips('Причёска', HAIR_STYLES.map((h) => [h, HAIR_LABEL[h]]), a.hair, (v) => (a.hair = v as Appearance['hair']));
    this.swatches('Цвет волос', HAIR_COLORS, a.hairColor, (v) => (a.hairColor = v));
    this.chips('Борода', BEARDS.map((b) => [b, BEARD_LABEL[b]]), a.beard, (v) => (a.beard = v as Appearance['beard']));
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
