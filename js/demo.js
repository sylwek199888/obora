/**
 * demo.js — DANE DEMONSTRACYJNE: 5 przykładowych zwierząt z historią
 * (ważenia, leczenie z karencją, rozród, pasze, finanse).
 * Wszystkie rekordy mają znacznik demo: true, dzięki czemu
 * przycisk „Usuń dane demo” usuwa tylko je.
 */
import * as db from './db.js';
import { addDays, todayISO, uuid } from './utils.js';
import { STORE_NAMES, DEFAULT_FEEDS } from './model.js';
import { confirmDlg, toast } from './ui.js';

export async function loadDemo() {
  const T = todayISO();
  const ago = n => addDays(T, -n);
  const ids = { malina: uuid(), krasula: uuid(), bianka: uuid(), bruno: uuid(), latka: uuid() };
  const D = { demo: true };
  const cows = [
    { id: ids.malina, earTag: 'PL005123456781', internalNo: '12', name: 'Malina', breed: 'HF (holsztyńsko-fryzyjska)', sex: 'krowa',
      color: 'czarno-biała, biała gwiazdka na czole', birthDate: ago(5 * 365 + 40), origin: 'urodzona', motherText: 'PL005123400012', fatherText: 'HOL 123 Bolt',
      group: 'Dojne', status: 'aktywna', targetWeight: null },
    { id: ids.krasula, earTag: 'PL005123456798', internalNo: '7', name: 'Krasula', breed: 'Simentaler', sex: 'krowa',
      color: 'płowo-biała', birthDate: ago(7 * 365 + 100), origin: 'zakup', purchaseDate: ago(5 * 365), purchaseFrom: 'Gospodarstwo Nowak, Brzozów',
      purchasePrice: 4800, purchaseWeight: 520, fatherText: 'SIM 2210 Rambo', group: 'Dojne', status: 'aktywna' },
    { id: ids.bianka, earTag: 'PL005123456804', internalNo: '31', name: 'Bianka', breed: 'Simentaler', sex: 'jałówka',
      color: 'płowa', birthDate: ago(545), origin: 'urodzona', motherId: ids.krasula, fatherText: 'SIM 4471 Wal', group: 'Jałówki', status: 'aktywna' },
    { id: ids.bruno, earTag: 'PL005123456811', internalNo: '45', name: 'Bruno', breed: 'Limousine', sex: 'byk',
      color: 'rudy', birthDate: ago(425), origin: 'zakup', purchaseDate: ago(305), purchaseFrom: 'Jan Kowalski, Wola Mała',
      purchasePrice: 2100, purchaseWeight: 180, group: 'Opas', status: 'aktywna', targetWeight: 650 },
    { id: ids.latka, earTag: 'PL005123456828', internalNo: '52', name: 'Łatka', breed: 'Simentaler', sex: 'cielę', gender: 'samica',
      color: 'płowo-biała, łatka na boku', birthDate: ago(5), origin: 'urodzona', motherId: ids.krasula, fatherText: 'SIM 4471 Wal', group: 'Cielęta', status: 'aktywna' },
  ].map(c => ({ ...c, ...D }));

  const weights = [];
  const w = (cowId, daysAgo, kg, method = 'waga', note = '') => weights.push({ cowId, date: ago(daysAgo), kg, method, note, ...D });
  // Bruno — opas, ok. 1,1 kg/dzień, ostatnio ważony 35 dni temu
  [[305, 180], [245, 248], [185, 312], [125, 381], [65, 446], [35, 478]].forEach(([d, kg]) => w(ids.bruno, d, kg));
  // Malina — ostatnie ważenie niższe (alert spadku wagi)
  w(ids.malina, 90, 655, 'taśma'); w(ids.malina, 40, 662, 'taśma'); w(ids.malina, 6, 641, 'taśma', 'po zmianie paszy');
  w(ids.krasula, 60, 705); w(ids.krasula, 20, 712);
  [[300, 120], [200, 215], [100, 318], [12, 395]].forEach(([d, kg]) => w(ids.bianka, d, kg));
  w(ids.latka, 5, 41, 'taśma', 'przy urodzeniu');

  const conditions = [
    { cowId: ids.malina, date: ago(30), bcs: '3', hooves: 'dobry' },
    { cowId: ids.malina, date: ago(6), bcs: '2.5', hooves: 'kulawizna', note: 'lewa tylna' },
    { cowId: ids.krasula, date: ago(10), bcs: '3.25', hooves: 'dobry' },
  ].map(x => ({ ...x, ...D }));
  const notes = [
    { cowId: ids.malina, date: ago(6), text: 'Kuleje na lewą tylną. Do korekcji racic przy najbliższej wizycie.' },
    { cowId: ids.krasula, date: ago(5), text: 'Wycielenie bez komplikacji, jałówka (Łatka).' },
  ].map(x => ({ ...x, ...D }));
  const treatments = [
    { cowId: ids.krasula, type: 'leczenie', date: ago(2), days: 3, diagnosis: 'Zapalenie wymienia (mastitis), ćwiartka PP', drug: 'Synulox LC',
      dose: '1 tubostrzykawka / ćwiartkę', route: 'dowymieniowo', vet: 'lek. wet. Anna Wiśniewska', cost: 180, batch: 'SX2291',
      withdrawalMilk: 4, withdrawalMeat: 7 },
    { cowId: ids.bruno, type: 'odrobaczanie', date: ago(85), days: 1, diagnosis: 'Profilaktyka', drug: 'Ivomec Pour-On', dose: '50 ml',
      route: 'zewnętrznie (pour-on)', vet: 'lek. wet. Anna Wiśniewska', cost: 45, batch: 'IV7781', withdrawalMilk: 0, withdrawalMeat: 28, nextDate: addDays(T, 5) },
    { cowId: ids.bianka, type: 'szczepienie', date: ago(170), days: 1, diagnosis: 'BVD', drug: 'Bovilis BVD', dose: '2 ml', route: 'domięśniowo',
      vet: 'lek. wet. Anna Wiśniewska', cost: 35, batch: 'BV1102', withdrawalMilk: 0, withdrawalMeat: 0, nextDate: addDays(T, 10) },
    { cowId: ids.malina, type: 'leczenie', date: ago(150), days: 1, diagnosis: 'Kulawizna — zapalenie skóry palca', drug: 'Engemycyna 10%',
      dose: '20 ml', route: 'domięśniowo', vet: 'lek. wet. Piotr Zając', cost: 120, batch: 'EN5512', withdrawalMilk: 7, withdrawalMeat: 28 },
  ].map(x => ({ ...x, ...D }));
  const insMalina = ago(215);
  const repro = [
    { cowId: ids.malina, type: 'wycielenie', date: ago(320), course: 'łatwy', calfSex: 'byczek', note: 'cielę sprzedane' },
    { cowId: ids.malina, type: 'ruja', date: ago(236) },
    { cowId: ids.malina, type: 'inseminacja', date: insMalina, bull: 'HOL 876 Titan', inseminator: 'Marek Lis', cost: 80 },
    { cowId: ids.malina, type: 'badanie', date: addDays(insMalina, 38), result: 'cielna', note: 'USG' },
    { cowId: ids.krasula, type: 'wycielenie', date: ago(5 + 395), course: 'łatwy', calfSex: 'jałówka' },
    { cowId: ids.krasula, type: 'inseminacja', date: ago(5 + 283), bull: 'SIM 4471 Wal', inseminator: 'Marek Lis', cost: 80 },
    { cowId: ids.krasula, type: 'badanie', date: ago(5 + 245), result: 'cielna' },
    { cowId: ids.krasula, type: 'zasuszenie', date: ago(65) },
    { cowId: ids.krasula, type: 'wycielenie', date: ago(5), course: 'łatwy', calfSex: 'jałówka', calfId: ids.latka },
    { cowId: ids.bianka, type: 'ruja', date: ago(20) },
    { cowId: ids.bianka, type: 'inseminacja', date: ago(20), bull: 'LIM 3301 Hugo', inseminator: 'Marek Lis', cost: 80 },
  ].map(x => ({ ...x, ...D }));
  const milk = [];
  for (let i = 1; i <= 6; i++) {
    milk.push({ cowId: ids.malina, date: ago(i * 30), period: 'miesiąc', liters: 820 - i * 25, ...D });
  }
  for (let i = 0; i < 4; i++) milk.push({ cowId: ids.krasula, date: ago(i), period: 'dzień', liters: 24 + i, ...D });

  const feeds = DEFAULT_FEEDS.map(f => ({ id: uuid(), ...f, minDays: 14, ...D }));
  const F = Object.fromEntries(feeds.map(f => [f.name, f.id]));
  const r = (group, feed, kg) => ({ target: 'group:' + group, feedId: F[feed], kgPerDay: kg, ...D });
  const rations = [
    r('Dojne', 'Sianokiszonka', 25), r('Dojne', 'Kiszonka z kukurydzy', 20), r('Dojne', 'Mieszanka treściwa', 6),
    r('Zasuszone', 'Siano', 8), r('Zasuszone', 'Sianokiszonka', 15),
    r('Jałówki', 'Sianokiszonka', 18), r('Jałówki', 'Siano', 3),
    r('Opas', 'Kiszonka z kukurydzy', 16), r('Opas', 'Śruta zbożowa', 3), r('Opas', 'Siano', 2),
    r('Cielęta', 'Mleko dla cieląt', 6), r('Cielęta', 'Siano', 0.3),
  ];
  const s = (feed, daysAgo, type, kg, cost = null) => ({ feedId: F[feed], date: ago(daysAgo), type, kg, cost, ...D });
  const feedStock = [
    s('Sianokiszonka', 20, 'inwentaryzacja', 9000), s('Kiszonka z kukurydzy', 20, 'inwentaryzacja', 12000),
    s('Mieszanka treściwa', 20, 'inwentaryzacja', 300), s('Mieszanka treściwa', 15, 'przyjęcie', 200, 320),
    s('Śruta zbożowa', 30, 'przyjęcie', 500, 550), s('Siano', 20, 'inwentaryzacja', 2500), s('Mleko dla cieląt', 4, 'przyjęcie', 60, 132),
  ];
  const finance = [];
  for (let i = 0; i < 6; i++) {
    finance.push({ date: ago(i * 30 + 3), kind: 'przychód', category: 'mleko', amount: 2900 + i * 70, note: 'Mleczarnia — rozliczenie', ...D });
    finance.push({ date: ago(i * 30 + 8), kind: 'koszt', category: 'pasza', amount: 950 + i * 20, note: 'Zakup mieszanki', ...D });
  }
  finance.push({ date: ago(120), kind: 'przychód', category: 'dopłaty', amount: 3200, note: 'Dopłaty dobrostanowe', ...D });
  finance.push({ date: ago(40), kind: 'koszt', category: 'inne koszty', amount: 400, note: 'Prąd obora', ...D });
  const events = [
    { date: addDays(T, 3), type: 'wizyta weterynarza', title: 'Wizyta weterynarza — kontrola Krasuli, korekcja racic Maliny', ...D },
  ];
  // ARiMR: starsze zdarzenia oznaczamy jako zgłoszone; urodzenie Łatki — niezgłoszone (do pokazania alertu)
  const arimr = [
    { id: `${ids.malina}_urodzenie`, reported: true, reportedDate: ago(5 * 365 + 36) },
    { id: `${ids.krasula}_zakup`, reported: true, reportedDate: ago(5 * 365 - 3) },
    { id: `${ids.bianka}_urodzenie`, reported: true, reportedDate: ago(541) },
    { id: `${ids.bruno}_zakup`, reported: true, reportedDate: ago(302) },
  ].map(x => ({ ...x, ...D }));

  const all = { cows, weights, conditions, notes, treatments, repro, milk, feeds, rations, feedStock, finance, events, arimr };
  for (const [store, recs] of Object.entries(all)) if (STORE_NAMES.includes(store)) await db.saveMany(store, recs);
}

