# 🐄 Obora — zarządzanie stadem bydła

Aplikacja webowa do prowadzenia stada krów w gospodarstwie. Działa na telefonie i laptopie,
**w pełni bez internetu**, a po skonfigurowaniu Supabase synchronizuje dane między urządzeniami
i użytkownikami (np. właściciel + pracownik).

- czysty HTML + CSS + JavaScript (moduły ES), **bez frameworków, bibliotek i kroku budowania**,
- dane w przeglądarce (IndexedDB), PWA — można „zainstalować” na ekranie głównym telefonu,
- interfejs po polsku, daty DD.MM.RRRR, jednostki kg, tryb jasny/ciemny i wysoki kontrast,
- duże przyciski (obsługa w rękawiczkach), dolne menu na telefonie, boczne na laptopie.

## Spis treści
1. [Uruchomienie](#1-uruchomienie)
2. [Co potrafi aplikacja](#2-co-potrafi-aplikacja)
3. [Struktura plików](#3-struktura-plików)
4. [Struktura danych](#4-struktura-danych)
5. [Konfiguracja Supabase krok po kroku (dla laika)](#5-konfiguracja-supabase-krok-po-kroku-dla-laika)
6. [Jak dodać nowe pole do karty krowy](#6-jak-dodać-nowe-pole-do-karty-krowy)
7. [Ograniczenia i uwagi](#7-ograniczenia-i-uwagi)

---

## 1. Uruchomienie

Aplikacja to zwykłe pliki statyczne — wystarczy je udostępnić przez serwer WWW.
Nie da się jej otworzyć podwójnym kliknięciem w `index.html` (przeglądarki blokują moduły z `file://`).

**Na komputerze (do testów):**
```bash
cd obora
python3 -m http.server 8000
# otwórz http://localhost:8000
```

**W internecie (żeby działała na telefonie)** — potrzebny jest adres **https** (wymagany dla
instalacji PWA, aparatu i powiadomień). Najprościej i za darmo:

- **GitHub Pages:** w repozytorium na GitHubie → *Settings* → *Pages* → *Source: Deploy from a branch* →
  wybierz gałąź (np. `main`) i folder `/ (root)` → *Save*. Po minucie aplikacja będzie pod adresem
  `https://<twoja-nazwa>.github.io/obora/`.
- albo Netlify / Cloudflare Pages: przeciągnij folder z plikami na ich stronę.

**Instalacja na telefonie:** otwórz adres w Chrome (Android) → menu ⋮ → *Zainstaluj aplikację*.
Na iPhonie w Safari: *Udostępnij* → *Do ekranu początkowego*. W aplikacji jest też przycisk
*Ustawienia → Zainstaluj na telefonie*.

Przy pierwszym uruchomieniu wczytuje się **5 przykładowych krów** z danymi demo. Usuniesz je przyciskiem
*„Usuń dane demo”* na pulpicie lub w ustawieniach.

> Po każdej zmianie plików aplikacji zwiększ numer `VERSION` w `sw.js` — wtedy telefony pobiorą nową wersję.

---

## 2. Co potrafi aplikacja

| Dział | Funkcje |
|---|---|
| **Karta krowy** | kolczyk (unikalny, wymagany), nr wewnętrzny, imię, rasa, płeć, maść, zdjęcie z aparatu (kompresowane), data urodzenia i wiek, pochodzenie (urodzona / zakupiona: data, od kogo, cena, waga), matka i ojciec (ze stada lub ręcznie), drzewo rodowodu + sprawdzanie pokrewieństwa przed kryciem, grupa/kojec, status (aktywna, sprzedana, padła, ubój), BCS i racice z historią, dziennik ze zdjęciami, kod QR, wydruk/PDF |
| **Waga** | historia ważeń (waga / taśma), szybkie ważenie z karty, wykres, przyrost dzienny od ostatniego ważenia i od początku, ostrzeżenie o spadku wagi, prognoza osiągnięcia wagi sprzedażnej |
| **Pasza** | słownik pasz z ceną, dawki dla grup lub konkretnej krowy, zużycie i koszt dzienny/miesięczny, magazyn (przyjęcia, inwentaryzacja, na ile dni wystarczy), koszt paszy na 1 kg przyrostu |
| **Leczenie** | leczenia, szczepienia, odrobaczanie (lek, dawka, droga podania, lekarz, koszt, nr partii), karencja mleko/mięso z czerwonym znacznikiem **KARENCJA**, terminy kolejnych dawek, **księga leczenia** z wydrukiem do kontroli |
| **Rozród** | ruje, inseminacje (z ostrzeżeniem o pokrewieństwie), badania cielności, automatyczny termin wycielenia (283 dni) i zasuszenia (60 dni przed), wycielenia z tworzeniem karty cielęcia, wydajność mleka |
| **ARiMR** | rejestr urodzeń, zakupów, sprzedaży, padnięć i ubojów z terminem 7 dni, ostrzeżenia, znacznik zgłoszone/niezgłoszone, tabela do przepisania w IRZplus |
| **Finanse** | koszty i przychody (ręczne + automatycznie z leczenia, inseminacji, zakupu/sprzedaży zwierząt i zakupu paszy), wynik miesięczny z wykresem, zysk/strata na krowę |
| **Pulpit** | liczba zwierząt wg grup i statusów, „do zrobienia dziś / w tym tygodniu”, krowy z karencją, stan magazynu pasz, powiadomienia |
| **Kalendarz** | widok miesiąca z wydarzeniami, własne wpisy (np. wizyta weterynarza), eksport do kalendarza telefonu (.ics) |
| **Lista stada** | wyszukiwanie po kolczyku, ostatnich 4 cyfrach, numerze, imieniu; głosowe i skanerem; filtry i sortowanie; kafelki z alertami; zaznaczanie wielu krów i ważenie / odrobaczanie / szczepienie / zmiana grupy / etykiety QR jednym ruchem |
| **Statystyki** | przyrosty wg grup, wskaźnik cielności i indeks inseminacji, okres międzywycieleniowy, najczęstsze choroby, koszty w czasie |
| **Bezpieczeństwo danych** | walidacja formularzy, potwierdzenie przed usunięciem, archiwizacja zamiast kasowania, **kosz na 30 dni**, kopia zapasowa JSON (z przypomnieniem po 7 dniach), eksport tabel do CSV (Excel) |

---

## 3. Struktura plików

```
index.html              — szkielet strony
manifest.webmanifest    — opis aplikacji do instalacji (PWA)
sw.js                   — service worker: praca offline
css/style.css           — wygląd (telefon najpierw, tryby jasny/ciemny/kontrast, wydruk)
icons/                  — ikony aplikacji
supabase/schema.sql     — skrypt bazy Supabase (tabele + zabezpieczenia)
js/
  app.js                — start aplikacji, menu, trasy (adresy ekranów)
  model.js              — MODEL DANYCH: słowniki, pola karty krowy, walidacja, obliczenia
  db.js                 — BAZA lokalna IndexedDB (zapis, kosz, kopia, znaczniki „do wysłania”)
  sync.js               — SYNCHRONIZACJA z Supabase (logowanie, wysyłanie, pobieranie)
  config.js             — opcjonalnie: adres i klucz Supabase na stałe
  charts.js             — WYKRESY w SVG
  qr.js                 — generator kodów QR (własny, bez bibliotek)
  scanner.js            — skaner kodów aparatem, wyszukiwanie głosowe
  tasks.js              — zadania i terminy (pulpit, kalendarz, powiadomienia)
  backup.js             — kopia zapasowa JSON, eksport CSV
  notify.js, pwa.js     — powiadomienia, instalacja PWA
  ui.js                 — okna, komunikaty, GENERATOR FORMULARZY
  router.js, theme.js, utils.js, farm.js, demo.js
  views/                — WIDOKI (ekrany): dashboard, herd, cow, weights, health, repro,
                          feed, finance, arimr, calendar, stats, print, settings, sync-view…
```

Moduły „dopinają się” do siebie przez małe rejestry, np. `registerCowTab()` (zakładka na karcie krowy),
`registerTaskProvider()` (nowy rodzaj zadań), `registerCSV()` (nowa tabela do eksportu),
`registerBulkAction()` (akcja grupowa na liście stada). Dzięki temu nowy dział nie wymaga zmian w starych plikach.

---

## 4. Struktura danych

Dane są w **magazynach** (tabelach) w IndexedDB. Ta sama lista jest w `STORES` w `js/model.js`.
Każdy wpis ma pola wspólne, nadawane automatycznie:

| Pole | Znaczenie |
|---|---|
| `id` | unikalny identyfikator (UUID) |
| `createdAt`, `createdBy` | kiedy i **kto dodał** wpis (e-mail lub imię z ustawień) |
| `updatedAt`, `updatedBy` | kiedy i kto ostatnio zmienił |
| `deletedAt` | data usunięcia (wpis w koszu), `null` = aktywny |
| `demo` | `true` dla danych demonstracyjnych |
| `_dirty` | tylko lokalnie: `1` = czeka na wysłanie do Supabase |

Daty zapisujemy jako tekst `RRRR-MM-DD`, a pokazujemy jako `DD.MM.RRRR`. Wagi w kg, kwoty w zł.

| Magazyn | Zawartość (najważniejsze pola) |
|---|---|
| `cows` | karta zwierzęcia — pola z `COW_FIELDS`: `earTag`, `internalNo`, `name`, `breed`, `sex` (krowa/jałówka/byk/cielę), `gender` (dla cieląt), `color`, `photo` (JPEG jako data URL), `birthDate`, `origin` (urodzona/zakup), `purchaseDate/From/Price/Weight`, `motherId`/`motherText`, `fatherId`/`fatherText`, `group`, `targetWeight`, `status`, `exitDate`, `buyer`, `salePrice`, `saleWeight`, `exitCause`, `remarks` |
| `weights` | `cowId`, `date`, `kg`, `method` (waga/taśma), `note` |
| `conditions` | `cowId`, `date`, `bcs` (1–5), `hooves` (stan racic), `note` |
| `notes` | dziennik: `cowId`, `date`, `text`, `photo` |
| `treatments` | `cowId`, `type` (leczenie/szczepienie/odrobaczanie), `date`, `days` (dni podawania), `diagnosis`, `drug`, `batch`, `dose`, `route`, `withdrawalMilk`, `withdrawalMeat` (dni karencji), `vet`, `cost`, `nextDate`, `note` |
| `repro` | `cowId`, `type` (ruja/inseminacja/badanie/wycielenie/zasuszenie/poronienie), `date`, `bull`, `inseminator`, `cost`, `result`, `course`, `calfSex`, `calfAlive`, `calfId`, `note` |
| `milk` | `cowId`, `date`, `period` (dzień/miesiąc), `liters` |
| `feeds` | słownik pasz: `name`, `pricePerKg`, `minDays` (alarm zapasu) |
| `rations` | dawki: `target` (`group:Opas` albo `cow:<id>`), `feedId`, `kgPerDay` |
| `feedStock` | magazyn: `feedId`, `date`, `type` (przyjęcie/inwentaryzacja), `kg`, `cost` |
| `finance` | `date`, `kind` (koszt/przychód), `category`, `amount`, `cowId` (opcjonalnie), `note` |
| `arimr` | status zgłoszenia: `id` = `<cowId>_<rodzaj>`, `reported`, `reportedDate` (same zdarzenia są wyliczane z kart) |
| `events` | własne wydarzenia kalendarza: `date`, `type`, `title` |

**Wartości wyliczane (nie zapisywane):** wiek, przyrosty, prognoza wagi, koniec karencji
(`ostatni dzień podania + dni karencji`, karencja trwa do tej daty **włącznie**), termin wycielenia
(`inseminacja + 283 dni`), zasuszenia (`wycielenie − 60 dni`), badania cielności (`+35 dni`),
stan magazynu (`ostatnia inwentaryzacja + przyjęcia − dzienne zużycie × dni`), terminy ARiMR (`zdarzenie + 7 dni`).

**W Supabase** wszystko trafia do jednej tabeli `records`: `farm_id`, `id`, `store` (nazwa magazynu),
`data` (cały wpis jako JSON), `updated_at`, `updated_by`, `deleted`, `server_updated_at`.
Dzięki temu nowe pola nie wymagają zmian w bazie. Do tego tabele `farms` (gospodarstwa, kod zaproszenia)
i `farm_members` (kto należy do gospodarstwa, rola: właściciel/pracownik).

**Synchronizacja:** zmiana zapisana bez internetu dostaje znacznik „do wysłania”. Gdy internet wróci,
aplikacja wysyła zmiany, a potem pobiera nowości z serwera. Przy konflikcie (ten sam wpis zmieniony
na dwóch urządzeniach) wygrywa **późniejsza** zmiana. Usunięcie to też zmiana (wpis z `deletedAt`),
więc kosz działa na wszystkich urządzeniach.

---

## 5. Konfiguracja Supabase krok po kroku (dla laika)

Supabase to darmowa (w podstawowym planie) „baza danych w chmurze”. Bez niej aplikacja też działa,
ale dane są tylko na jednym urządzeniu.

### Krok 1. Załóż konto i projekt
1. Wejdź na **https://supabase.com** → *Start your project* → zaloguj się (np. kontem Google lub GitHub).
2. Kliknij **New project**.
3. Wpisz nazwę, np. `obora`. Wymyśl **hasło do bazy** (Database Password) i zapisz je w bezpiecznym miejscu
   (aplikacja go nie potrzebuje, ale przyda się w razie problemów).
4. Region wybierz **Central EU (Frankfurt)** — dane zostaną w Unii Europejskiej.
5. Kliknij **Create new project** i poczekaj 1–2 minuty, aż projekt się utworzy.

### Krok 2. Przygotuj bazę (jedno kliknięcie)
1. W menu po lewej wybierz **SQL Editor** (ikona `>_`).
2. Kliknij **New query** (lub *+*).
3. Otwórz plik [`supabase/schema.sql`](supabase/schema.sql) z tego repozytorium, zaznacz **całość** (Ctrl+A),
   skopiuj (Ctrl+C) i wklej do okna w Supabase (Ctrl+V).
4. Kliknij **Run** (lub Ctrl+Enter). Powinien pojawić się komunikat *Success. No rows returned*.
   Jeśli Supabase zapyta o potwierdzenie przy „destructive operation” — to tylko polecenia `drop policy if exists`, kliknij potwierdzenie.

Skrypt tworzy tabele i **zabezpieczenia (RLS)**: każdy użytkownik widzi wyłącznie dane gospodarstw,
do których należy.

### Krok 3. Ustaw logowanie e-mailem
1. Menu **Authentication** → **Sign In / Providers** (w starszym wyglądzie: *Providers*) → **Email**
   powinien być włączony (domyślnie jest).
2. **Zalecane dla prostoty:** wyłącz **Confirm email** (potwierdzanie e-maila). Darmowy plan Supabase wysyła
   tylko kilka e-maili na godzinę, więc bez tego łatwo utknąć na rejestracji. Jeśli zostawisz włączone,
   po założeniu konta trzeba kliknąć link w e-mailu.
3. Menu **Authentication** → **URL Configuration**:
   - **Site URL:** wpisz adres swojej aplikacji, np. `https://twoja-nazwa.github.io/obora/`
   - **Redirect URLs:** dodaj ten sam adres.
   Dzięki temu linki z e-maili (potwierdzenie konta, „nie pamiętam hasła”) otworzą aplikację.

### Krok 4. Skopiuj adres i klucz
1. Kliknij **Project Settings** (koło zębate na dole menu) → **Data API** / **API Keys**
   (w zależności od wersji panelu: *Settings → API*).
2. Skopiuj **Project URL** — wygląda jak `https://abcdefghijklm.supabase.co`.
3. Skopiuj klucz **anon public** (albo **Publishable key**, zaczyna się od `sb_publishable_`).
   ⚠️ **Nigdy** nie używaj klucza `service_role` / `secret` — on omija zabezpieczenia.

### Krok 5. Połącz aplikację
1. W aplikacji otwórz **Więcej → Synchronizacja** (na laptopie: menu po lewej).
2. Wklej **Project URL** i **klucz** → *Zapisz i sprawdź połączenie*.
3. Wpisz swój e-mail i hasło (min. 6 znaków) → **Załóż konto**.
4. Wybierz **„Jestem właścicielem — nowe gospodarstwo”**, wpisz nazwę → *Utwórz gospodarstwo*.
   Aplikacja zapyta, czy usunąć dane demo (zalecane), i wyśle Twoje dane na serwer.
5. Na ekranie synchronizacji zobaczysz **kod gospodarstwa** (8 znaków).

> Wskazówka: żeby pracownicy nie musieli wklejać adresu i klucza, wpisz je raz w pliku `js/config.js`
> (`SUPABASE_URL` i `SUPABASE_ANON_KEY`) i opublikuj aplikację ponownie.

### Krok 6. Drugie urządzenie i pracownicy
- **Twój drugi sprzęt (np. laptop):** otwórz aplikację → Synchronizacja → (adres i klucz) → **Zaloguj**
  tym samym e-mailem i hasłem → wybierz swoje gospodarstwo z listy.
- **Pracownik:** na swoim telefonie otwiera adres aplikacji, instaluje ją → Synchronizacja → (adres i klucz) →
  **Załóż konto** swoim e-mailem → **„Jestem pracownikiem — mam kod”** → wpisuje kod od właściciela.
- Właściciel widzi listę użytkowników i może **odebrać dostęp** lub **wygenerować nowy kod**.
- Każdy wpis pokazuje, **kto i kiedy go dodał** (np. „dodał(a): pracownik@…, 31.10.2026 18:41”).

### Dobrze wiedzieć
- Stan synchronizacji widać w menu bocznym (laptop) lub w małym znaczku nad dolnym menu (telefon):
  ☁️✓ aktualne · 🔄 trwa · 📴 brak internetu (zmiany czekają) · ⚠️ błąd.
- Darmowy projekt Supabase jest **wstrzymywany po ok. tygodniu bez używania** — wtedy wejdź na supabase.com
  i kliknij *Restore project*. Dane nie giną, a aplikacja w tym czasie działa normalnie offline.
- Kopia zapasowa JSON (*Ustawienia → Kopia zapasowa*) nadal jest zalecana — niezależnie od Supabase.

---

## 6. Jak dodać nowe pole do karty krowy

Wszystkie pola karty są opisane w jednym miejscu: tablica **`COW_FIELDS`** w pliku **`js/model.js`**.
Z niej automatycznie powstaje: formularz dodawania/edycji, widok karty, wydruk karty i eksport CSV.
**Nie trzeba zmieniać bazy** — ani IndexedDB, ani Supabase (wpis jest zapisywany jako całość w JSON).

**Przykład:** dodajemy pole „Numer paszportu” w sekcji *Identyfikacja* i „Ocena temperamentu” w sekcji *Opis*.

1. Otwórz `js/model.js` i znajdź `export const COW_FIELDS = [`.
2. Dopisz obiekt w miejscu, w którym pole ma się pojawić (kolejność = kolejność w formularzu):

```js
{ section: 'Identyfikacja', name: 'passportNo', label: 'Numer paszportu', type: 'text' },
{ section: 'Opis', name: 'temper', label: 'Temperament', type: 'select',
  options: ['spokojna', 'nerwowa', 'agresywna'] },
```

3. Zwiększ `VERSION` w `sw.js` (np. `obora-v1.0.1`), żeby telefony pobrały nową wersję.
4. Gotowe — pole jest w formularzu, na karcie, na wydruku i w CSV.

**Dostępne typy pól:** `text`, `number` (z `unit: 'kg'`), `date`, `select` (z `options`),
`textarea`, `checkbox`, `photo`, `cowref` (wybór zwierzęcia ze stada lub wpis ręczny).

**Przydatne opcje:**
- `required: true` — pole wymagane,
- `showIf: v => v.sex === 'krowa'` — pokaż pole tylko w określonej sytuacji,
- `list: ['A', 'B']` — podpowiedzi przy wpisywaniu,
- `help: 'tekst'` — podpowiedź pod polem,
- `card: false` — nie pokazuj na karcie (tylko w formularzu).

**Walidacja (opcjonalnie):** w tym samym pliku, w funkcji `validateCow()`, dopisz regułę, np.:
```js
if (v.passportNo && !/^PL\d{12}$/.test(v.passportNo)) e.passportNo = 'Nieprawidłowy numer paszportu.';
```

**Jeśli pole ma być widoczne na kafelku listy stada** — dopisz je w funkcji `cowTile()` w `js/views/common.js`;
**jeśli ma być wyszukiwane** — w funkcji `matchesQuery()` w `js/views/herd.js`.

---

## 7. Ograniczenia i uwagi

- **Powiadomienia** pojawiają się, gdy aplikacja jest otwarta lub działa w tle. Przeglądarki nie pozwalają
  wysyłać powiadomień do całkowicie zamkniętej aplikacji bez własnego serwera push.
  Na iPhonie wymagają dodania aplikacji do ekranu głównego (iOS 16.4+).
- **Skaner kodów w aplikacji** korzysta z funkcji `BarcodeDetector` (Chrome/Edge na Androidzie).
  Na iPhonie zeskanuj kod QR z kojca **zwykłym aparatem** — otworzy kartę krowy.
- **Kod QR** zawiera adres aplikacji (np. `https://…/obora/#/krowa/<id>`). Jeśli zmienisz adres strony,
  wydrukuj etykiety ponownie.
- **Wyszukiwanie głosowe** działa w Chrome (Android, komputer) i Safari.
- **Szacunki** (stan magazynu pasz, pasza w wyniku na krowę) liczone są z obecnych dawek — regularna
  inwentaryzacja magazynu poprawia dokładność.
- Wymogi prawne (księga leczenia, terminy IRZplus) zostały odwzorowane według stanu wiedzy autora —
  przed kontrolą porównaj wydruk z aktualnymi przepisami i zaleceniami lekarza weterynarii / ARiMR.
