import { langToggle, onLangChange, tr } from '../core/i18n';
import { CLASSES, type ClassId, classDef, STARTER_OUTFITS } from '../data/classes';
import { classSkillText } from '../systems/Skills';
import { TRAITS, type TraitId, traitDef, traitPointsLeft } from '../data/traits';
import type { ItemId, WearSlot } from '../data/items';
import { type Appearance, BASE_LOOK, baseLook, randomAppearance, REF_CLOTHES, SEX_LABEL, SEXES, type Sex, translateDefaultName } from '../player/appearance';
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
 * New game: who the survivor is. Looks (name, man or woman), the class
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
  private nameInput: HTMLInputElement | null = null;

  /** `legacy`: what the dead survivors of this world leave the new one ("Топоры 2 · Обыск 1"). */
  constructor(
    private readonly parent: HTMLElement,
    private readonly legacy: string | (() => string) = '',
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
      const head = div('editor__head');
      const title = div('editor__title', tr('Новый выживший', 'New survivor'));
      head.append(title, langToggle('editor__lang'));

      const figure = div('editor__figure-wrap');
      const drag = div('editor__drag', tr('↔ повернуть', '↔ rotate'));
      figure.append(this.preview.canvas, drag);
      const name = document.createElement('input');
      name.className = 'editor__name';
      name.maxLength = 20;
      name.placeholder = tr('Имя', 'Name');
      name.value = this.choice.appearance.name;
      name.addEventListener('input', () => (this.choice.appearance.name = name.value));
      this.nameInput = name;
      left.append(head, figure, name);
      const legacyEl = div('editor__legacy');
      const syncLegacy = () => {
        const text = typeof this.legacy === 'function' ? this.legacy() : this.legacy;
        legacyEl.hidden = !text;
        legacyEl.textContent = text ? `${tr('Наследие погибших', 'Legacy of the fallen')}: ${text}` : '';
      };
      syncLegacy();
      left.append(legacyEl);

      const right = div('editor__right');
      this.tabs.className = 'editor__tabs';
      const tabDefs: [Tab, [string, string]][] = [
        ['look', ['Внешность', 'Appearance']],
        ['class', ['Класс', 'Class']],
        ['traits', ['Черты', 'Traits']],
        ['outfit', ['Одежда', 'Clothing']],
      ];
      const tabBtns: [HTMLButtonElement, [string, string]][] = [];
      for (const [id, labels] of tabDefs) {
        const b = button(tr(labels[0], labels[1]), 'editor__tab');
        b.dataset.tab = id;
        b.addEventListener('click', () => {
          this.tab = id;
          this.renderBody();
        });
        this.tabs.append(b);
        tabBtns.push([b, labels]);
      }
      this.body.className = 'editor__body';
      const footer = div('editor__footer');
      const random = button(tr('Случайный персонаж', 'Random character'), 'editor__btn editor__btn--quiet');
      random.addEventListener('click', () => {
        this.choice.appearance = randomAppearance();
        this.choice.classId = CLASSES[Math.floor(Math.random() * CLASSES.length)].id;
        this.choice.outfit = Math.random() < 0.5 ? 'uniform' : 'casual';
        this.choice.traits = randomTraits(this.choice.classId);
        name.value = this.choice.appearance.name;
        this.renderBody();
      });
      const start = button(tr('Начать', 'Start'), 'editor__btn');
      this.startBtn = start;
      const offLang = onLangChange(() => {
        title.textContent = tr('Новый выживший', 'New survivor');
        drag.textContent = tr('↔ повернуть', '↔ rotate');
        name.placeholder = tr('Имя', 'Name');
        const translatedName = translateDefaultName(this.choice.appearance.name, this.choice.appearance.sex);
        if (translatedName !== this.choice.appearance.name) {
          this.choice.appearance.name = translatedName;
          name.value = translatedName;
        }
        syncLegacy();
        for (const [b, labels] of tabBtns) b.textContent = tr(labels[0], labels[1]);
        random.textContent = tr('Случайный персонаж', 'Random character');
        this.renderBody();
      });
      start.addEventListener('click', () => {
        if (traitPointsLeft(this.choice.classId, this.choice.traits) < 0) {
          this.tab = 'traits';
          this.renderBody();
          return;
        }
        offLang();
        this.choice.appearance.name = name.value.trim() || BASE_LOOK[this.choice.appearance.sex].name;
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
      this.startBtn.textContent = left < 0 ? `${tr('Не хватает очков черт', 'Not enough trait points')}: ${-left}` : tr('Начать', 'Start');
    }
  }

  /** Good traits cost points, bad ones give them; the class brings its own; opposites exclude each other. */
  private renderTraits(): void {
    const c = this.choice;
    const left = traitPointsLeft(c.classId, c.traits);
    const own = classDef(c.classId).mods.traitPoints ?? 0;
    this.body.append(
      div(
        `editor__points${left < 0 ? ' editor__points--short' : ''}`,
        `${tr('Очки черт', 'Trait points')}: ${left}${own ? ` (${tr(`класс даёт ${own}`, `class gives ${own}`)})` : ''}`,
      ),
    );
    this.body.append(div('editor__note', tr('Хорошие черты стоят очков, плохие — дают их.', 'Positive traits cost points; negative traits grant them.')));
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
      this.body.append(div('editor__label', good ? tr('Хорошие', 'Positive') : tr('Плохие', 'Negative')), list);
    }
  }

  private renderLook(): void {
    const a = this.choice.appearance;
    // A man or a woman (the model); the name after. The height is the model's own (no setting).
    this.chips(tr('Персонаж', 'Character'), SEXES.map((s) => [s, SEX_LABEL[s]]), a.sex, (v) => {
      const sex = v as Sex;
      if (sex === a.sex) return;
      if (this.choice.tint === REF_CLOTHES[a.sex].tee) this.choice.tint = REF_CLOTHES[sex].tee;
      const trimmed = a.name.trim();
      const isDefault = !trimmed || trimmed === 'Выживший' || trimmed === 'Выжившая' || trimmed === 'Survivor';
      this.choice.appearance = baseLook(sex, isDefault ? undefined : trimmed);
      if (this.nameInput && isDefault) this.nameInput.value = this.choice.appearance.name;
    });
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
      if (skills) card.append(div('editor__class-skills', `${tr('Навыки', 'Skills')}: ${skills}`));
      card.addEventListener('click', () => {
        this.choice.classId = c.id;
        this.renderBody();
      });
      this.body.append(card);
    }
  }

  private renderOutfit(): void {
    // Two choices: the class's clothes, or everyday ones (a T-shirt, jeans, sneakers).
    const options: [string, string][] = [
      ['uniform', tr('Одежда класса', 'Class uniform')],
      ['casual', tr('Обычная', 'Casual')],
    ];
    this.chips(tr('Стартовая одежда', 'Starting clothes'), options, this.choice.outfit, (v) => (this.choice.outfit = v));
    if (this.choice.outfit === 'uniform') {
      this.body.append(
        div(
          'editor__note',
          tr(
            'Форма класса — свой цвет и защита. Её можно снять и найти другую одежду в мире.',
            'Class uniform — comes with its own look and protection. You can take it off and find other clothes in the world.',
          ),
        ),
      );
    }
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