/** Usuwa wszystkie rekordy demo (po potwierdzeniu). */
export async function removeDemo({ ask = true } = {}) {
  if (ask && !await confirmDlg('Usunąć wszystkie dane demonstracyjne (5 przykładowych zwierząt i ich historię)? Twoje własne wpisy zostaną.', { danger: true, okText: 'Usuń dane demo' })) return false;
  for (const s of STORE_NAMES) {
    const recs = (await db.getAll(s, { withDeleted: true })).filter(r => r.demo && r.deletedAt !== '1970-01-01T00:00:00.000Z');
    // „nagrobek” z datą 1970 — znika przy porządkowaniu kosza, a synchronizacja usunie też na innych urządzeniach
    if (recs.length) await db.saveMany(s, recs.map(r => ({ ...r, deletedAt: '1970-01-01T00:00:00.000Z' })));
  }
  await db.purgeOldTrash();
  await db.setMeta('demoRemoved', true);
  if (ask) toast('Usunięto dane demo.', 'ok');
  return true;
}

/** Przy pierwszym uruchomieniu (pusta baza) wczytuje dane demo. */
export async function seedIfEmpty() {
  if (await db.getMeta('seeded')) return;
  await db.setMeta('seeded', true);
  const cows = await db.getAll('cows', { withDeleted: true });
  if (!cows.length) await loadDemo();
}
