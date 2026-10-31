/**
 * views/search-tools.js — przyciski przy wyszukiwarce stada:
 * 🎤 wyszukiwanie głosowe i 📷 skanowanie kolczyka / kodu QR.
 * Po jednoznacznym trafieniu od razu otwiera kartę zwierzęcia.
 */
import * as db from '../db.js';
import { registerSearchTool, findCowByText } from './herd.js';
import { scanDialog, listen, canListen } from '../scanner.js';
import { navigate } from '../router.js';
import { toast } from '../ui.js';

async function handle(text, setQuery) {
  if (!text) return;
  const d = await db.loadAll();
  const cow = findCowByText(d, text);
  if (cow) { navigate('/krowa/' + cow.id); return; }
  // link z kodu QR innego gospodarstwa / nieznany kolczyk — pokaż w wyszukiwarce
  const m = String(text).match(/#\/krowa\/([\w-]+)/);
  if (m) { toast('Nie znaleziono tego zwierzęcia w stadzie (może zostało usunięte).', 'warn'); return; }
  setQuery(text);
}

registerSearchTool({ id: 'voice', label: '🎤', title: 'Szukaj głosem', available: canListen, run: async set => handle(await listen(), set) });
registerSearchTool({ id: 'scan', label: '📷', title: 'Skanuj kolczyk lub kod QR', available: () => true, run: async set => handle(await scanDialog(), set) });
